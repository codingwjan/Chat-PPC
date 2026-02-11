import { MessageType, Prisma } from "@prisma/client";
import { put } from "@vercel/blob";
import OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { getDefaultProfilePicture as getDefaultAvatar } from "@/lib/default-avatar";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/sse-bus";
import type {
  AdminActionRequest,
  AdminActionResponse,
  AdminOverviewDTO,
  AiStatusDTO,
  ChatBackgroundDTO,
  CreateMessageRequest,
  LoginResponseDTO,
  MediaItemDTO,
  MediaPageDTO,
  MessageDTO,
  MessagePageDTO,
  SnapshotDTO,
  UserPresenceDTO,
} from "@/lib/types";
import { AppError, assert } from "@/server/errors";
import { issueDevAuthToken, isDevUnlockUsername, verifyDevAuthToken } from "@/server/dev-mode";
import { getChatOpenAiConfig } from "@/server/openai-config";
import chatgptProfilePicture from "@/resources/chatgpt.png";

const PRESENCE_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const MAX_MESSAGE_PAGE_LIMIT = 100;
const AI_IMAGE_MIME_TYPE = "image/png";
const MAX_INLINE_AI_IMAGE_BYTES = 12 * 1024 * 1024;
const AI_STATUS_CLIENT_ID = "__chatppc_ai_status__";
const AI_STATUS_USERNAME = "__chatppc_ai_status__";
const CHAT_BACKGROUND_CLIENT_ID = "__chatppc_chat_background__";
const CHAT_BACKGROUND_USERNAME = "__chatppc_chat_background__";
const DEVELOPER_USERNAME = "Developer";
const AI_CONTEXT_RECENT_MESSAGES = 8;
const AI_CONTEXT_RECENT_MESSAGES_MINIMAL = 2;
const AI_CONTEXT_CHARS = 4_500;
const AI_CONTEXT_CHARS_MINIMAL = 900;
const AI_LINE_CHARS = 650;
const AI_LINE_CHARS_MINIMAL = 220;
const AI_REQUEST_CHARS = 7_500;
const AI_REQUEST_CHARS_MINIMAL = 1_600;
const AI_USER_PROMPT_CHARS = 1_300;
const AI_USER_PROMPT_CHARS_MINIMAL = 450;
const SYSTEM_CLIENT_IDS = [AI_STATUS_CLIENT_ID, CHAT_BACKGROUND_CLIENT_ID] as const;
const IMAGE_URL_REGEX = /\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i;
const DEFAULT_MEDIA_PAGE_LIMIT = 3;
const MAX_MEDIA_PAGE_LIMIT = 30;
const MEDIA_CACHE_TTL_MS = 30_000;

let aiStatusState: AiStatusDTO = {
  status: "online",
  updatedAt: new Date().toISOString(),
};

let mediaItemsCache:
  | {
    expiresAt: number;
    latestMessageAt: string | null;
    items: MediaItemDTO[];
  }
  | null = null;

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
  include: { questionMessage: true; author: true; pollOptions: { include: { votes: { include: { user: true } } } } };
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
          voters: option.votes
            .map((vote) =>
              vote.user
                ? {
                  id: vote.user.id,
                  username: vote.user.username,
                  profilePicture: vote.user.profilePicture,
                }
                : null,
            )
            .filter((voter): voter is { id: string; username: string; profilePicture: string } => Boolean(voter)),
        }))
      : [];

  const legacyPollOptions =
    message.type === MessageType.VOTING_POLL && modernPollOptions.length === 0
      ? [
        {
          id: `${message.id}-legacy-left`,
          label: message.optionOne || "Option 1",
          votes: message.pollLeftCount,
          voters: [],
        },
        {
          id: `${message.id}-legacy-right`,
          label: message.optionTwo || "Option 2",
          votes: message.pollRightCount,
          voters: [],
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
            allowVoteChange: true,
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
      isOnline: true,
      username: {
        equals: username.trim(),
        mode: "insensitive",
      },
      ...(exceptClientId ? { clientId: { not: exceptClientId } } : {}),
    },
  });

  if (existing) {
    throw new AppError("Username is already in use", 409);
  }
}

