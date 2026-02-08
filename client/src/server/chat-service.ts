import { MessageType, Prisma, VoteSide } from "@prisma/client";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/sse-bus";
import type {
  CreateMessageRequest,
  MessageDTO,
  SnapshotDTO,
  UserPresenceDTO,
} from "@/lib/types";
import { AppError, assert } from "@/server/errors";

const PRESENCE_TIMEOUT_MS = 15_000;

function getDefaultProfilePicture(): string {
  return (
    process.env.NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE ||
    "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg"
  );
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

function mapMessage(
  message: Prisma.MessageGetPayload<{
    include: { questionMessage: true; author: true };
  }>,
): MessageDTO {
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
    resultone:
      message.type === MessageType.VOTING_POLL
        ? String(message.pollLeftCount)
        : undefined,
    resulttwo:
      message.type === MessageType.VOTING_POLL
        ? String(message.pollRightCount)
        : undefined,
    questionId: message.questionMessageId ?? undefined,
    oldusername: message.questionMessage?.authorName ?? undefined,
    oldmessage: message.questionMessage?.content ?? undefined,
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

async function assertUsernameAvailable(
  username: string,
  exceptClientId?: string,
): Promise<void> {
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

async function cleanupOfflineUsers(): Promise<void> {
  const threshold = new Date(Date.now() - PRESENCE_TIMEOUT_MS);
  await prisma.user.updateMany({
    where: {
      isOnline: true,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
    },
    data: {
      isOnline: false,
      status: "",
    },
  });
}

async function getOnlineUsers(): Promise<UserPresenceDTO[]> {
  await cleanupOfflineUsers();

  const users = await prisma.user.findMany({
    where: { isOnline: true },
    orderBy: [{ username: "asc" }],
  });

  return users.map(mapUser);
}

async function getMessageRows(): Promise<
  Prisma.MessageGetPayload<{ include: { questionMessage: true; author: true } }>[
]
> {
  return prisma.message.findMany({
    include: { questionMessage: true, author: true },
    orderBy: [{ createdAt: "asc" }],
  });
}

async function emitAiResponse(prompt: string): Promise<void> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const profilePicture = "https://nowmag.gr/wp-content/uploads/2020/07/gpt3-1024x500.jpg";

  let text = "No OPENAI_API_KEY configured, so this is a local fallback response.";

  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.responses.create({
        model,
        input: `User asked: ${prompt}\n\nReply like a concise helpful chat assistant.`,
      });

      text = response.output_text?.trim() || "I could not generate a response.";
    } catch (error) {
      text =
        error instanceof Error
          ? `OpenAI request failed: ${error.message}`
          : "OpenAI request failed.";
    }
  }

  const created = await prisma.message.create({
    data: {
      type: MessageType.MESSAGE,
      content: text,
      authorName: "GPT",
      authorProfilePicture: profilePicture,
    },
    include: { questionMessage: true, author: true },
  });

  publish("message.created", mapMessage(created));
}

async function getUserByClientId(clientId: string) {
  const user = await prisma.user.findUnique({ where: { clientId } });
  assert(user, "User session not found. Please login again.", 401);
  return user;
}

export async function getSnapshot(): Promise<SnapshotDTO> {
  const [users, messages] = await Promise.all([getOnlineUsers(), getMessageRows()]);
  return {
    users,
    messages: messages.map(mapMessage),
  };
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
    data: {
      isOnline: true,
      lastSeenAt: new Date(),
    },
  });

  await cleanupOfflineUsers();
  const dto = mapUser(user);
  publish("presence.updated", dto);
  return dto;
}

export async function setTypingStatus(input: {
  clientId: string;
  status: string;
}): Promise<UserPresenceDTO> {
  const user = await prisma.user.update({
    where: { clientId: input.clientId },
    data: {
      status: input.status,
      isOnline: true,
      lastSeenAt: new Date(),
    },
  });

  const dto = mapUser(user);
  publish("presence.updated", dto);
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
    const questionMessage = await prisma.message.findUnique({
      where: { id: input.questionId },
    });

    assert(questionMessage, "Question message not found", 404);
    assert(questionMessage.type === MessageType.QUESTION, "questionId must reference a question", 400);
    questionMessageId = questionMessage.id;
  }

  if (type === MessageType.VOTING_POLL) {
    assert(input.optionOne?.trim(), "optionOne is required for votingPoll", 400);
    assert(input.optionTwo?.trim(), "optionTwo is required for votingPoll", 400);
  }

  const created = await prisma.message.create({
    data: {
      type,
      content: message,
      authorId: user.id,
      authorName: user.username,
      authorProfilePicture: user.profilePicture,
      optionOne: input.optionOne?.trim() || null,
      optionTwo: input.optionTwo?.trim() || null,
      questionMessageId: questionMessageId || null,
      pollLeftCount: 0,
      pollRightCount: 0,
    },
    include: { questionMessage: true, author: true },
  });

  const dto = mapMessage(created);
  publish("message.created", dto);

  if (type === MessageType.MESSAGE && message.includes("!ai")) {
    void emitAiResponse(message).catch((error) => {
      const fallback = error instanceof Error ? error.message : "Unknown AI processing error";
      console.error("Failed to generate AI response:", fallback);
    });
  }

  return dto;
}

export async function votePoll(input: {
  clientId: string;
  pollMessageId: string;
  side: "left" | "right";
}): Promise<MessageDTO> {
  const user = await getUserByClientId(input.clientId);

  const poll = await prisma.message.findUnique({
    where: { id: input.pollMessageId },
  });

  assert(poll, "Poll not found", 404);
  assert(poll.type === MessageType.VOTING_POLL, "Message is not a voting poll", 400);

  try {
    await prisma.pollVote.create({
      data: {
        pollMessageId: poll.id,
        userId: user.id,
        side: input.side === "left" ? VoteSide.LEFT : VoteSide.RIGHT,
      },
    });
  } catch {
    throw new AppError("You have already voted on this poll", 409);
  }

  const updated = await prisma.message.update({
    where: { id: poll.id },
    data:
      input.side === "left"
        ? { pollLeftCount: { increment: 1 } }
        : { pollRightCount: { increment: 1 } },
    include: { questionMessage: true, author: true },
  });

  const dto = mapMessage(updated);
  publish("poll.updated", dto);
  return dto;
}

export async function importLegacyBlacklist(usernames: string[]): Promise<void> {
  const normalized = [...new Set(usernames.map((name) => normalizeUsername(name).trim()).filter(Boolean))];
  if (normalized.length === 0) {
    return;
  }

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
