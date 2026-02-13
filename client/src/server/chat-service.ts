import { AiJobStatus, MessageType, Prisma } from "@prisma/client";
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
import grokProfilePicture from "@/resources/grokAvatar.png";

const PRESENCE_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const MAX_MESSAGE_PAGE_LIMIT = 100;
const AI_IMAGE_MIME_TYPE = "image/png";
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
const AI_QUEUE_CONCURRENCY = 2;
const AI_QUEUE_MAX_PENDING = 40;
const AI_QUEUE_MAX_ATTEMPTS = 4;
const AI_QUEUE_STALE_PROCESSING_MS = 2 * 60 * 1_000;
const AI_BUSY_NOTICE_COOLDOWN_MS = 5_000;

type AiProvider = "chatgpt" | "grok";

interface GrokRuntimeConfig {
  apiKey?: string;
  baseUrl: string;
  textModel: string;
}

const AI_PROVIDER_MENTION_REGEX: Record<AiProvider, RegExp> = {
  chatgpt: /(^|\s)@chatgpt\b/i,
  grok: /(^|\s)@grok\b/i,
};

const AI_PROVIDER_DISPLAY_NAME: Record<AiProvider, string> = {
  chatgpt: "ChatGPT",
  grok: "Grok",
};

const AI_PROVIDER_AVATAR: Record<AiProvider, string> = {
  chatgpt: chatgptProfilePicture.src,
  grok: grokProfilePicture.src,
};

const AI_PROVIDER_IMAGE_PATH_PREFIX: Record<AiProvider, string> = {
  chatgpt: "chatgpt",
  grok: "grok",
};

const GROK_GROUP_CHAT_PERSONA_PROMPT = [
  "Adopt a casual group chat persona who blends in by mirroring each participant's writing style, leaning toward easy, slightly lazy phrasing and dry wit.",
  "- Use simple, relaxed, sometimes grammatically loose phrasing. Avoid formal or try-hard language.",
  "- Respond candidly and unfiltered, but keep tone deadpan and controlled: unhinged is fine, loud/angry/shouty is not.",
  "- Dry, dark humor is welcome. Sarcasm, playful insults, low-effort jokes, and occasional swearing are allowed when contextually appropriate.",
  "- If arguments happen, take a ruthless debating stance and dismantle weak points with sharp wit and facts.",
  "- Group context: assume adults (18+). Minimal offense tolerance is expected, but avoid illegal, unsafe, coercive, hate-based, or exploitative content.",
  "- Sexual content is allowed for consenting adults only. Never include minors, coercion, or illegal sexual content.",
  "- Mirror rhythm, meme usage, and slang level of the current chat. If uncertain, default to terse, dry, slightly irreverent phrasing.",
  "- Do not use emojis or over-the-top reactions unless the chat itself does.",
  "- Maintain relaxed, no-holds-barred camaraderie.",
  "",
  "Edge cases:",
  "- If style is inconsistent, default to easy-going, dry, slightly jaded phrasing.",
  "- If unsure, pick minimal effort, maximum effect: short, deadpan, dismissive.",
  "",
  "Always prioritize the group's existing style. Riff off their energy; do not overdo or underdo the banter.",
].join("\n");

function hasOpenAiApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function hasGrokApiKey(): boolean {
  return Boolean(process.env.GROK_API_KEY?.trim());
}

function hasAnyAiProviderApiKey(): boolean {
  return hasOpenAiApiKey() || hasGrokApiKey();
}

function getAiProviderDisplayName(provider: AiProvider): string {
  return AI_PROVIDER_DISPLAY_NAME[provider];
}

function getAiProviderAvatar(provider: AiProvider): string {
  return AI_PROVIDER_AVATAR[provider];
}

function getAiProviderMention(provider: AiProvider): string {
  return provider === "grok" ? "@grok" : "@chatgpt";
}