async function resolveDeveloperUsername(clientId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { clientId },
    select: { username: true },
  });

  if (existing?.username && existing.username.toLowerCase().startsWith(DEVELOPER_USERNAME.toLowerCase())) {
    return existing.username;
  }

  const baseTaken = await prisma.user.findFirst({
    where: {
      isOnline: true,
      clientId: { not: clientId },
      username: {
        equals: DEVELOPER_USERNAME,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (!baseTaken) {
    return DEVELOPER_USERNAME;
  }

  return `${DEVELOPER_USERNAME}-${clientId.slice(0, 6)}`;
}

async function emitSystemMessage(content: string): Promise<void> {
  const created = await prisma.message.create({
    data: {
      type: MessageType.MESSAGE,
      content,
      authorName: "System",
      authorProfilePicture: getDefaultProfilePicture(),
    },
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
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

    // Best effort delete to keep table clean. If DB constraints block delete,
    // user is already marked offline so presence correctness is preserved.
    try {
      await prisma.user.delete({ where: { id: user.id } });
    } catch (error) {
      console.error("Failed to delete stale user row:", error);
    }

    await emitSystemMessage(`${user.username} left the chat`);
  }
}

export async function getOnlineUsers(): Promise<UserPresenceDTO[]> {
  await cleanupOfflineUsers();

  const users = await prisma.user.findMany({
    where: { isOnline: true },
    orderBy: [{ username: "asc" }],
  });

  return users.map(mapUser);
}

export async function getAiStatus(): Promise<AiStatusDTO> {
  const persisted = await prisma.user.findUnique({
    where: { clientId: AI_STATUS_CLIENT_ID },
    select: {
      status: true,
      lastSeenAt: true,
    },
  });

  if (!persisted) {
    return aiStatusState;
  }

  return {
    status: persisted.status || "online",
    updatedAt: persisted.lastSeenAt?.toISOString() || aiStatusState.updatedAt,
  };
}

function normalizeBackgroundUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return trimmed;
}

export async function getChatBackground(): Promise<ChatBackgroundDTO> {
  const row = await prisma.user.findUnique({
    where: { clientId: CHAT_BACKGROUND_CLIENT_ID },
    select: {
      profilePicture: true,
      status: true,
      lastSeenAt: true,
    },
  });

  if (!row) {
    return {
      url: null,
      updatedAt: null,
      updatedBy: null,
    };
  }

  return {
    url: normalizeBackgroundUrl(row.profilePicture),
    updatedAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    updatedBy: row.status || null,
  };
}

export async function setChatBackground(input: {
  clientId: string;
  url?: string | null;
}): Promise<ChatBackgroundDTO> {
  const actor = await getUserByClientId(input.clientId);
  const normalizedUrl = normalizeBackgroundUrl(input.url);

  if (normalizedUrl) {
    // Validate upload URL / external URL format.
    new URL(normalizedUrl);
  }

  const now = new Date();
  await prisma.user.upsert({
    where: { clientId: CHAT_BACKGROUND_CLIENT_ID },
    update: {
      username: CHAT_BACKGROUND_USERNAME,
      profilePicture: normalizedUrl || "",
      status: actor.username,
      isOnline: false,
      lastSeenAt: now,
    },
    create: {
      clientId: CHAT_BACKGROUND_CLIENT_ID,
      username: CHAT_BACKGROUND_USERNAME,
      profilePicture: normalizedUrl || "",
      status: actor.username,
      isOnline: false,
      lastSeenAt: now,
    },
  });

  return {
    url: normalizedUrl,
    updatedAt: now.toISOString(),
    updatedBy: actor.username,
  };
}

async function getMessageRows(): Promise<MessageRow[]> {
  return prisma.message.findMany({
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
    orderBy: [{ createdAt: "asc" }],
  });
}

function clampMessageLimit(limit: number | undefined): number {
  const safeLimit = Number.isFinite(limit) ? Number(limit) : DEFAULT_MESSAGE_PAGE_LIMIT;
  return Math.min(MAX_MESSAGE_PAGE_LIMIT, Math.max(1, safeLimit));
}

async function getPagedMessageRows(input: {
  limit?: number;
  before?: Date;
  after?: Date;
}): Promise<{ rows: MessageRow[]; hasMore: boolean }> {
  const limit = clampMessageLimit(input.limit);

  if (input.after) {
    const rows = await prisma.message.findMany({
      where: { createdAt: { gt: input.after } },
      include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
      orderBy: [{ createdAt: "asc" }],
      take: limit + 1,
    });
    return {
      rows: rows.slice(0, limit),
      hasMore: rows.length > limit,
    };
  }

  if (input.before) {
    const rows = await prisma.message.findMany({
      where: { createdAt: { lt: input.before } },
      include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
      orderBy: [{ createdAt: "desc" }],
      take: limit + 1,
    });
    return {
      rows: rows.slice(0, limit).reverse(),
      hasMore: rows.length > limit,
    };
  }

  const rows = await prisma.message.findMany({
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
    orderBy: [{ createdAt: "desc" }],
    take: limit + 1,
  });

  return {
    rows: rows.slice(0, limit).reverse(),
    hasMore: rows.length > limit,
  };
}

function publishAiStatus(status: string): void {
  aiStatusState = {
    status,
    updatedAt: new Date().toISOString(),
  };
  publish("ai.status", { status });
  void persistAiStatusToDatabase(aiStatusState);
}

async function persistAiStatusToDatabase(payload: AiStatusDTO): Promise<void> {
  try {
    await prisma.user.upsert({
      where: { clientId: AI_STATUS_CLIENT_ID },
      update: {
        username: AI_STATUS_USERNAME,
        profilePicture: chatgptProfilePicture.src,
        status: payload.status,
        isOnline: false,
        lastSeenAt: new Date(payload.updatedAt),
      },
      create: {
        clientId: AI_STATUS_CLIENT_ID,
        username: AI_STATUS_USERNAME,
        profilePicture: chatgptProfilePicture.src,
        status: payload.status,
        isOnline: false,
        lastSeenAt: new Date(payload.updatedAt),
      },
    });
  } catch (error) {
    console.error("Failed to persist AI status:", error);
  }
}

interface AiTriggerPayload {
  username: string;
  message: string;
  imageUrls: string[];
}

type AiInputMode = "full" | "minimal";

function stripChatGptMention(message: string): string {
  return message.replace(/(^|\s)@chatgpt\b/gi, " ").replace(/\s+/g, " ").trim();
}

function normalizeAiImageUrlCandidate(url: string): string {
  return url.trim().replace(/[),.!?;:]+$/, "");
}

function isAiImageUrl(url: string): boolean {
  const normalized = normalizeAiImageUrlCandidate(url);
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(normalized)
    || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(normalized);
}

function extractImageUrlsForAi(message: string): string[] {
  const unique = new Set<string>();

  const markdownRegex = /!\[[^\]]*]\(([^)]+)\)/g;
  for (const match of message.matchAll(markdownRegex)) {
    const rawUrl = match[1];
    if (!rawUrl) continue;
    const normalized = normalizeAiImageUrlCandidate(rawUrl);
    if (!normalized) continue;
    unique.add(normalized);
  }

  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  for (const match of message.matchAll(urlRegex)) {
    const rawUrl = match[1];
    if (!rawUrl) continue;
    const normalized = normalizeAiImageUrlCandidate(rawUrl);
    if (!normalized || !isAiImageUrl(normalized)) continue;
    unique.add(normalized);
  }

  return [...unique].slice(0, 4);
}

