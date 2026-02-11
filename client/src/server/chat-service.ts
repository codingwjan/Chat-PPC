import { MessageType, Prisma } from "@prisma/client";
import OpenAI from "openai";
import { getDefaultProfilePicture as getDefaultAvatar } from "@/lib/default-avatar";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/sse-bus";
import type { CreateMessageRequest, MessageDTO, SnapshotDTO, UserPresenceDTO } from "@/lib/types";
import { AppError, assert } from "@/server/errors";
import chatgptProfilePicture from "@/resources/chatgpt.png";

const PRESENCE_TIMEOUT_MS = 15_000;

function getDefaultProfilePicture(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE || getDefaultAvatar();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function toChatMessageType(type: MessageType): MessageDTO["type"] {
  if (type === MessageType.VOTING_POLL) return "votingPoll";
  if (type === MessageType.QUESTION) return "question";
  if (type === MessageType.ANSWER) return "answer";
  return "message";
}

function toDbMessageType(type: CreateMessageRequest["type"]): MessageType {
  if (type === "votingPoll") return MessageType.VOTING_POLL;
  if (type === "question") return MessageType.QUESTION;
  if (type === "answer") return MessageType.ANSWER;
  return MessageType.MESSAGE;
}

function mapUser(user: {
  id: string;
  clientId: string;
  username: string;
  profilePicture: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: Date | null;
}): UserPresenceDTO {
  return {
    id: user.id,
    clientId: user.clientId,
    username: user.username,
    profilePicture: user.profilePicture,
    status: user.status,
    isOnline: user.isOnline,
    lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
  };
}

type MessageRow = Prisma.MessageGetPayload<{
  include: { questionMessage: true; author: true; pollOptions: { include: { votes: true } } };
}>;

function mapMessage(message: MessageRow): MessageDTO {
  const modernPollOptions =
    message.pollOptions?.length > 0
      ? message.pollOptions
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((option) => ({
          id: option.id,
          label: option.label,
          votes: option.votes.length,
        }))
      : [];

  const legacyPollOptions =
    message.type === MessageType.VOTING_POLL && modernPollOptions.length === 0
      ? [
        {
          id: `${message.id}-legacy-left`,
          label: message.optionOne || "Option 1",
          votes: message.pollLeftCount,
        },
        {
          id: `${message.id}-legacy-right`,
          label: message.optionTwo || "Option 2",
          votes: message.pollRightCount,
        },
      ]
      : [];

  return {
    id: message.id,
    authorId: message.authorId ?? undefined,
    type: toChatMessageType(message.type),
    message: message.content,
    username: message.authorName,
    profilePicture: message.author?.profilePicture || message.authorProfilePicture,
    createdAt: message.createdAt.toISOString(),
    optionOne: message.optionOne ?? undefined,
    optionTwo: message.optionTwo ?? undefined,
    resultone: message.type === MessageType.VOTING_POLL ? String(message.pollLeftCount) : undefined,
    resulttwo: message.type === MessageType.VOTING_POLL ? String(message.pollRightCount) : undefined,
    questionId: message.questionMessageId ?? undefined,
    oldusername: message.questionMessage?.authorName ?? undefined,
    oldmessage: message.questionMessage?.content ?? undefined,
    poll:
      message.type === MessageType.VOTING_POLL
        ? {
          options: modernPollOptions.length > 0 ? modernPollOptions : legacyPollOptions,
          settings: {
            multiSelect: message.pollMultiSelect,
            allowVoteChange: message.pollAllowVoteChange,
          },
        }
        : undefined,
  };
}

async function assertUsernameAllowed(username: string): Promise<void> {
  const blocked = await prisma.blacklistEntry.findUnique({
    where: { username: normalizeUsername(username) },
  });

  if (blocked) {
    throw new AppError("Username is not allowed", 403);
  }
}

async function assertUsernameAvailable(username: string, exceptClientId?: string): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: {
      username: {
        equals: username.trim(),
        mode: "insensitive",
      },
    },
  });

  if (existing && existing.clientId !== exceptClientId) {
    throw new AppError("Username is already in use", 409);
  }
}