function getEnvTrimmed(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function getGrokRuntimeConfig(): GrokRuntimeConfig {
  return {
    apiKey: getEnvTrimmed("GROK_API_KEY"),
    baseUrl: getEnvTrimmed("GROK_BASE_URL") ?? "https://api.x.ai/v1",
    textModel: getEnvTrimmed("GROK_MODEL") ?? "grok-4-1-fast-non-reasoning",
  };
}

function isProviderConfigured(provider: AiProvider): boolean {
  if (provider === "grok") return hasGrokApiKey();
  return hasOpenAiApiKey();
}

function detectAiProviders(message: string): AiProvider[] {
  const chatgptIndex = message.search(AI_PROVIDER_MENTION_REGEX.chatgpt);
  const grokIndex = message.search(AI_PROVIDER_MENTION_REGEX.grok);
  const indices = [
    { provider: "chatgpt" as const, index: chatgptIndex },
    { provider: "grok" as const, index: grokIndex },
  ].filter((entry) => entry.index >= 0);

  if (indices.length === 0) return [];
  return indices.sort((a, b) => a.index - b.index).map((entry) => entry.provider);
}

function isAiDisplayName(username: string): boolean {
  const normalized = username.trim().toLowerCase();
  return Object.values(AI_PROVIDER_DISPLAY_NAME).some((name) => name.trim().toLowerCase() === normalized);
}

function fallbackStatusForProvider(provider: AiProvider): string {
  return isProviderConfigured(provider) ? "online" : "offline";
}

let aiStatusState: AiStatusDTO = {
  chatgpt: fallbackStatusForProvider("chatgpt"),
  grok: fallbackStatusForProvider("grok"),
  updatedAt: new Date().toISOString(),
};

let aiQueueDrainScheduled = false;
let lastAiBusyNoticeAt = 0;

let mediaItemsCache:
  | {
    expiresAt: number;
    latestMessageAt: string | null;
    items: MediaItemDTO[];
  }
  | null = null;

function getBlobReadWriteToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB;
}

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
    throw new AppError("Dieser Benutzername ist nicht erlaubt", 403);
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
    throw new AppError("Dieser Benutzername ist bereits vergeben", 409);
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

    await emitSystemMessage(`${user.username} hat den Chat verlassen`);
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
  if (!hasAnyAiProviderApiKey()) {
    return {
      chatgpt: "offline",
      grok: "offline",
      updatedAt: new Date().toISOString(),
    };
  }

  const persisted = await prisma.user.findUnique({
    where: { clientId: AI_STATUS_CLIENT_ID },
    select: {
      status: true,
      lastSeenAt: true,
    },
  });

  return {
    chatgpt: hasOpenAiApiKey() ? persisted?.status || aiStatusState.chatgpt : "offline",
    grok: hasGrokApiKey() ? aiStatusState.grok : "offline",
    updatedAt: persisted?.lastSeenAt?.toISOString() || aiStatusState.updatedAt,
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
  const existingBackground = await prisma.user.findUnique({
    where: { clientId: CHAT_BACKGROUND_CLIENT_ID },
    select: { profilePicture: true },
  });
  const previousBackground = normalizeBackgroundUrl(existingBackground?.profilePicture);

  if (normalizedUrl) {
    // Validate upload URL / external URL format.
    new URL(normalizedUrl);
    assert(!normalizedUrl.toLowerCase().startsWith("data:"), "Hintergrund darf keine data-URL sein", 400);
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

  if (normalizedUrl && normalizedUrl !== previousBackground) {
    await emitSystemMessage(`${actor.username} hat das Hintergrundbild geändert`);
  } else if (!normalizedUrl && previousBackground) {
    await emitSystemMessage(`${actor.username} hat das Hintergrundbild zurückgesetzt`);
  }

  const result: ChatBackgroundDTO = {
    url: normalizedUrl,
    updatedAt: now.toISOString(),
    updatedBy: actor.username,
  };
  publish("chat.background.updated", result);
  return result;
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

function publishAiStatus(provider: AiProvider, status: string): void {
  aiStatusState = {
    ...aiStatusState,
    [provider]: status,
    updatedAt: new Date().toISOString(),
  };
  publish("ai.status", { status, provider });
  void persistAiStatusToDatabase(aiStatusState);
}

async function persistAiStatusToDatabase(payload: AiStatusDTO): Promise<void> {
  try {
    await prisma.user.upsert({
      where: { clientId: AI_STATUS_CLIENT_ID },
      update: {
        username: AI_STATUS_USERNAME,
        profilePicture: chatgptProfilePicture.src,
        status: payload.chatgpt,
        isOnline: false,
        lastSeenAt: new Date(payload.updatedAt),
      },
      create: {
        clientId: AI_STATUS_CLIENT_ID,
        username: AI_STATUS_USERNAME,
        profilePicture: chatgptProfilePicture.src,
        status: payload.chatgpt,
        isOnline: false,
        lastSeenAt: new Date(payload.updatedAt),
      },
    });
  } catch (error) {
    console.error("Failed to persist AI status:", error);
  }
}

interface AiTriggerPayload {
  provider: AiProvider;
  sourceMessageId: string;
  username: string;
  message: string;
  imageUrls: string[];
}

type AiInputMode = "full" | "minimal";

function stripAiMentions(message: string): string {
  return message.replace(/(^|\s)@(chatgpt|grok)\b/gi, " ").replace(/\s+/g, " ").trim();
}

function stripLeadingAiMentions(message: string): string {
  return message.replace(/^\s*(?:@(chatgpt|grok)\b[\s,;:.-]*)+/i, "").trimStart();
}

const WEB_SEARCH_HINT_REGEX =
  /\b(aktuell|aktuelle|aktuellen|heute|gestern|morgen|neueste|neuester|news|nachrichten|latest|today|current|preis|kurse?|wetter|temperatur|score|standings?|spielplan|breaking|diese woche|this week|dieses jahr|this year|202\d)\b/i;
const IMAGE_GENERATION_ACTION_REGEX =
  /\b(remix|remixe|bearbeite|edit|editiere|modify|modified|change|alter|transform|convert|replace|remove|add|zeichne|draw|render|erstelle|generiere|generate|create|male|paint|illustrate|design|upscale|enhance|improve|verbessere|optimiere|stylize|style|apply|make|set|turn)\b/i;
const IMAGE_GENERATION_NOUN_REGEX =
  /\b(image|images|bild|bilder|grafik|illustration|photo|foto|picture|pictures|pic|drawing|drawings|art|artwork|poster|logo|wallpaper|meme|avatar|thumbnail)\b/i;
const IMAGE_GENERATION_CONTEXT_REGEX =
  /\b(scene|character|monster|animal|portrait|landscape|banner|cover|icon)\b/i;
const IMAGE_ANALYSIS_HINT_REGEX =
  /\b(describe|what(?:'s| is)|analy[sz]e|caption|explain|identify|erkenne|beschreibe|was ist|what do you see|ocr|read text)\b/i;

function shouldUseWebSearchTool(message: string): boolean {
  return WEB_SEARCH_HINT_REGEX.test(message);
}

function shouldUseImageGenerationTool(
  message: string,
  imageInputCount: number,
): boolean {
  const hasActionHint = IMAGE_GENERATION_ACTION_REGEX.test(message);
  const hasImageNoun = IMAGE_GENERATION_NOUN_REGEX.test(message);
  const hasImageContext = IMAGE_GENERATION_CONTEXT_REGEX.test(message);
  const hasAnalysisHint = IMAGE_ANALYSIS_HINT_REGEX.test(message);

  if (imageInputCount > 0) {
    if (hasAnalysisHint && !hasActionHint && !hasImageNoun) {
      return false;
    }

    if (hasActionHint || hasImageNoun) {
      return true;
    }

    return false;
  }

  if (hasActionHint && hasImageNoun) {
    return true;
  }

  return hasImageNoun && hasImageContext;
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

function stripInlineImageMarkdownAndUrls(text: string): string {
  if (!text) return "";

  const lines = text.split("\n");
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;

    if (/^!\[[^\]]*]\([^)]+\)$/.test(trimmed)) {
      return false;
    }

    if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(trimmed)) {
      return false;
    }

    return true;
  });

  return kept.join("\n").trim();
}