function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function sanitizeMessageForAi(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "[image]")
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[inline-image]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\s+/g, " ")
    .trim();
}

function isContextWindowError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const text = error.message.toLowerCase();
  return text.includes("context window")
    || (text.includes("input") && text.includes("exceeds"));
}

async function buildAiInput(
  payload: AiTriggerPayload,
  mode: AiInputMode,
): Promise<Array<{ role: "user"; content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" }> }>> {
  const isMinimal = mode === "minimal";
  const recentMessages = await prisma.message.findMany({
    take: isMinimal ? AI_CONTEXT_RECENT_MESSAGES_MINIMAL : AI_CONTEXT_RECENT_MESSAGES,
    orderBy: [{ createdAt: "desc" }],
    select: {
      authorName: true,
      content: true,
      type: true,
    },
  });

  const maxContextChars = isMinimal ? AI_CONTEXT_CHARS_MINIMAL : AI_CONTEXT_CHARS;
  const maxLineChars = isMinimal ? AI_LINE_CHARS_MINIMAL : AI_LINE_CHARS;
  const contextLines: string[] = [];
  let contextLength = 0;

  const preparedLines = recentMessages
    .reverse()
    .filter((row) => row.authorName !== "System" && row.type !== MessageType.ANSWER)
    .map((row) => {
      const safeContent = clampText(sanitizeMessageForAi(row.content), maxLineChars);
      return `${row.authorName}: ${safeContent}`;
    });

  for (const line of preparedLines) {
    const projectedLength = contextLength + line.length + 1;
    if (projectedLength > maxContextChars) {
      break;
    }
    contextLines.push(line);
    contextLength = projectedLength;
  }

  const recentContext = contextLines.join("\n");

  const cleanedPrompt = stripChatGptMention(payload.message);
  const userPrompt = clampText(
    sanitizeMessageForAi(cleanedPrompt || "Please help with the latest message in this chat."),
    isMinimal ? AI_USER_PROMPT_CHARS_MINIMAL : AI_USER_PROMPT_CHARS,
  );
  const hasImageInputs = payload.imageUrls.length > 0;
  const composedPrompt = [
    "You are ChatGPT in a classroom group chat. Keep answers clear and concise.",
    hasImageInputs
      ? "The user attached image input(s). If asked to generate an image, treat these as edit/reference images."
      : "",
    recentContext ? `Recent chat context:\n${recentContext}` : "",
    `Current request from ${payload.username}: ${userPrompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" }> = [
    {
      type: "input_text",
      text: clampText(composedPrompt, isMinimal ? AI_REQUEST_CHARS_MINIMAL : AI_REQUEST_CHARS),
    },
    ...payload.imageUrls.map((imageUrl) => ({
      type: "input_image" as const,
      image_url: imageUrl,
      detail: "auto" as const,
    })),
  ];

  return [
    {
      role: "user",
      content,
    },
  ];
}

async function persistGeneratedImage(base64Image: string, imageIndex: number): Promise<string | null> {
  const normalized = base64Image.trim().replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0) {
    return null;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const path = `chatgpt/${Date.now()}-${imageIndex}.png`;
    const blob = await put(path, bytes, {
      access: "public",
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: AI_IMAGE_MIME_TYPE,
    });
    return blob.url;
  }

  if (bytes.length > MAX_INLINE_AI_IMAGE_BYTES) {
    return null;
  }

  return `data:${AI_IMAGE_MIME_TYPE};base64,${normalized}`;
}

async function emitAiResponse(payload: AiTriggerPayload): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;

  publishAiStatus("thinking…");

  try {
    const openAiConfig = getChatOpenAiConfig();
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const tools: NonNullable<Parameters<typeof openai.responses.create>[0]["tools"]> = [];

    if (openAiConfig.webSearch.enabled) {
      tools.push({
        type: "web_search",
        user_location: {
          type: "approximate",
          country: openAiConfig.webSearch.country,
          region: openAiConfig.webSearch.region,
          city: openAiConfig.webSearch.city,
        },
        search_context_size: openAiConfig.webSearch.contextSize,
      });
    }

    if (openAiConfig.imageGeneration.enabled) {
      tools.push({
        type: "image_generation",
        background: openAiConfig.imageGeneration.background,
        model: openAiConfig.imageGeneration.model,
        moderation: openAiConfig.imageGeneration.moderation,
        output_compression: openAiConfig.imageGeneration.outputCompression,
        output_format: openAiConfig.imageGeneration.outputFormat,
        quality: openAiConfig.imageGeneration.quality,
        size: openAiConfig.imageGeneration.size,
      });
    }

    const include: NonNullable<Parameters<typeof openai.responses.create>[0]["include"]> = [];
    if (openAiConfig.includeEncryptedReasoning) {
      include.push("reasoning.encrypted_content");
    }
    if (openAiConfig.includeWebSources) {
      include.push("web_search_call.action.sources");
    }

    const buildRequest = async (mode: AiInputMode): Promise<Parameters<typeof openai.responses.create>[0]> => ({
      ...(openAiConfig.promptId
        ? {
          prompt: {
            id: openAiConfig.promptId,
            version: openAiConfig.promptVersion,
          },
        }
        : {
          model: openAiConfig.fallbackModel,
        }),
      input: await buildAiInput(payload, mode),
      text: {
        format: {
          type: "text",
        },
      },
      reasoning: {},
      ...(tools.length > 0 ? { tools } : {}),
      store: openAiConfig.store,
      ...(include.length > 0 ? { include } : {}),
    });

    let response: OpenAIResponse;
    try {
      response = (await openai.responses.create(await buildRequest("full"))) as OpenAIResponse;
    } catch (error) {
      if (!isContextWindowError(error)) {
        throw error;
      }
      response = (await openai.responses.create(await buildRequest("minimal"))) as OpenAIResponse;
    }

    const hasImageOutput = Array.isArray(response.output)
      && response.output.some((item) => item.type === "image_generation_call");
    if (hasImageOutput) {
      publishAiStatus("creating image…");
    }

    const imageMarkdown: string[] = [];
    if (Array.isArray(response.output)) {
      let imageIndex = 0;
      for (const item of response.output) {
        if (item.type === "image_generation_call" && typeof item.result === "string") {
          const imageUrl = await persistGeneratedImage(item.result, imageIndex);
          imageIndex += 1;
          if (imageUrl) {
            imageMarkdown.push(`![Generated Image ${imageIndex}](${imageUrl})`);
          } else {
            imageMarkdown.push(
              "_(Image generated but could not be attached. Configure BLOB_READ_WRITE_TOKEN for hosted AI images.)_",
            );
          }
        }
      }
    }

    const text = [response.output_text?.trim() || "", ...imageMarkdown].filter(Boolean).join("\n\n").trim();

    // Always acknowledge a mention, even when the model returns empty output.
    if (!text || text === "[NO_RESPONSE]") {
      publishAiStatus("writing…");

      const fallback = await prisma.message.create({
        data: {
          type: MessageType.MESSAGE,
          content: "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal.",
          authorName: "ChatGPT",
          authorProfilePicture: chatgptProfilePicture.src,
        },
        include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
      });
      invalidateMediaCache();
      publish("message.created", mapMessage(fallback));
      return;
    }

    publishAiStatus("writing…");

    const created = await prisma.message.create({
      data: {
        type: MessageType.MESSAGE,
        content: text,
        authorName: "ChatGPT",
        authorProfilePicture: chatgptProfilePicture.src,
      },
      include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
    });

    invalidateMediaCache();
    publish("message.created", mapMessage(created));
  } catch (error) {
    console.error("OpenAI error:", error);
    const errorText = isContextWindowError(error)
      ? "Die Anfrage war zu lang. Bitte formuliere deine Frage etwas kürzer und versuche es erneut."
      : error instanceof Error
        ? `OpenAI request failed: ${error.message}`
        : "OpenAI request failed.";
    const created = await prisma.message.create({
      data: {
        type: MessageType.MESSAGE,
        content: errorText,
        authorName: "ChatGPT",
        authorProfilePicture: chatgptProfilePicture.src,
      },
      include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
    });
    invalidateMediaCache();
    publish("message.created", mapMessage(created));
  } finally {
    publishAiStatus("online");
  }
}

async function maybeRespondAsAi(payload: AiTriggerPayload): Promise<void> {
  await emitAiResponse(payload);
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

export async function getMessages(input: {
  limit?: number;
  before?: Date;
  after?: Date;
} = {}): Promise<MessagePageDTO> {
  const page = await getPagedMessageRows(input);
  return {
    messages: page.rows.map(mapMessage),
    hasMore: page.hasMore,
  };
}

function normalizeMediaCandidate(raw: string): string {
  return raw.trim().replace(/[),.!?;:]+$/, "");
}

function isMediaCandidate(url: string): boolean {
  return url.startsWith("data:image/") || IMAGE_URL_REGEX.test(url);
}

function clampMediaLimit(limit: number | undefined): number {
  const safeLimit = Number.isFinite(limit) ? Number(limit) : DEFAULT_MEDIA_PAGE_LIMIT;
  return Math.min(MAX_MEDIA_PAGE_LIMIT, Math.max(1, safeLimit));
}

function parseMediaCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function invalidateMediaCache(): void {
  mediaItemsCache = null;
}

async function getAllMediaItemsCached(): Promise<MediaItemDTO[]> {
  const now = Date.now();
  const latestMessage = await prisma.message.findFirst({
    select: { createdAt: true },
    orderBy: [{ createdAt: "desc" }],
  });
  const latestMessageAt = latestMessage?.createdAt?.toISOString() ?? null;

  if (
    mediaItemsCache
    && mediaItemsCache.expiresAt > now
    && mediaItemsCache.latestMessageAt === latestMessageAt
  ) {
    return mediaItemsCache.items;
  }

  const rows = await prisma.message.findMany({
    select: {
      id: true,
      content: true,
      authorName: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const seen = new Set<string>();
  const items: MediaItemDTO[] = [];

  for (const row of rows) {
    const markdownMatches = [...row.content.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)];
    for (const match of markdownMatches) {
      const rawUrl = match[1];
      if (!rawUrl) continue;
      const normalized = normalizeMediaCandidate(rawUrl);
      if (!normalized || !isMediaCandidate(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      items.push({
        id: `${row.id}-${items.length}`,
        url: normalized,
        username: row.authorName,
        createdAt: row.createdAt.toISOString(),
      });
    }

    const urlMatches = row.content.match(/https?:\/\/[^\s]+/gi) || [];
    for (const rawUrl of urlMatches) {
      const normalized = normalizeMediaCandidate(rawUrl);
      if (!normalized || !isMediaCandidate(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      items.push({
        id: `${row.id}-${items.length}`,
        url: normalized,
        username: row.authorName,
        createdAt: row.createdAt.toISOString(),
      });
    }
  }

  mediaItemsCache = {
    items,
    expiresAt: now + MEDIA_CACHE_TTL_MS,
    latestMessageAt,
  };

  return items;
}

export async function getMediaItems(input: {
  limit?: number;
  cursor?: string | null;
} = {}): Promise<MediaPageDTO> {
  const limit = clampMediaLimit(input.limit);
  const offset = parseMediaCursor(input.cursor);
  const allItems = await getAllMediaItemsCached();
  const pageItems = allItems.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < allItems.length;

  return {
    items: pageItems,
    hasMore,
    nextCursor: hasMore ? String(nextOffset) : null,
    total: allItems.length,
  };
}

export async function loginUser(input: {
  username: string;
  clientId: string;
  profilePicture?: string;
}): Promise<LoginResponseDTO> {
  const requestedUsername = input.username.trim();
  assert(requestedUsername.length >= 3, "Username must be at least 3 characters", 400);
  const devMode = isDevUnlockUsername(requestedUsername);
  const username = devMode ? await resolveDeveloperUsername(input.clientId) : requestedUsername;

  await cleanupOfflineUsers();
  if (!devMode) {
    await assertUsernameAllowed(username);
  }
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

  let devAuthToken: string | undefined;
  if (devMode) {
    devAuthToken = issueDevAuthToken(user.clientId) ?? undefined;
    assert(devAuthToken, "Developer mode is not configured on this server.", 500);
  }

  return {
    ...dto,
    devMode,
    devAuthToken,
  };
}

export async function renameUser(input: {
  clientId: string;
  newUsername?: string;
  profilePicture?: string;
}): Promise<UserPresenceDTO> {
  const currentUser = await getUserByClientId(input.clientId);
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

  if (newUsername && currentUser.username !== newUsername) {
    await emitSystemMessage(`${currentUser.username} is now ${newUsername}`);
  }

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
  assert(user, "User session not found. Please login again.", 401);

  const offlineUser = await prisma.user.update({
    where: { clientId: input.clientId },
    data: { isOnline: false, status: "", lastSeenAt: new Date() },
  });

  // Best effort delete to free old session rows when possible.
  try {
    await prisma.user.delete({ where: { clientId: input.clientId } });
  } catch (error) {
    console.error("Failed to delete user row on explicit logout:", error);
  }

  const dto = mapUser(offlineUser);
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
      content = "Mention @chatgpt for AI, plus /roll, /coin, and polls with up to 15 options.";
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
      pollAllowVoteChange: true,
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
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
  });

  invalidateMediaCache();
  const dto = mapMessage(created);
  publish("message.created", dto);

  const shouldTriggerAi =
    type === MessageType.MESSAGE &&
    !message.startsWith("/roll") &&
    !message.startsWith("/coin") &&
    !message.startsWith("/help") &&
    /(^|\s)@chatgpt\b/i.test(message);

  if (shouldTriggerAi) {
    void maybeRespondAsAi({
      username: user.username,
      message,
      imageUrls: extractImageUrlsForAi(message),
    }).catch((error) => {
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
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
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
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
  });

  const dto = mapMessage(updated);
  publish("poll.updated", dto);
  return dto;
}

async function assertDeveloperMode(input: { clientId: string; devAuthToken: string }) {
  const tokenValid = verifyDevAuthToken(input.devAuthToken, input.clientId);
  assert(tokenValid, "Developer mode authentication failed. Login again with the 16-digit code.", 403);

  const user = await getUserByClientId(input.clientId);
  return user;
}

async function getAdminOverviewInternal(): Promise<AdminOverviewDTO> {
  const [usersTotal, usersOnline, messagesTotal, pollsTotal, blacklistTotal] = await Promise.all([
    prisma.user.count({
      where: {
        clientId: {
          notIn: [...SYSTEM_CLIENT_IDS],
        },
      },
    }),
    prisma.user.count({
      where: {
        isOnline: true,
        clientId: {
          notIn: [...SYSTEM_CLIENT_IDS],
        },
      },
    }),
    prisma.message.count(),
    prisma.message.count({
      where: { type: MessageType.VOTING_POLL },
    }),
    prisma.blacklistEntry.count(),
  ]);

  return {
    usersTotal,
    usersOnline,
    messagesTotal,
    pollsTotal,
    blacklistTotal,
  };
}

export async function getAdminOverview(input: { clientId: string; devAuthToken: string }): Promise<AdminOverviewDTO> {
  await assertDeveloperMode(input);
  return getAdminOverviewInternal();
}

export async function runAdminAction(input: AdminActionRequest): Promise<AdminActionResponse> {
  const actor = await assertDeveloperMode(input);
  const action = input.action;
  let message = "Action completed.";

  if (action === "reset_all") {
    await prisma.$transaction([
      prisma.pollChoiceVote.deleteMany({}),
      prisma.pollVote.deleteMany({}),
      prisma.pollOption.deleteMany({}),
      prisma.message.deleteMany({}),
      prisma.blacklistEntry.deleteMany({}),
      prisma.user.deleteMany({
        where: { clientId: { not: actor.clientId } },
      }),
      prisma.user.update({
        where: { clientId: actor.clientId },
        data: { isOnline: true, status: "", lastSeenAt: new Date() },
      }),
    ]);
    invalidateMediaCache();

    await emitSystemMessage(`${actor.username} reset the chat data`);
    message = "Everything was reset.";
  }

  if (action === "delete_all_messages") {
    await prisma.$transaction([
      prisma.pollChoiceVote.deleteMany({}),
      prisma.pollVote.deleteMany({}),
      prisma.pollOption.deleteMany({}),
      prisma.message.deleteMany({}),
    ]);
    invalidateMediaCache();
    await emitSystemMessage(`${actor.username} cleared all messages`);
    message = "All messages were deleted.";
  }

  if (action === "logout_all_users") {
    await prisma.user.deleteMany({
      where: {
        clientId: {
          notIn: [actor.clientId, ...SYSTEM_CLIENT_IDS],
        },
      },
    });
    await emitSystemMessage(`${actor.username} logged out all users`);
    message = "All other users were logged out.";
  }

  if (action === "clear_blacklist") {
    await prisma.blacklistEntry.deleteMany({});
    message = "Blacklist was cleared.";
  }

  if (action === "delete_user") {
    const targetUsername = input.targetUsername?.trim();
    assert(targetUsername, "targetUsername is required for delete_user", 400);

    const target = await prisma.user.findFirst({
      where: {
        username: {
          equals: targetUsername,
          mode: "insensitive",
        },
      },
    });
    assert(target, "Target user not found", 404);
    assert(target.clientId !== actor.clientId, "You cannot delete your own active admin session.", 400);

    await prisma.user.delete({
      where: { id: target.id },
    });
    await emitSystemMessage(`${target.username} was removed by ${actor.username}`);
    message = `Deleted user ${target.username}.`;
  }

  if (action === "delete_message") {
    const targetMessageId = input.targetMessageId?.trim();
    assert(targetMessageId, "targetMessageId is required for delete_message", 400);

    const target = await prisma.message.findUnique({
      where: { id: targetMessageId },
      select: { id: true },
    });
    assert(target, "Target message not found", 404);

    await prisma.message.delete({
      where: { id: target.id },
    });
    invalidateMediaCache();
    message = `Deleted message ${target.id}.`;
  }

  const overview = await getAdminOverviewInternal();
  return {
    ok: true,
    message,
    overview,
  };
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