async function emitSystemMessage(content: string): Promise<void> {
  const created = await prisma.message.create({
    data: {
      type: MessageType.MESSAGE,
      content,
      authorName: "System",
      authorProfilePicture: getDefaultProfilePicture(),
    },
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
  });

  publish("message.created", mapMessage(created));
}

async function cleanupOfflineUsers(): Promise<void> {
  const threshold = new Date(Date.now() - PRESENCE_TIMEOUT_MS);
  const staleUsers = await prisma.user.findMany({
    where: {
      isOnline: true,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
    },
    orderBy: [{ lastSeenAt: "asc" }],
  });

  for (const user of staleUsers) {
    const result = await prisma.user.updateMany({
      where: { id: user.id, isOnline: true },
      data: { isOnline: false, status: "" },
    });

    if (result.count === 0) {
      continue;
    }

    const dto = mapUser({
      ...user,
      isOnline: false,
      status: "",
    });
    publish("presence.updated", dto);

    // Delete user to free username
    await prisma.user.delete({ where: { id: user.id } });

    await emitSystemMessage(`${user.username} left the chat`);
  }
}

async function getOnlineUsers(): Promise<UserPresenceDTO[]> {
  await cleanupOfflineUsers();

  const users = await prisma.user.findMany({
    where: { isOnline: true },
    orderBy: [{ username: "asc" }],
  });

  return users.map(mapUser);
}

async function getMessageRows(): Promise<MessageRow[]> {
  return prisma.message.findMany({
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
}

function publishAiStatus(status: string): void {
  publish("ai.status", { status });
}

async function getRecentMessages(limit = 15): Promise<MessageRow[]> {
  return prisma.message.findMany({
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });
}

function formatMessagesForAi(messages: MessageRow[]): Array<{ role: string; content: string }> {
  return [...messages].reverse().map((msg) => ({
    role: msg.authorName === "ChatGPT" ? "assistant" : "user",
    content: `[${msg.authorName}]: ${msg.content}`,
  }));
}

async function emitAiResponse(contextMessages: MessageRow[]): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;

  publishAiStatus("Thinking…");

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chatHistory = formatMessagesForAi(contextMessages);

    const response = await (client.responses as any).create({
      prompt: {
        id: "pmpt_698b4aee21308196b860d14abc12b51d0f2e06f804bcc0ca",
        version: "4",
      },
      input: [],
      text: { format: { type: "text" } },
      reasoning: {},
      tools: [
        {
          "type": "web_search",
          "user_location": {
            "type": "approximate",
            "country": "DE",
            "region": "Hessen",
            "city": "Limburg"
          },
          "search_context_size": "low"
        },
        {
          "type": "image_generation",
          "background": "auto",
          "model": "gpt-image-1-mini",
          "moderation": "low",
          "output_compression": 100,
          "output_format": "png",
          "quality": "auto",
          "size": "auto"
        }
      ],
      store: true,
      include: [
        "reasoning.encrypted_content",
        "web_search_call.action.sources"
      ]
    });

    // Build message content from response
    let outputContent = "";

    if (response.output_text) {
      outputContent += response.output_text;
    }

    // Check for generated images in output array
    let hasImage = false;
    if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item.type === "image_generation_call" && item.result) {
          hasImage = true;
          publishAiStatus("Generating image…");
          const imageUrl = item.result.url || (item.result.image ? `data:image/png;base64,${item.result.image}` : null);
          if (imageUrl) {
            outputContent += `\n![Generated Image](${imageUrl})`;
          }
        }
      }
    }

    const text = outputContent.trim();

    // If AI decided not to respond, silently go back to online
    if (!text || text === "[NO_RESPONSE]") {
      publishAiStatus("Online");
      return;
    }

    publishAiStatus(hasImage ? "Sending image…" : "Typing…");

    const created = await prisma.message.create({
      data: {
        type: MessageType.MESSAGE,
        content: text,
        authorName: "ChatGPT",
        authorProfilePicture: chatgptProfilePicture.src,
      },
      include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
    });

    publish("message.created", mapMessage(created));
  } catch (error) {
    console.error("OpenAI error:", error);
    // Optionally post an error message
    const errorText = error instanceof Error ? `OpenAI request failed: ${error.message}` : "OpenAI request failed.";
    const created = await prisma.message.create({
      data: {
        type: MessageType.MESSAGE,
        content: errorText,
        authorName: "ChatGPT",
        authorProfilePicture: chatgptProfilePicture.src,
      },
      include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
    });
    publish("message.created", mapMessage(created));
  } finally {
    publishAiStatus("Online");
  }
}