interface AiPollPayload {
  question: string;
  options: string[];
  multiSelect: boolean;
}

const AI_POLL_BLOCK_REGEX = /<POLL_JSON>([\s\S]*?)<\/POLL_JSON>/gi;
const AI_POLL_OPTION_LINE_REGEX = /^\s*(?:\d{1,2}[.)]|[-*])\s+(.+)$/;
const AI_POLL_HINT_REGEX = /\b(umfrage|survey|poll|abstimmen|vote|voting)\b/i;

function normalizePollText(value: string): string {
  return value
    .trim()
    .replace(/^[-*_`#\s]+/, "")
    .replace(/[-*_`#\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractListPollPayload(rawText: string): AiPollPayload | null {
  const text = stripAiPollBlocks(rawText);
  if (!text || !AI_POLL_HINT_REGEX.test(text)) return null;

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const options: string[] = [];
  let firstOptionIndex = -1;

  lines.forEach((line, index) => {
    const match = line.match(AI_POLL_OPTION_LINE_REGEX);
    if (!match) return;
    if (firstOptionIndex === -1) firstOptionIndex = index;
    const label = normalizePollText(match[1] || "");
    if (label) options.push(label);
  });

  if (options.length < 2 || options.length > 15) return null;
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return null;

  const headingLine = lines.find((line) => AI_POLL_HINT_REGEX.test(line) && !AI_POLL_OPTION_LINE_REGEX.test(line));
  const headingQuestion = headingLine
    ? normalizePollText(headingLine.includes(":") ? headingLine.split(":").slice(1).join(":") : headingLine)
    : "";

  const fallbackQuestion = firstOptionIndex > 0
    ? normalizePollText(lines[firstOptionIndex - 1] || "")
    : "";

  const question = headingQuestion || fallbackQuestion || "Umfrage";
  if (!question) return null;

  const multiSelect = /\b(mehrfach|multiple\s+choice|multi[\s-]?select)\b/i.test(text);
  return { question, options, multiSelect };
}

function stripAiPollBlocks(text: string): string {
  return text.replace(/<POLL_JSON>[\s\S]*?<\/POLL_JSON>/gi, "").trim();
}

function extractAiPollPayload(rawText: string): AiPollPayload | null {
  if (!rawText) return null;

  const matches = [...rawText.matchAll(AI_POLL_BLOCK_REGEX)];
  if (matches.length !== 1) {
    return extractListPollPayload(rawText);
  }

  const jsonPayload = matches[0]?.[1]?.trim();
  if (!jsonPayload) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch {
    return extractListPollPayload(rawText);
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const question = typeof (parsed as { question?: unknown }).question === "string"
    ? (parsed as { question: string }).question.trim()
    : "";
  const optionsRaw = Array.isArray((parsed as { options?: unknown }).options)
    ? (parsed as { options: unknown[] }).options
    : [];
  const multiSelect = typeof (parsed as { multiSelect?: unknown }).multiSelect === "boolean"
    ? (parsed as { multiSelect: boolean }).multiSelect
    : false;

  const options = optionsRaw
    .filter((option): option is string => typeof option === "string")
    .map((option) => option.trim())
    .filter(Boolean);

  if (!question || options.length < 2 || options.length > 15) {
    return extractListPollPayload(rawText);
  }

  const uniqueOptions = new Set(options.map((option) => option.toLowerCase()));
  if (uniqueOptions.size !== options.length) {
    return extractListPollPayload(rawText);
  }

  return {
    question,
    options,
    multiSelect,
  };
}

function isContextWindowError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const text = error.message.toLowerCase();
  return text.includes("context window")
    || (text.includes("input") && text.includes("exceeds"));
}

function isRetryableOpenAiServerError(error: unknown): boolean {
  if (!error) return false;

  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (typeof status === "number" && status >= 500 && status < 600) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const text = error.message.toLowerCase();
  return /\b(500|502|503|504)\b/.test(text)
    || text.includes("an error occurred while processing your request");
}

async function buildAiInput(
  payload: AiTriggerPayload,
  mode: AiInputMode,
  provider: AiProvider,
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

  const cleanedPrompt = stripAiMentions(payload.message);
  const userPrompt = clampText(
    sanitizeMessageForAi(cleanedPrompt || "Bitte hilf bei der neuesten Nachricht in diesem Chat."),
    isMinimal ? AI_USER_PROMPT_CHARS_MINIMAL : AI_USER_PROMPT_CHARS,
  );
  const hasImageInputs = payload.imageUrls.length > 0;
  const providerName = getAiProviderDisplayName(provider);
  const composedPrompt = [
    `Du bist ${providerName} in einem Gruppenchat. Antworte klar, hilfreich und auf Deutsch.`,
    provider === "grok"
      ? `Stilmodus (immer aktiv):\n${GROK_GROUP_CHAT_PERSONA_PROMPT}`
      : "",
    provider === "grok"
      ? "Bildfunktionen für @grok sind deaktiviert. Wenn der User Bildgenerierung oder Bildbearbeitung verlangt, sag kurz, dass er dafür @chatgpt nutzen soll."
      : "Wenn ein Bild gewünscht wird, liefere den Inhalt normal weiter und behaupte nicht, dass du keine Bilder generieren kannst.",
    hasImageInputs
      ? provider === "grok"
        ? "Die Nachricht enthält Bild-Inputs. Nutze sie nur für textliche Analyse/Beschreibung, nicht für Bildgenerierung."
        : "Die Nachricht enthält Bild-Inputs. Falls ein Bild gewünscht ist, nutze sie als Referenz-/Bearbeitungsbilder."
      : "",
    provider === "grok"
      ? "Wenn der User eine Umfrage erstellen will, antworte ausschließlich mit genau einem Block in diesem Format: <POLL_JSON>{\"question\":\"<kurze Frage>\",\"options\":[\"<Option 1>\",\"<Option 2>\"],\"multiSelect\":false}</POLL_JSON>. Kein zusätzlicher Text davor oder danach. JSON muss gültig sein, mit 2 bis 15 eindeutigen Optionen."
      : "",
    recentContext ? `Letzter Chat-Kontext:\n${recentContext}` : "",
    `Aktuelle Anfrage von ${payload.username}: ${userPrompt}`,
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

async function persistGeneratedImage(base64Image: string, imageIndex: number, provider: AiProvider): Promise<string | null> {
  const normalized = base64Image.trim().replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0) {
    return null;
  }

  const blobToken = getBlobReadWriteToken();
  if (!blobToken) {
    return null;
  }

  const path = `${AI_PROVIDER_IMAGE_PATH_PREFIX[provider]}/${Date.now()}-${imageIndex}.png`;
  const blob = await put(path, bytes, {
    access: "public",
    addRandomSuffix: true,
    token: blobToken,
    contentType: AI_IMAGE_MIME_TYPE,
  });
  return blob.url;
}

async function createAiMessage(input: {
  provider: AiProvider;
  sourceMessageId: string;
  content: string;
}): Promise<void> {
  const created = await prisma.message.create({
    data: {
      type: MessageType.MESSAGE,
      content: input.content,
      questionMessageId: input.sourceMessageId,
      authorName: getAiProviderDisplayName(input.provider),
      authorProfilePicture: getAiProviderAvatar(input.provider),
    },
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
  });
  invalidateMediaCache();
  publish("message.created", mapMessage(created));
}

async function createAiPollMessage(input: {
  provider: AiProvider;
  sourceMessageId: string;
  question: string;
  options: string[];
  multiSelect: boolean;
}): Promise<void> {
  const created = await prisma.message.create({
    data: {
      type: MessageType.VOTING_POLL,
      content: input.question,
      questionMessageId: input.sourceMessageId,
      authorName: getAiProviderDisplayName(input.provider),
      authorProfilePicture: getAiProviderAvatar(input.provider),
      optionOne: input.options[0] || null,
      optionTwo: input.options[1] || null,
      pollMultiSelect: input.multiSelect,
      pollAllowVoteChange: true,
      pollLeftCount: 0,
      pollRightCount: 0,
      pollOptions: {
        create: input.options.map((label, sortOrder) => ({
          label,
          sortOrder,
        })),
      },
    },
    include: { questionMessage: true, author: true, pollOptions: { include: { votes: { include: { user: true } } } } },
  });
  invalidateMediaCache();
  publish("message.created", mapMessage(created));
}

async function emitAiBusyNotice(sourceMessageId: string, provider: AiProvider): Promise<void> {
  const now = Date.now();
  if (now - lastAiBusyNoticeAt < AI_BUSY_NOTICE_COOLDOWN_MS) return;
  lastAiBusyNoticeAt = now;
  await createAiMessage({
    provider,
    sourceMessageId,
    content: `Zu viele ${getAiProviderMention(provider)} Anfragen gleichzeitig. Bitte in wenigen Sekunden erneut versuchen.`,
  });
}

async function emitAiResponse(payload: AiTriggerPayload): Promise<void> {
  if (!isProviderConfigured(payload.provider)) return;

  publishAiStatus(payload.provider, "denkt nach…");

  try {
    if (payload.provider === "chatgpt") {
      const openAiConfig = getChatOpenAiConfig();
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    const cleanedMessage = stripAiMentions(payload.message);
    const useWebSearchTool = openAiConfig.webSearch.enabled
      && (!openAiConfig.lowLatencyMode || shouldUseWebSearchTool(cleanedMessage));
    const useImageGenerationTool = openAiConfig.imageGeneration.enabled
      && (!openAiConfig.lowLatencyMode
        || shouldUseImageGenerationTool(cleanedMessage, payload.imageUrls.length));

      const tools: NonNullable<Parameters<typeof openai.responses.create>[0]["tools"]> = [];

      if (useWebSearchTool) {
        tools.push({
          type: "web_search",
          filters: null,
          user_location: {
            type: "approximate",
            country: openAiConfig.webSearch.country,
            region: openAiConfig.webSearch.region,
            city: openAiConfig.webSearch.city,
            timezone: openAiConfig.webSearch.timezone,
          },
          search_context_size: openAiConfig.webSearch.contextSize,
        });
      }

      if (useImageGenerationTool) {
        const imageTool: NonNullable<Parameters<typeof openai.responses.create>[0]["tools"]>[number] = {
          type: "image_generation",
          background: openAiConfig.imageGeneration.background,
          model: openAiConfig.imageGeneration.model,
          moderation: openAiConfig.imageGeneration.moderation,
          output_format: openAiConfig.imageGeneration.outputFormat,
          quality: openAiConfig.imageGeneration.quality,
          size: openAiConfig.imageGeneration.size,
        };
        // The app currently uses non-streaming responses.create calls.
        // partial_images is only accepted by the API with streaming enabled.
        if (openAiConfig.imageGeneration.outputCompression !== undefined) {
          imageTool.output_compression = openAiConfig.imageGeneration.outputCompression;
        }
        tools.push(imageTool);
      }

      const include: NonNullable<Parameters<typeof openai.responses.create>[0]["include"]> = [];
      if (openAiConfig.includeEncryptedReasoning && !openAiConfig.lowLatencyMode) {
        include.push("reasoning.encrypted_content");
      }
      if (openAiConfig.includeWebSources && useWebSearchTool) {
        include.push("web_search_call.action.sources");
      }

      const buildRequest = async (input: {
        mode: AiInputMode;
        imageModelOverride?: string;
        forceFallbackModel?: boolean;
      }): Promise<Parameters<typeof openai.responses.create>[0]> => ({
        ...(!input.forceFallbackModel && openAiConfig.promptId
          ? {
            prompt: {
              id: openAiConfig.promptId,
              version: openAiConfig.promptVersion,
            },
          }
          : {
            model: openAiConfig.fallbackModel,
          }),
        input: await buildAiInput(payload, input.mode, payload.provider),
        text: {
          format: {
            type: "text",
          },
        },
        reasoning: {},
        ...(tools.length > 0
          ? {
            tools: (
              input.imageModelOverride
                ? tools.map((tool) => (tool.type === "image_generation" ? { ...tool, model: input.imageModelOverride } : tool))
                : tools
            ) as NonNullable<Parameters<typeof openai.responses.create>[0]["tools"]>,
          }
          : {}),
        store: openAiConfig.store,
        ...(include.length > 0 ? { include } : {}),
      });

      const requestWithContextFallback = async (input?: {
        imageModelOverride?: string;
        forceFallbackModel?: boolean;
      }): Promise<OpenAIResponse> => {
        try {
          return (await openai.responses.create(await buildRequest({
            mode: "full",
            imageModelOverride: input?.imageModelOverride,
            forceFallbackModel: input?.forceFallbackModel,
          }))) as OpenAIResponse;
        } catch (error) {
          if (!isContextWindowError(error)) {
            throw error;
          }
          return (await openai.responses.create(await buildRequest({
            mode: "minimal",
            imageModelOverride: input?.imageModelOverride,
            forceFallbackModel: input?.forceFallbackModel,
          }))) as OpenAIResponse;
        }
      };

      const requestWithServerRecovery = async (): Promise<OpenAIResponse> => {
        try {
          return await requestWithContextFallback();
        } catch (firstError) {
          if (!isRetryableOpenAiServerError(firstError)) {
            throw firstError;
          }
        }

        // Retry once unchanged for transient OpenAI 5xx failures.
        try {
          return await requestWithContextFallback();
        } catch (retryError) {
          let lastError: unknown = retryError;
          if (!isRetryableOpenAiServerError(retryError)) {
            throw retryError;
          }

          const canFallbackImageModel = useImageGenerationTool && openAiConfig.imageGeneration.model !== "gpt-image-1";
          if (canFallbackImageModel) {
            try {
              return await requestWithContextFallback({ imageModelOverride: "gpt-image-1" });
            } catch (imageModelError) {
              lastError = imageModelError;
            }
          }

          const canFallbackPrompt = Boolean(openAiConfig.promptId);
          if (canFallbackPrompt) {
            try {
              return await requestWithContextFallback({ forceFallbackModel: true });
            } catch (promptFallbackError) {
              lastError = promptFallbackError;
            }
          }

          if (canFallbackImageModel && canFallbackPrompt) {
            try {
              return await requestWithContextFallback({
                imageModelOverride: "gpt-image-1",
                forceFallbackModel: true,
              });
            } catch (finalFallbackError) {
              lastError = finalFallbackError;
            }
          }

          throw lastError;
        }
      };

      const response = await requestWithServerRecovery();

      const hasImageOutput = Array.isArray(response.output)
        && response.output.some((item) => item.type === "image_generation_call");
      if (hasImageOutput) {
        publishAiStatus(payload.provider, "erstellt Bild…");
      }

      const imageMarkdown: string[] = [];
      if (Array.isArray(response.output)) {
        let imageIndex = 0;
        for (const item of response.output) {
          if (item.type === "image_generation_call" && typeof item.result === "string") {
            const imageUrl = await persistGeneratedImage(item.result, imageIndex, payload.provider);
            imageIndex += 1;
            if (imageUrl) {
              imageMarkdown.push(`![Generated Image ${imageIndex}](${imageUrl})`);
            } else {
              imageMarkdown.push(
                "_(Image generated but could not be attached. Configure BLOB_READ_WRITE_TOKEN (or BLOB) for hosted AI images.)_",
              );
            }
          }
        }
      }

      const rawOutputText = stripLeadingAiMentions(response.output_text?.trim() || "");
      const pollPayload = extractAiPollPayload(rawOutputText);
      if (pollPayload) {
        publishAiStatus(payload.provider, "schreibt…");
        await createAiPollMessage({
          provider: payload.provider,
          sourceMessageId: payload.sourceMessageId,
          question: pollPayload.question,
          options: pollPayload.options,
          multiSelect: pollPayload.multiSelect,
        });
        return;
      }

      const outputWithoutPoll = stripAiPollBlocks(rawOutputText);
      const cleanedOutputText = imageMarkdown.length > 0
        ? stripInlineImageMarkdownAndUrls(outputWithoutPoll)
        : outputWithoutPoll;
      const text = [cleanedOutputText, ...imageMarkdown].filter(Boolean).join("\n\n").trim();

      if (!text || text === "[NO_RESPONSE]") {
        publishAiStatus(payload.provider, "schreibt…");
        await createAiMessage({
          provider: payload.provider,
          sourceMessageId: payload.sourceMessageId,
          content: "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal.",
        });
        return;
      }

      publishAiStatus(payload.provider, "schreibt…");
      await createAiMessage({
        provider: payload.provider,
        sourceMessageId: payload.sourceMessageId,
        content: text,
      });
      return;
    }

    const grokConfig = getGrokRuntimeConfig();
    if (!grokConfig.apiKey) {
      throw new Error("GROK_API_KEY fehlt.");
    }
    const cleanedMessage = stripAiMentions(payload.message);
    if (shouldUseImageGenerationTool(cleanedMessage, payload.imageUrls.length)) {
      publishAiStatus(payload.provider, "schreibt…");
      await createAiMessage({
        provider: payload.provider,
        sourceMessageId: payload.sourceMessageId,
        content: "Bildgenerierung und Bildbearbeitung sind für @grok deaktiviert. Nutze dafür bitte @chatgpt.",
      });
      return;
    }

    const grok = new OpenAI({
      apiKey: grokConfig.apiKey,
      baseURL: grokConfig.baseUrl,
    });

    const buildGrokRequest = async (mode: AiInputMode): Promise<Parameters<typeof grok.responses.create>[0]> => ({
      model: grokConfig.textModel,
      input: await buildAiInput(payload, mode, payload.provider),
      text: {
        format: {
          type: "text",
        },
      },
    });

    let response: OpenAIResponse;
    try {
      response = (await grok.responses.create(await buildGrokRequest("full"))) as OpenAIResponse;
    } catch (error) {
      if (!isContextWindowError(error)) {
        throw error;
      }
      response = (await grok.responses.create(await buildGrokRequest("minimal"))) as OpenAIResponse;
    }

    const rawOutputText = stripLeadingAiMentions(response.output_text?.trim() || "");
    const pollPayload = extractAiPollPayload(rawOutputText);
    if (pollPayload) {
      publishAiStatus(payload.provider, "schreibt…");
      await createAiPollMessage({
        provider: payload.provider,
        sourceMessageId: payload.sourceMessageId,
        question: pollPayload.question,
        options: pollPayload.options,
        multiSelect: pollPayload.multiSelect,
      });
      return;
    }

    const text = stripAiPollBlocks(rawOutputText).trim();

    if (!text || text === "[NO_RESPONSE]") {
      publishAiStatus(payload.provider, "schreibt…");
      await createAiMessage({
        provider: payload.provider,
        sourceMessageId: payload.sourceMessageId,
        content: "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal.",
      });
      return;
    }

    publishAiStatus(payload.provider, "schreibt…");
    await createAiMessage({
      provider: payload.provider,
      sourceMessageId: payload.sourceMessageId,
      content: text,
    });
  } catch (error) {
    if (payload.provider === "grok") {
      console.error("Grok error:", error);
    } else {
      console.error("OpenAI error:", error);
    }

    const errorText = isContextWindowError(error)
      ? "Die Anfrage war zu lang. Bitte formuliere deine Frage etwas kürzer und versuche es erneut."
      : error instanceof Error
        ? `${payload.provider === "grok" ? "Grok" : "OpenAI"}-Anfrage fehlgeschlagen: ${error.message}`
        : `${payload.provider === "grok" ? "Grok" : "OpenAI"}-Anfrage fehlgeschlagen.`;

    await createAiMessage({
      provider: payload.provider,
      sourceMessageId: payload.sourceMessageId,
      content: errorText,
    });
  } finally {
    publishAiStatus(payload.provider, fallbackStatusForProvider(payload.provider));
  }
}

function scheduleAiQueueDrain(): void {
  if (aiQueueDrainScheduled) return;
  aiQueueDrainScheduled = true;
  queueMicrotask(() => {
    aiQueueDrainScheduled = false;
    void processAiQueue({ maxJobs: AI_QUEUE_CONCURRENCY }).catch((error) => {
      console.error("AI queue worker error:", error instanceof Error ? error.message : error);
    });
  });
}

type EnqueueAiResult = "queued" | "duplicate" | "full";

interface ClaimedAiJobRow {
  id: string;
  sourceMessageId: string;
  username: string;
  message: string;
  imageUrls: Prisma.JsonValue;
  attempts: number;
}

function parseAiJobImageUrls(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string").slice(0, 4);
}

async function recoverStaleAiJobs(): Promise<void> {
  await prisma.aiJob.updateMany({
    where: {
      status: AiJobStatus.PROCESSING,
      OR: [
        {
          lockedAt: {
            lt: new Date(Date.now() - AI_QUEUE_STALE_PROCESSING_MS),
          },
        },
        {
          lockedAt: null,
        },
      ],
    },
    data: {
      status: AiJobStatus.PENDING,
      runAt: new Date(),
      lockedAt: null,
      lastError: "Recovered stale processing job",
    },
  });
}

async function claimNextAiJob(): Promise<ClaimedAiJobRow | null> {
  const rows = await prisma.$queryRawUnsafe<ClaimedAiJobRow[]>(`
    WITH next_job AS (
      SELECT "id"
      FROM "AiJob"
      WHERE "status" = 'PENDING'::"AiJobStatus"
        AND "runAt" <= NOW()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "AiJob" AS job
    SET
      "status" = 'PROCESSING'::"AiJobStatus",
      "lockedAt" = NOW(),
      "attempts" = job."attempts" + 1,
      "updatedAt" = NOW()
    FROM next_job
    WHERE job."id" = next_job."id"
    RETURNING
      job."id",
      job."sourceMessageId",
      job."username",
      job."message",
      job."imageUrls",
      job."attempts";
  `);

  return rows[0] || null;
}

async function enqueueAiResponse(
  payload: Omit<AiTriggerPayload, "provider">,
): Promise<EnqueueAiResult> {
  const pendingTotal = await prisma.aiJob.count({
    where: {
      status: {
        in: [AiJobStatus.PENDING, AiJobStatus.PROCESSING],
      },
    },
  });

  if (pendingTotal >= AI_QUEUE_MAX_PENDING) {
    return "full";
  }

  try {
    await prisma.aiJob.create({
      data: {
        sourceMessageId: payload.sourceMessageId,
        username: payload.username,
        message: payload.message,
        imageUrls: payload.imageUrls,
        status: AiJobStatus.PENDING,
      },
    });
    return "queued";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "duplicate";
    }
    throw error;
  }
}

export async function processAiQueue(input: { maxJobs?: number } = {}): Promise<{ processed: number; lockSkipped: boolean }> {
  if (!hasAnyAiProviderApiKey()) return { processed: 0, lockSkipped: false };

  await recoverStaleAiJobs();

  const maxJobs = Math.max(1, Math.min(20, input.maxJobs ?? AI_QUEUE_CONCURRENCY));
  let processed = 0;

  while (processed < maxJobs) {
    const job = await claimNextAiJob();
    if (!job) break;

    try {
      const mentionedProviders = detectAiProviders(job.message);
      const providers = mentionedProviders.length > 0 ? mentionedProviders : (["chatgpt"] as const);

      for (const provider of providers) {
        if (!isProviderConfigured(provider)) continue;
        await emitAiResponse({
          provider,
          sourceMessageId: job.sourceMessageId,
          username: job.username,
          message: job.message,
          imageUrls: parseAiJobImageUrls(job.imageUrls),
        });
      }
      await prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: AiJobStatus.COMPLETED,
          completedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const shouldFail = job.attempts >= AI_QUEUE_MAX_ATTEMPTS;
      const retryDelayMs = Math.min(60_000, 3_000 * job.attempts);
      await prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: shouldFail ? AiJobStatus.FAILED : AiJobStatus.PENDING,
          ...(shouldFail ? {} : { runAt: new Date(Date.now() + retryDelayMs) }),
          failedAt: shouldFail ? new Date() : null,
          lockedAt: null,
          lastError: error instanceof Error ? error.message : "Unknown queue error",
        },
      });
    }

    processed += 1;
  }

  const remaining = await prisma.aiJob.count({
    where: {
      status: AiJobStatus.PENDING,
      runAt: { lte: new Date() },
    },
  });
  if (remaining > 0) {
    scheduleAiQueueDrain();
  }

  return { processed, lockSkipped: false };
}

async function maybeRespondAsAi(payload: Omit<AiTriggerPayload, "provider">): Promise<void> {
  const mentionedProviders = detectAiProviders(payload.message);
  if (mentionedProviders.length === 0) return;

  const configuredProviders = mentionedProviders.filter((provider) => isProviderConfigured(provider));
  const unconfiguredProviders = mentionedProviders.filter((provider) => !isProviderConfigured(provider));

  for (const provider of unconfiguredProviders) {
    publishAiStatus(provider, "offline");
    await createAiMessage({
      provider,
      sourceMessageId: payload.sourceMessageId,
      content: `Ich bin aktuell nicht konfiguriert. Bitte ${provider === "grok" ? "GROK_API_KEY" : "OPENAI_API_KEY"} setzen.`,
    });
  }

  if (configuredProviders.length === 0) return;

  const queued = await enqueueAiResponse(payload);
  if (queued === "full") {
    for (const provider of configuredProviders) {
      await emitAiBusyNotice(payload.sourceMessageId, provider);
    }
    return;
  }
  if (queued === "queued") {
    void processAiQueue({ maxJobs: AI_QUEUE_CONCURRENCY })
      .catch((error) => {
        console.error("AI queue kickoff error:", error instanceof Error ? error.message : error);
      });
    scheduleAiQueueDrain();
  }
}