async function maybeRespondAsAi(): Promise<void> {
  const recentMessages = await getRecentMessages(15);
  await emitAiResponse(recentMessages);
}

async function getUserByClientId(clientId: string) {
  const user = await prisma.user.findUnique({ where: { clientId } });
  assert(user, "User session not found. Please login again.", 401);
  return user;
}

export async function getSnapshot(): Promise<SnapshotDTO> {
  const [users, messages] = await Promise.all([getOnlineUsers(), getMessageRows()]);
  return { users, messages: messages.map(mapMessage) };
}

export async function getMessages(): Promise<MessageDTO[]> {
  const messages = await getMessageRows();
  return messages.map(mapMessage);
}

export async function loginUser(input: {
  username: string;
  clientId: string;
  profilePicture?: string;
}): Promise<UserPresenceDTO> {
  const username = input.username.trim();
  assert(username.length >= 3, "Username must be at least 3 characters", 400);

  await assertUsernameAllowed(username);
  await assertUsernameAvailable(username, input.clientId);

  const existingUser = await prisma.user.findUnique({
    where: { clientId: input.clientId },
    select: { isOnline: true },
  });

  const user = await prisma.user.upsert({
    where: { clientId: input.clientId },
    update: {
      username,
      profilePicture: input.profilePicture || getDefaultProfilePicture(),
      isOnline: true,
      status: "",
      lastSeenAt: new Date(),
    },
    create: {
      clientId: input.clientId,
      username,
      profilePicture: input.profilePicture || getDefaultProfilePicture(),
      isOnline: true,
      status: "",
      lastSeenAt: new Date(),
    },
  });

  const dto = mapUser(user);
  publish("user.updated", dto);
  publish("presence.updated", dto);

  if (!existingUser?.isOnline) {
    await emitSystemMessage(`${user.username} joined the chat`);
  }

  return dto;
}

export async function renameUser(input: {
  clientId: string;
  newUsername?: string;
  profilePicture?: string;
}): Promise<UserPresenceDTO> {
  const newUsername = input.newUsername?.trim();
  const profilePicture = input.profilePicture?.trim();
  assert(newUsername || profilePicture, "Either newUsername or profilePicture is required", 400);

  if (newUsername) {
    assert(newUsername.length >= 3, "Username must be at least 3 characters", 400);
    await assertUsernameAllowed(newUsername);
    await assertUsernameAvailable(newUsername, input.clientId);
  }

  const user = await prisma.user.update({
    where: { clientId: input.clientId },
    data: {
      ...(newUsername ? { username: newUsername } : {}),
      ...(profilePicture ? { profilePicture } : {}),
      updatedAt: new Date(),
    },
  });

  const dto = mapUser(user);
  publish("user.updated", dto);
  return dto;
}

export async function pingPresence(input: { clientId: string }): Promise<UserPresenceDTO> {
  const user = await prisma.user.update({
    where: { clientId: input.clientId },
    data: { isOnline: true, lastSeenAt: new Date() },
  });

  await cleanupOfflineUsers();
  const dto = mapUser(user);
  publish("presence.updated", dto);
  return dto;
}

export async function setTypingStatus(input: { clientId: string; status: string }): Promise<UserPresenceDTO> {
  const user = await prisma.user.update({
    where: { clientId: input.clientId },
    data: { status: input.status, isOnline: true, lastSeenAt: new Date() },
  });

  const dto = mapUser(user);
  publish("presence.updated", dto);
  return dto;
}

export async function markUserOffline(input: { clientId: string }): Promise<UserPresenceDTO> {
  const user = await prisma.user.findUnique({ where: { clientId: input.clientId } });
  if (!user) return {} as any;

  await prisma.user.delete({ where: { clientId: input.clientId } });

  const dto = mapUser({ ...user, isOnline: false, status: "" });
  publish("presence.updated", dto);
  await emitSystemMessage(`${user.username} left the chat`);
  return dto;
}

export async function createMessage(input: CreateMessageRequest): Promise<MessageDTO> {
  const user = await getUserByClientId(input.clientId);
  const message = input.message.trim();
  assert(message.length > 0, "Message cannot be empty", 400);

  const type = toDbMessageType(input.type);
  let questionMessageId: string | undefined;

  if (type === MessageType.ANSWER) {
    assert(input.questionId, "questionId is required for answer", 400);
    const questionMessage = await prisma.message.findUnique({ where: { id: input.questionId } });
    assert(questionMessage, "Question message not found", 404);
    assert(questionMessage.type === MessageType.QUESTION, "questionId must reference a question", 400);
    questionMessageId = questionMessage.id;
  }

  const normalizedPollOptions = input.pollOptions?.map((value) => value.trim()).filter(Boolean) ?? [];
  const fallbackPollOptions = [input.optionOne?.trim(), input.optionTwo?.trim()].filter(Boolean) as string[];
  const pollOptions = normalizedPollOptions.length > 0 ? normalizedPollOptions : fallbackPollOptions;

  if (type === MessageType.VOTING_POLL) {
    assert(pollOptions.length >= 2, "At least two poll options are required", 400);
    assert(pollOptions.length <= 15, "Poll supports up to 15 options", 400);
    assert(
      new Set(pollOptions.map((value) => value.toLowerCase())).size === pollOptions.length,
      "Poll options must be unique",
      400,
    );
  }

  let content = message;
  if (type === MessageType.MESSAGE) {
    if (message.startsWith("/roll")) {
      content = `${user.username} rolled ${Math.floor(Math.random() * 6) + 1}`;
    } else if (message.startsWith("/coin")) {
      content = `${user.username} flipped ${Math.random() < 0.5 ? "heads" : "tails"}`;
    } else if (message.startsWith("/help")) {
      content = "Try /ai <prompt>, /roll, /coin, and polls with up to 15 options.";
    }
  }

  const created = await prisma.message.create({
    data: {
      type,
      content,
      authorId: user.id,
      authorName: user.username,
      authorProfilePicture: user.profilePicture,
      optionOne: pollOptions[0] || null,
      optionTwo: pollOptions[1] || null,
      pollMultiSelect: Boolean(input.pollMultiSelect),
      pollAllowVoteChange: Boolean(input.pollAllowVoteChange),
      questionMessageId: questionMessageId || null,
      pollLeftCount: 0,
      pollRightCount: 0,
      ...(type === MessageType.VOTING_POLL
        ? {
          pollOptions: {
            create: pollOptions.map((label, sortOrder) => ({
              label,
              sortOrder,
            })),
          },
        }
        : {}),
    },
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
  });

  const dto = mapMessage(created);
  publish("message.created", dto);

  // Auto-trigger AI evaluation for user messages (skip system commands and polls)
  const isSlashCommand = message.startsWith("/roll") || message.startsWith("/coin") || message.startsWith("/help");
  if (!isSlashCommand && type !== MessageType.VOTING_POLL) {
    void maybeRespondAsAi().catch((error) => {
      console.error("AI auto-response error:", error instanceof Error ? error.message : error);
    });
  }

  return dto;
}