export function __resetAiQueueForTests(): void {
  aiQueueDrainScheduled = false;
  lastAiBusyNoticeAt = 0;
}

export function __extractAiPollPayloadForTests(rawText: string): AiPollPayload | null {
  return extractAiPollPayload(rawText);
}

async function getUserByClientId(clientId: string) {
  const user = await prisma.user.findUnique({ where: { clientId } });
  assert(user, "Nutzersitzung nicht gefunden. Bitte erneut anmelden.", 401);
  return user;
}

export async function getSnapshot(input: { limit?: number } = {}): Promise<SnapshotDTO> {
  const [users, messagePage, aiStatus, background] = await Promise.all([
    getOnlineUsers(),
    getMessages({ limit: input.limit }),
    getAiStatus(),
    getChatBackground(),
  ]);
  return {
    users,
    messages: messagePage.messages,
    aiStatus,
    background,
  };
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
  assert(requestedUsername.length >= 3, "Benutzername muss mindestens 3 Zeichen lang sein", 400);
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
    await emitSystemMessage(`${user.username} ist dem Chat beigetreten`);
  }

  let devAuthToken: string | undefined;
  if (devMode) {
    devAuthToken = issueDevAuthToken(user.clientId) ?? undefined;
    assert(devAuthToken, "Entwicklermodus ist auf diesem Server nicht konfiguriert.", 500);
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
  assert(newUsername || profilePicture, "Entweder newUsername oder profilePicture ist erforderlich", 400);
  if (profilePicture) {
    assert(!profilePicture.toLowerCase().startsWith("data:"), "Profilbild darf keine data-URL sein", 400);
  }

  if (newUsername) {
    assert(newUsername.length >= 3, "Benutzername muss mindestens 3 Zeichen lang sein", 400);
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
    await emitSystemMessage(`${currentUser.username} heißt jetzt ${newUsername}`);
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
  assert(user, "Nutzersitzung nicht gefunden. Bitte erneut anmelden.", 401);

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
  await emitSystemMessage(`${user.username} hat den Chat verlassen`);
  return dto;
}

export async function createMessage(input: CreateMessageRequest): Promise<MessageDTO> {
  const user = await getUserByClientId(input.clientId);
  const message = input.message.trim();
  assert(message.length > 0, "Nachricht darf nicht leer sein", 400);

  const type = toDbMessageType(input.type);
  let questionMessageId: string | undefined;
  let referencedMessage:
    | {
      id: string;
      type: MessageType;
      content: string;
      authorName: string;
    }
    | null = null;

  if (input.questionId) {
    referencedMessage = await prisma.message.findUnique({
      where: { id: input.questionId },
      select: { id: true, type: true, content: true, authorName: true },
    });
    assert(referencedMessage, type === MessageType.ANSWER ? "Frage-Nachricht nicht gefunden" : "Nachricht für Antwort nicht gefunden", 404);
  }

  if (type === MessageType.ANSWER) {
    assert(input.questionId, "questionId ist für Antworten erforderlich", 400);
    assert(referencedMessage, "Frage-Nachricht nicht gefunden", 404);
    assert(referencedMessage.type === MessageType.QUESTION, "questionId muss auf eine Frage verweisen", 400);
    questionMessageId = referencedMessage.id;
  }

  if (type === MessageType.MESSAGE && referencedMessage) {
    questionMessageId = referencedMessage.id;
  }

  const normalizedPollOptions = input.pollOptions?.map((value) => value.trim()).filter(Boolean) ?? [];
  const fallbackPollOptions = [input.optionOne?.trim(), input.optionTwo?.trim()].filter(Boolean) as string[];
  const pollOptions = normalizedPollOptions.length > 0 ? normalizedPollOptions : fallbackPollOptions;

  if (type === MessageType.VOTING_POLL) {
    assert(pollOptions.length >= 2, "Mindestens zwei Umfrageoptionen sind erforderlich", 400);
    assert(pollOptions.length <= 15, "Umfragen unterstützen bis zu 15 Optionen", 400);
    assert(
      new Set(pollOptions.map((value) => value.toLowerCase())).size === pollOptions.length,
      "Umfrageoptionen müssen eindeutig sein",
      400,
    );
  }

  let content = message;
  if (type === MessageType.MESSAGE) {
    if (message.startsWith("/roll")) {
      content = `${user.username} hat ${Math.floor(Math.random() * 6) + 1} gewürfelt`;
    } else if (message.startsWith("/coin")) {
      content = `${user.username} hat ${Math.random() < 0.5 ? "Kopf" : "Zahl"} geworfen`;
    } else if (message.startsWith("/help")) {
      content = "Erwähne @chatgpt oder @grok für KI. Verfügbar sind auch /roll, /coin und Umfragen mit bis zu 15 Optionen.";
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

  const aiProvider =
    !isAiDisplayName(user.username) &&
    type === MessageType.MESSAGE &&
    !message.startsWith("/roll") &&
    !message.startsWith("/coin") &&
    !message.startsWith("/help") &&
    detectAiProviders(message).length > 0;

  if (aiProvider) {
    try {
      await maybeRespondAsAi({
        sourceMessageId: created.id,
        username: user.username,
        message,
        imageUrls: extractImageUrlsForAi(message),
      });
    } catch (error) {
      console.error("AI auto-response error:", error instanceof Error ? error.message : error);
    }
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

  assert(poll, "Umfrage nicht gefunden", 404);
  assert(poll.type === MessageType.VOTING_POLL, "Nachricht ist keine Umfrage", 400);

  const sortedOptions = [...poll.pollOptions].sort((a, b) => a.sortOrder - b.sortOrder);
  let targetOptionIds = input.optionIds?.filter(Boolean) ?? [];

  if (targetOptionIds.length === 0 && input.side) {
    const legacyOption = input.side === "left" ? sortedOptions[0] : sortedOptions[1];
    if (legacyOption) targetOptionIds = [legacyOption.id];
  }

  assert(targetOptionIds.length > 0, "Mindestens eine Umfrageoption ist erforderlich", 400);
  assert(targetOptionIds.length <= 15, "Umfragen unterstützen bis zu 15 ausgewählte Optionen", 400);

  if (!poll.pollMultiSelect) {
    assert(targetOptionIds.length === 1, "Diese Umfrage erlaubt nur eine Stimme", 400);
  }

  const validOptionIds = new Set(sortedOptions.map((option) => option.id));
  assert(
    targetOptionIds.every((optionId) => validOptionIds.has(optionId)),
    "Eine oder mehrere Umfrageoptionen sind ungültig",
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
  assert(tokenValid, "Entwicklermodus-Authentifizierung fehlgeschlagen. Bitte mit dem 16-stelligen Code neu anmelden.", 403);

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
  let message = "Aktion abgeschlossen.";

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

    message = "Alles wurde zurückgesetzt.";
  }

  if (action === "delete_all_messages") {
    await prisma.$transaction([
      prisma.pollChoiceVote.deleteMany({}),
      prisma.pollVote.deleteMany({}),
      prisma.pollOption.deleteMany({}),
      prisma.message.deleteMany({}),
    ]);
    invalidateMediaCache();
    message = "Alle Nachrichten wurden gelöscht.";
  }

  if (action === "logout_all_users") {
    await prisma.user.deleteMany({
      where: {
        clientId: {
          notIn: [actor.clientId, ...SYSTEM_CLIENT_IDS],
        },
      },
    });
    await emitSystemMessage(`${actor.username} hat alle Nutzer abgemeldet`);
    message = "Alle anderen Nutzer wurden abgemeldet.";
  }

  if (action === "clear_blacklist") {
    await prisma.blacklistEntry.deleteMany({});
    message = "Sperrliste wurde geleert.";
  }

  if (action === "delete_user") {
    const targetUsername = input.targetUsername?.trim();
    assert(targetUsername, "targetUsername ist für delete_user erforderlich", 400);

    const target = await prisma.user.findFirst({
      where: {
        username: {
          equals: targetUsername,
          mode: "insensitive",
        },
      },
    });
    assert(target, "Zielnutzer nicht gefunden", 404);
    assert(target.clientId !== actor.clientId, "Die eigene aktive Admin-Sitzung kann nicht gelöscht werden.", 400);

    await prisma.user.delete({
      where: { id: target.id },
    });
    await emitSystemMessage(`${target.username} wurde von ${actor.username} entfernt`);
    message = `Nutzer ${target.username} wurde gelöscht.`;
  }

  if (action === "delete_message") {
    const targetMessageId = input.targetMessageId?.trim();
    assert(targetMessageId, "targetMessageId ist für delete_message erforderlich", 400);

    const target = await prisma.message.findUnique({
      where: { id: targetMessageId },
      select: { id: true },
    });
    assert(target, "Zielnachricht nicht gefunden", 404);

    await prisma.message.delete({
      where: { id: target.id },
    });
    invalidateMediaCache();
    message = `Nachricht ${target.id} wurde gelöscht.`;
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