export async function votePoll(input: {
  clientId: string;
  pollMessageId: string;
  side?: "left" | "right";
  optionIds?: string[];
}): Promise<MessageDTO> {
  const user = await getUserByClientId(input.clientId);
  const poll = await prisma.message.findUnique({
    where: { id: input.pollMessageId },
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
  });

  assert(poll, "Poll not found", 404);
  assert(poll.type === MessageType.VOTING_POLL, "Message is not a voting poll", 400);

  const sortedOptions = [...poll.pollOptions].sort((a, b) => a.sortOrder - b.sortOrder);
  let targetOptionIds = input.optionIds?.filter(Boolean) ?? [];

  if (targetOptionIds.length === 0 && input.side) {
    const legacyOption = input.side === "left" ? sortedOptions[0] : sortedOptions[1];
    if (legacyOption) targetOptionIds = [legacyOption.id];
  }

  assert(targetOptionIds.length > 0, "At least one poll option is required", 400);
  assert(targetOptionIds.length <= 15, "Poll supports up to 15 selected options", 400);

  if (!poll.pollMultiSelect) {
    assert(targetOptionIds.length === 1, "This poll allows only one vote", 400);
  }

  const validOptionIds = new Set(sortedOptions.map((option) => option.id));
  assert(
    targetOptionIds.every((optionId) => validOptionIds.has(optionId)),
    "One or more poll options are invalid",
    400,
  );

  const existingVotes = await prisma.pollChoiceVote.findMany({
    where: { pollMessageId: poll.id, userId: user.id },
  });

  if (!poll.pollAllowVoteChange && existingVotes.length > 0) {
    throw new AppError("This poll does not allow changing your vote", 409);
  }

  if (existingVotes.length > 0) {
    await prisma.pollChoiceVote.deleteMany({
      where: { pollMessageId: poll.id, userId: user.id },
    });
  }

  await prisma.pollChoiceVote.createMany({
    data: [...new Set(targetOptionIds)].map((optionId) => ({
      pollMessageId: poll.id,
      pollOptionId: optionId,
      userId: user.id,
    })),
    skipDuplicates: true,
  });

  const groupedVotes = await prisma.pollChoiceVote.groupBy({
    by: ["pollOptionId"],
    where: { pollMessageId: poll.id },
    _count: { pollOptionId: true },
  });
  const voteByOptionId = new Map(groupedVotes.map((row) => [row.pollOptionId, row._count.pollOptionId]));

  const updated = await prisma.message.update({
    where: { id: poll.id },
    data: {
      pollLeftCount: sortedOptions[0] ? voteByOptionId.get(sortedOptions[0].id) || 0 : 0,
      pollRightCount: sortedOptions[1] ? voteByOptionId.get(sortedOptions[1].id) || 0 : 0,
    },
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: true } } },
  });

  const dto = mapMessage(updated);
  publish("poll.updated", dto);
  return dto;
}

export async function importLegacyBlacklist(usernames: string[]): Promise<void> {
  const normalized = [...new Set(usernames.map((name) => normalizeUsername(name).trim()).filter(Boolean))];
  if (normalized.length === 0) return;

  await prisma.blacklistEntry.createMany({
    data: normalized.map((username) => ({ username })),
    skipDuplicates: true,
  });
}

export async function importLegacyUser(data: {
  clientId: string;
  username: string;
  profilePicture?: string;
  isOnline?: boolean;
  status?: string;
}): Promise<void> {
  await prisma.user.upsert({
    where: { clientId: data.clientId },
    update: {
      username: data.username,
      profilePicture: data.profilePicture || getDefaultProfilePicture(),
      isOnline: Boolean(data.isOnline),
      status: data.status || "",
      lastSeenAt: data.isOnline ? new Date() : null,
    },
    create: {
      clientId: data.clientId,
      username: data.username,
      profilePicture: data.profilePicture || getDefaultProfilePicture(),
      isOnline: Boolean(data.isOnline),
      status: data.status || "",
      lastSeenAt: data.isOnline ? new Date() : null,
    },
  });
}

export async function importLegacyMessage(data: {
  legacyKey: string;
  type: MessageDTO["type"];
  content: string;
  username: string;
  profilePicture?: string;
  optionOne?: string;
  optionTwo?: string;
  resultone?: string;
  resulttwo?: string;
  questionMessageId?: string;
  createdAt?: Date;
  authorClientId?: string;
}): Promise<string> {
  const user = data.authorClientId
    ? await prisma.user.findUnique({ where: { clientId: data.authorClientId } })
    : await prisma.user.findFirst({ where: { username: { equals: data.username, mode: "insensitive" } } });

  const created = await prisma.message.upsert({
    where: { legacyKey: data.legacyKey },
    update: {},
    create: {
      legacyKey: data.legacyKey,
      type: toDbMessageType(data.type),
      content: data.content,
      authorId: user?.id ?? null,
      authorName: data.username,
      authorProfilePicture: data.profilePicture || getDefaultProfilePicture(),
      optionOne: data.optionOne || null,
      optionTwo: data.optionTwo || null,
      pollLeftCount: Number(data.resultone || "0") || 0,
      pollRightCount: Number(data.resulttwo || "0") || 0,
      questionMessageId: data.questionMessageId || null,
      createdAt: data.createdAt,
    },
  });

  return created.id;
}
