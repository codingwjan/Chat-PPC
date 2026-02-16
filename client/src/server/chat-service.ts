import { AiJobStatus, MessageReactionType, MessageType, Prisma, UserBehaviorEventType } from "@prisma/client";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { put } from "@vercel/blob";
import { decompressFrames, parseGIF } from "gifuct-js";
import OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { PNG } from "pngjs";
import { getDefaultProfilePicture as getDefaultAvatar } from "@/lib/default-avatar";
import {
  buildMemberProgress,
  isMemberRankUpgrade,
  MEMBER_RANK_STEPS,
  memberRankLabel,
  PPC_MEMBER_BRAND,
  PPC_MEMBER_SCORE_WEIGHTS,
} from "@/lib/member-progress";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/sse-bus";
import type {
  AdminActionRequest,
  AdminActionResponse,
  AdminOverviewDTO,
  AdminResetUserPasswordResponse,
  AdminUserListResponseDTO,
  AiStatusDTO,
  AuthSessionDTO,
  AuthSignInRequest,
  AuthSignUpRequest,
  ChatBackgroundDTO,
  CreateMessageRequest,
  DeveloperUserTasteListDTO,
  LoginRequest,
  LoginResponseDTO,
  NotificationPageDTO,
  PublicUserProfileDTO,
  ReactionType,
  TasteProfileDetailedDTO,
  TasteProfileEventDTO,
  TasteProfileEventPageDTO,
  TasteWindowKey,
  UserTasteProfileDTO,
  MediaItemDTO,
  MediaPageDTO,
  MessageDTO,
  MessagePageDTO,
  SnapshotDTO,
  UpdateOwnAccountRequest,
  UserPresenceDTO,
} from "@/lib/types";
import { AppError, assert } from "@/server/errors";
import { issueDevAuthToken, isDevUnlockUsername, verifyDevAuthToken } from "@/server/dev-mode";
import {
  decryptLoginName,
  encryptLoginName,
  hashLoginNameLookup,
  normalizeLoginName,
} from "@/server/login-name-crypto";
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
const AUTH_SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const TASTE_PROFILE_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const TASTE_PROFILE_WINDOW_DAYS = 30;
const BEHAVIOR_EVENT_RETENTION_DAYS = 180;
const BEHAVIOR_EVENT_RETENTION_MS = BEHAVIOR_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const TAGGING_QUEUE_MAX_ATTEMPTS = 4;
const TAGGING_QUEUE_STALE_PROCESSING_MS = 2 * 60 * 1_000;
const TAGGING_QUEUE_CONCURRENCY = 2;
const TAGGING_LANGUAGE = "en";
const TAGGING_PROVIDER = "grok";
const TAGGING_MAX_TAG_LENGTH = 48;
const TAGGING_MAX_MESSAGE_TAGS = 16;
const TAGGING_MAX_IMAGE_TAGS = 20;
const TAGGING_GIF_FRAME_COUNT = 3;
const TAGGING_MIN_MESSAGE_SCORE = 0.5;
const TAGGING_MIN_CATEGORY_SCORE = 0.55;
const TAGGING_MESSAGE_TARGET_MIN = 10;
const TAGGING_MESSAGE_TARGET_MAX = 16;
const TAGGING_MAX_THEME_TAGS = 4;
const TAGGING_MAX_HUMOR_TAGS = 3;
const TAGGING_MAX_ART_TAGS = 3;
const TAGGING_MAX_TONE_TAGS = 5;
const TAGGING_MAX_TOPIC_TAGS = 4;
const MESSAGE_REACTION_TYPES: readonly ReactionType[] = ["LIKE", "LOL", "FIRE", "BASED", "WTF", "BIG_BRAIN"] as const;
const MESSAGE_REACTION_SCORES: Record<ReactionType, number> = {
  LIKE: 1.0,
  LOL: 1.4,
  FIRE: 1.2,
  BASED: 1.1,
  WTF: 1.0,
  BIG_BRAIN: 1.2,
};
const USERNAME_CHANGED_EVENT_TYPE = (UserBehaviorEventType as Record<string, UserBehaviorEventType | undefined>)
  .USERNAME_CHANGED;
const PPC_MEMBER_ACTIVE_EVENT_TYPES: readonly UserBehaviorEventType[] = [
  UserBehaviorEventType.MESSAGE_CREATED,
  USERNAME_CHANGED_EVENT_TYPE,
  UserBehaviorEventType.REACTION_GIVEN,
  UserBehaviorEventType.POLL_CREATED,
  UserBehaviorEventType.POLL_EXTENDED,
  UserBehaviorEventType.POLL_VOTE_GIVEN,
  UserBehaviorEventType.AI_MENTION_SENT,
  UserBehaviorEventType.MESSAGE_TAGGING_COMPLETED,
].filter((type): type is UserBehaviorEventType => Boolean(type));
const SYSTEM_RANK_UP_REGEX = /^(.+?)\s+ist auf\s+(bronze|silber|gold|platin)\s+aufgestiegen\s+[·-]\s+ppc (?:member|score)\s+(\d+)$/i;
const TAGGING_MODEL_PROMPT = [
  "You are a strict tagging engine for chat messages and images.",
  "Return JSON only. No markdown. No prose.",
  "All tags must be english, lowercase, concise, and normalized.",
  "Always include confidence scores between 0 and 1.",
  "Do not invent tags. If a category has no evidence, leave it empty.",
  "Use machine-readable category tags.",
  'Humor tags must use only these values: "humor:sarcasm", "humor:irony", "humor:absurdism", "humor:wordplay", "humor:dark-humor", "humor:satire", "humor:self-deprecating", "humor:playful-banter".',
  'Theme tags must describe format/intent only: e.g. "theme:poll", "theme:question", "theme:request", "theme:opinion", "theme:comparison".',
  'Topic tags must be broad domains only: e.g. "topic:animals", "topic:food", "topic:relationships", "topic:technology", "topic:school", "topic:entertainment".',
  'Tone tags must include at least one "language:<...>" and one "complexity:<...>" marker when inferable.',
  "Avoid generic/meta noise tags such as funny, humor, theme, topic, casual, neutral, request, create, command, no image, username.",
  "Target density:",
  `- messageTags: ${TAGGING_MESSAGE_TARGET_MIN}-${TAGGING_MESSAGE_TARGET_MAX} (target 12)`,
  "- image tags per image: 12-20 (target 16)",
  "Schema:",
  "{",
  '  "messageTags":[{"tag":"...", "score":0.0}],',
  '  "categories":{"themes":[],"humor":[],"art":[],"tone":[],"topics":[]},',
  '  "images":[{"imageUrl":"<exact sourceImageUrl>", "tags":[], "categories":{"themes":[],"humor":[],"art":[],"tone":[],"objects":[]}}]',
  "}",
].join("\n");

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

function fallbackModelLabelForProvider(provider: AiProvider): string {
  if (provider === "grok") {
    return getGrokRuntimeConfig().textModel;
  }
  return "Modell dynamisch (Prompt)";
}

function resolveModelFromResponse(response: OpenAIResponse | null | undefined): string | undefined {
  const model = typeof response?.model === "string" ? response.model.trim() : "";
  return model || undefined;
}

let aiStatusState: AiStatusDTO = {
  chatgpt: fallbackStatusForProvider("chatgpt"),
  grok: fallbackStatusForProvider("grok"),
  chatgptModel: fallbackModelLabelForProvider("chatgpt"),
  grokModel: fallbackModelLabelForProvider("grok"),
  updatedAt: new Date().toISOString(),
};

let aiQueueDrainScheduled = false;
let lastAiBusyNoticeAt = 0;
let taggingQueueDrainScheduled = false;
let lastBehaviorEventCleanupAt = 0;
let canPersistAiStatusRow = true;
let encryptedLoginColumnsAvailable: boolean | null = null;
let usernameChangedEnumValueAvailable: boolean | null = null;

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

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHash] = stored.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function canUseEncryptedLoginColumns(): boolean {
  return encryptedLoginColumnsAvailable !== false;
}

function markEncryptedLoginColumnsUnavailable(): void {
  encryptedLoginColumnsAvailable = false;
}

function markEncryptedLoginColumnsAvailableIfUnknown(): void {
  if (encryptedLoginColumnsAvailable === null) {
    encryptedLoginColumnsAvailable = true;
  }
}

function isMissingColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    return true;
  }

  if (error instanceof Error && error.message.toLowerCase().includes("does not exist")) {
    return true;
  }

  return false;
}

function isMissingUsernameChangedEnumValueError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("invalid input value for enum")
    && message.includes("userbehavioreventtype")
    && message.includes("username_changed");
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

function isDeveloperAlias(username: string): boolean {
  const normalized = username.trim().toLowerCase();
  const developer = DEVELOPER_USERNAME.toLowerCase();
  return normalized === developer || normalized.startsWith(`${developer}-`);
}

function isPpcMemberEligibleUser(input: { clientId: string; username: string }): boolean {
  const normalizedUsername = input.username.trim().toLowerCase();
  if (SYSTEM_CLIENT_IDS.includes(input.clientId as (typeof SYSTEM_CLIENT_IDS)[number])) {
    return false;
  }
  if (normalizedUsername === "system" || normalizedUsername === "chatgpt" || normalizedUsername === "grok") {
    return false;
  }
  if (isDeveloperAlias(input.username)) {
    return false;
  }
  return true;
}

function mapUser(user: {
  id: string;
  clientId: string;
  username: string;
  profilePicture: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: Date | null;
  ppcMemberScoreRaw?: number | null;
  ppcMemberLastActiveAt?: Date | null;
}): UserPresenceDTO {
  const eligible = isPpcMemberEligibleUser({ clientId: user.clientId, username: user.username });
  const member = eligible
    ? buildMemberProgress({
      rawScore: user.ppcMemberScoreRaw || 0,
      lastActiveAt: user.ppcMemberLastActiveAt || null,
    })
    : undefined;
  return {
    id: user.id,
    clientId: user.clientId,
    username: user.username,
    profilePicture: user.profilePicture,
    status: user.status,
    isOnline: user.isOnline,
    lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
    member,
  };
}

const MESSAGE_INCLUDE = Prisma.validator<Prisma.MessageInclude>()({
  questionMessage: {
    select: {
      id: true,
      authorName: true,
      content: true,
    },
  },
  author: {
    select: {
      clientId: true,
      username: true,
      profilePicture: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  },
  pollOptions: {
    include: {
      votes: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
            },
          },
        },
      },
    },
  },
  reactions: {
    include: {
      user: {
        select: {
          id: true,
          username: true,
          profilePicture: true,
        },
      },
    },
  },
});

type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

type MessageTaggingDTOValue = NonNullable<MessageDTO["tagging"]>;
type ScoredTagDTOValue = MessageTaggingDTOValue["messageTags"][number];
type MessageReactionsDTOValue = NonNullable<MessageDTO["reactions"]>;

function toTaggingStatus(status: AiJobStatus | null | undefined): MessageTaggingDTOValue["status"] | undefined {
  if (status === AiJobStatus.PENDING) return "pending";
  if (status === AiJobStatus.PROCESSING) return "processing";
  if (status === AiJobStatus.COMPLETED) return "completed";
  if (status === AiJobStatus.FAILED) return "failed";
  return undefined;
}

function createEmptyMessageTagCategories(): MessageTaggingDTOValue["categories"] {
  return {
    themes: [],
    humor: [],
    art: [],
    tone: [],
    topics: [],
  };
}

function createEmptyImageTagCategories(): MessageTaggingDTOValue["images"][number]["categories"] {
  return {
    themes: [],
    humor: [],
    art: [],
    tone: [],
    objects: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTagLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.slice(0, TAGGING_MAX_TAG_LENGTH);
}

function normalizeTagScore(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

function normalizeScoredTags(raw: unknown, maxCount: number): ScoredTagDTOValue[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const tags: ScoredTagDTOValue[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;

    const tag = normalizeTagLabel(record.tag);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push({
      tag,
      score: normalizeTagScore(record.score),
    });
    if (tags.length >= maxCount) break;
  }

  return tags;
}

function normalizeMessageTagCategories(raw: unknown): MessageTaggingDTOValue["categories"] {
  const record = asRecord(raw);
  if (!record) return createEmptyMessageTagCategories();
  return {
    themes: normalizeScoredTags(record.themes, TAGGING_MAX_MESSAGE_TAGS),
    humor: normalizeScoredTags(record.humor, TAGGING_MAX_MESSAGE_TAGS),
    art: normalizeScoredTags(record.art, TAGGING_MAX_MESSAGE_TAGS),
    tone: normalizeScoredTags(record.tone, TAGGING_MAX_MESSAGE_TAGS),
    topics: normalizeScoredTags(record.topics, TAGGING_MAX_MESSAGE_TAGS),
  };
}

function normalizeImageTagCategories(raw: unknown): MessageTaggingDTOValue["images"][number]["categories"] {
  const record = asRecord(raw);
  if (!record) return createEmptyImageTagCategories();
  return {
    themes: normalizeScoredTags(record.themes, TAGGING_MAX_IMAGE_TAGS),
    humor: normalizeScoredTags(record.humor, TAGGING_MAX_IMAGE_TAGS),
    art: normalizeScoredTags(record.art, TAGGING_MAX_IMAGE_TAGS),
    tone: normalizeScoredTags(record.tone, TAGGING_MAX_IMAGE_TAGS),
    objects: normalizeScoredTags(record.objects, TAGGING_MAX_IMAGE_TAGS),
  };
}

function normalizeTaggedImages(raw: unknown): MessageTaggingDTOValue["images"] {
  if (!Array.isArray(raw)) return [];
  const images: MessageTaggingDTOValue["images"] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const imageUrl = typeof record.imageUrl === "string" ? normalizeAiImageUrlCandidate(record.imageUrl) : "";
    if (!imageUrl) continue;
    images.push({
      imageUrl,
      tags: normalizeScoredTags(record.tags, TAGGING_MAX_IMAGE_TAGS),
      categories: normalizeImageTagCategories(record.categories),
    });
  }
  return images;
}

function mapMessageTagging(message: MessageRow): MessageDTO["tagging"] | undefined {
  const status = toTaggingStatus(message.taggingStatus);
  if (!status) return undefined;

  const fallbackModel = getGrokRuntimeConfig().textModel;
  const base: MessageTaggingDTOValue = {
    status,
    provider: TAGGING_PROVIDER,
    model: fallbackModel,
    language: TAGGING_LANGUAGE,
    messageTags: [],
    categories: createEmptyMessageTagCategories(),
    images: [],
  };

  if (message.taggingUpdatedAt) {
    base.generatedAt = message.taggingUpdatedAt.toISOString();
  }
  if (message.taggingError) {
    base.error = message.taggingError;
  }

  const payload = asRecord(message.taggingPayload);
  if (!payload) {
    return base;
  }

  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  const generatedAtRaw = typeof payload.generatedAt === "string" ? payload.generatedAt.trim() : "";
  const generatedAtDate = generatedAtRaw ? new Date(generatedAtRaw) : null;

  return {
    ...base,
    model: model || fallbackModel,
    generatedAt:
      generatedAtDate && Number.isFinite(generatedAtDate.getTime())
        ? generatedAtDate.toISOString()
        : base.generatedAt,
    messageTags: normalizeScoredTags(payload.messageTags, TAGGING_MAX_MESSAGE_TAGS),
    categories: normalizeMessageTagCategories(payload.categories),
    images: normalizeTaggedImages(payload.images),
  };
}

function toReactionType(value: MessageReactionType): ReactionType {
  return value;
}

function roundReactionScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapMessageReactions(message: MessageRow, viewerUserId?: string | null): MessageReactionsDTOValue {
  const counts = new Map<ReactionType, number>(MESSAGE_REACTION_TYPES.map((reaction) => [reaction, 0]));
  const usersByReaction = new Map<
    ReactionType,
    Array<{ id: string; username: string; profilePicture: string }>
  >(MESSAGE_REACTION_TYPES.map((reaction) => [reaction, []]));
  let score = 0;

  for (const reaction of message.reactions) {
    const key = toReactionType(reaction.reaction);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (reaction.user) {
      const current = usersByReaction.get(key) || [];
      current.push({
        id: reaction.user.id,
        username: reaction.user.username,
        profilePicture: reaction.user.profilePicture,
      });
      usersByReaction.set(key, current);
    }
    score += MESSAGE_REACTION_SCORES[key] || 0;
  }

  const viewerReaction = viewerUserId
    ? (message.reactions.find((reaction) => reaction.userId === viewerUserId)?.reaction ?? null)
    : null;

  return {
    total: message.reactions.length,
    score: roundReactionScore(score),
    viewerReaction: viewerReaction ? toReactionType(viewerReaction) : null,
    summary: MESSAGE_REACTION_TYPES.map((reaction) => ({
      reaction,
      count: counts.get(reaction) || 0,
      users: usersByReaction.get(reaction) || [],
    })),
  };
}

function extractSystemJoinUsername(content: string): string | null {
  const trimmed = content.trim();
  const normalized = trimmed.toLowerCase();
  const joinSuffixes = [" joined the chat", " ist dem chat beigetreten"];

  for (const suffix of joinSuffixes) {
    if (!normalized.endsWith(suffix)) continue;
    const username = trimmed.slice(0, trimmed.length - suffix.length).trim();
    return username || null;
  }

  return null;
}

function extractSystemRankUpPayload(content: string): { username: string; rank: string; score: number } | null {
  const match = content.trim().match(SYSTEM_RANK_UP_REGEX);
  if (!match) return null;
  const username = match[1]?.trim() || "";
  const rank = match[2]?.trim() || "";
  const scoreRaw = Number.parseInt(match[3] || "", 10);
  if (!username || !rank || !Number.isFinite(scoreRaw)) return null;
  return {
    username,
    rank,
    score: scoreRaw,
  };
}

function isSystemJoinContent(content: string): boolean {
  return extractSystemJoinUsername(content) !== null;
}

function isSystemRankUpContent(content: string): boolean {
  return extractSystemRankUpPayload(content) !== null;
}

async function resolveJoinMessageTargetUserId(content: string): Promise<string | null> {
  const username = extractSystemJoinUsername(content);
  if (!username) return null;

  const user = await prisma.user.findFirst({
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
    orderBy: [{ isOnline: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });

  return user?.id || null;
}

function isReactableSystemMessage(input: { authorName: string; content: string }): boolean {
  return input.authorName === "System" && (isSystemJoinContent(input.content) || isSystemRankUpContent(input.content));
}

function extractJoinUsernameTag(content: string): string | null {
  const username = extractSystemJoinUsername(content);
  if (!username) return null;

  const normalizedUsername = normalizeTagLabel(username);
  if (!normalizedUsername) return null;
  return `user:${normalizedUsername}`;
}

function buildMessagePreview(value: string, maxChars = 120): string {
  const compact = value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "[image]")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

type NotificationDTOValue = NotificationPageDTO["items"][number];

function mapNotification(notification: {
  id: string;
  userId: string;
  actorUserId: string | null;
  actorUsernameSnapshot: string;
  messageId: string;
  reaction: MessageReactionType;
  messagePreview: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}): NotificationDTOValue {
  return {
    id: notification.id,
    userId: notification.userId,
    actorUserId: notification.actorUserId || undefined,
    actorUsername: notification.actorUsernameSnapshot,
    messageId: notification.messageId,
    reaction: toReactionType(notification.reaction),
    messagePreview: notification.messagePreview,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt ? notification.readAt.toISOString() : undefined,
  };
}

type TasteUpdateReason = "message" | "reaction" | "poll" | "tagging";

function publishTasteUpdated(userId: string, reason: TasteUpdateReason): void {
  publish("taste.updated", {
    userId,
    updatedAt: new Date().toISOString(),
    reason,
  });
}

async function cleanupExpiredBehaviorEvents(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastBehaviorEventCleanupAt < 10 * 60 * 1_000) {
    return;
  }
  lastBehaviorEventCleanupAt = now;
  await prisma.userBehaviorEvent.deleteMany({
    where: {
      expiresAt: { lt: new Date(now) },
    },
  });
}

function toBehaviorMeta(input: {
  meta?: Prisma.InputJsonValue | null;
  relatedUsername?: string | null;
}): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  const metaRecord =
    input.meta && typeof input.meta === "object" && !Array.isArray(input.meta)
      ? { ...(input.meta as Record<string, unknown>) }
      : {};
  if (input.relatedUsername) {
    metaRecord.relatedUsername = input.relatedUsername;
  }
  return Object.keys(metaRecord).length > 0 ? (metaRecord as Prisma.InputJsonValue) : undefined;
}

async function createBehaviorEvent(input: {
  userId: string;
  type: UserBehaviorEventType;
  messageId?: string | null;
  relatedUserId?: string | null;
  relatedUsername?: string | null;
  reaction?: ReactionType | null;
  preview?: string | null;
  meta?: Prisma.InputJsonValue | null;
  createdAt?: Date;
}): Promise<void> {
  await cleanupExpiredBehaviorEvents();
  const createdAt = input.createdAt || new Date();
  await prisma.userBehaviorEvent.create({
    data: {
      userId: input.userId,
      type: input.type,
      messageId: input.messageId ?? null,
      relatedUserId: input.relatedUserId ?? null,
      reaction: input.reaction ? (input.reaction as MessageReactionType) : null,
      preview: input.preview ? buildMessagePreview(input.preview) : null,
      meta: toBehaviorMeta({ meta: input.meta, relatedUsername: input.relatedUsername }),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + BEHAVIOR_EVENT_RETENTION_MS),
    },
  });
}

function getPpcMemberActiveEventTypesForQuery(): UserBehaviorEventType[] {
  if (!USERNAME_CHANGED_EVENT_TYPE || usernameChangedEnumValueAvailable === false) {
    return PPC_MEMBER_ACTIVE_EVENT_TYPES.filter((type) => type !== USERNAME_CHANGED_EVENT_TYPE);
  }
  return [...PPC_MEMBER_ACTIVE_EVENT_TYPES];
}

async function findLatestPpcMemberActiveEvent(userId: string): Promise<{ createdAt: Date } | null> {
  const runQuery = async (): Promise<{ createdAt: Date } | null> =>
    prisma.userBehaviorEvent.findFirst({
      where: {
        userId,
        type: { in: getPpcMemberActiveEventTypesForQuery() },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    });

  try {
    return await runQuery();
  } catch (error) {
    if (!isMissingUsernameChangedEnumValueError(error)) {
      throw error;
    }
    usernameChangedEnumValueAvailable = false;
    return runQuery();
  }
}

async function getPpcMemberBreakdown(userId: string): Promise<{
  breakdown: TasteProfileDetailedDTO["memberBreakdown"];
  rawScore: number;
  lastActiveAt: Date | null;
}> {
  const systemJoinMessageWhere: Prisma.MessageWhereInput = {
    authorId: userId,
    authorName: "System",
    OR: [
      { content: { endsWith: " joined the chat", mode: "insensitive" } },
      { content: { endsWith: " ist dem chat beigetreten", mode: "insensitive" } },
    ],
  };

  const [behaviorRows, reactionsGiven, reactionsReceived, latestActiveEvent, systemJoinMessageCount, latestSystemJoinMessage] = await Promise.all([
    prisma.userBehaviorEvent.groupBy({
      by: ["type"],
      where: { userId },
      _count: { type: true },
    }),
    prisma.messageReaction.count({
      where: { userId },
    }),
    prisma.messageReaction.count({
      where: {
        message: { authorId: userId },
      },
    }),
    findLatestPpcMemberActiveEvent(userId),
    prisma.message.count({
      where: systemJoinMessageWhere,
    }),
    prisma.message.findFirst({
      where: systemJoinMessageWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    }),
  ]);

  const eventCounts = new Map<UserBehaviorEventType, number>();
  for (const row of behaviorRows) {
    eventCounts.set(row.type, row._count.type);
  }
  const usernameChangesFromEvents = USERNAME_CHANGED_EVENT_TYPE
    ? (eventCounts.get(USERNAME_CHANGED_EVENT_TYPE) || 0)
    : 0;
  const usernameChangesFromSystemMessages = Math.max(0, systemJoinMessageCount - 1);
  const usernameChanges = Math.max(usernameChangesFromEvents, usernameChangesFromSystemMessages);
  const latestRenameActivityAt = systemJoinMessageCount > 1 ? latestSystemJoinMessage?.createdAt || null : null;
  const latestEventActivityAt = latestActiveEvent?.createdAt || null;

  const breakdown: TasteProfileDetailedDTO["memberBreakdown"] = {
    messagesCreated: eventCounts.get(UserBehaviorEventType.MESSAGE_CREATED) || 0,
    reactionsGiven,
    reactionsReceived,
    aiMentions: eventCounts.get(UserBehaviorEventType.AI_MENTION_SENT) || 0,
    pollsCreated: eventCounts.get(UserBehaviorEventType.POLL_CREATED) || 0,
    pollsExtended: eventCounts.get(UserBehaviorEventType.POLL_EXTENDED) || 0,
    pollVotes: eventCounts.get(UserBehaviorEventType.POLL_VOTE_GIVEN) || 0,
    taggingCompleted: eventCounts.get(UserBehaviorEventType.MESSAGE_TAGGING_COMPLETED) || 0,
    usernameChanges,
    rawScore: 0,
  };

  breakdown.rawScore = (
    breakdown.messagesCreated * PPC_MEMBER_SCORE_WEIGHTS.messagesCreated
    + breakdown.reactionsGiven * PPC_MEMBER_SCORE_WEIGHTS.reactionsGiven
    + breakdown.reactionsReceived * PPC_MEMBER_SCORE_WEIGHTS.reactionsReceived
    + breakdown.aiMentions * PPC_MEMBER_SCORE_WEIGHTS.aiMentions
    + breakdown.pollsCreated * PPC_MEMBER_SCORE_WEIGHTS.pollsCreated
    + breakdown.pollsExtended * PPC_MEMBER_SCORE_WEIGHTS.pollsExtended
    + breakdown.pollVotes * PPC_MEMBER_SCORE_WEIGHTS.pollVotes
    + breakdown.taggingCompleted * PPC_MEMBER_SCORE_WEIGHTS.taggingCompleted
    + breakdown.usernameChanges * PPC_MEMBER_SCORE_WEIGHTS.usernameChanges
  );

  return {
    breakdown,
    rawScore: breakdown.rawScore,
    lastActiveAt: latestEventActivityAt && latestRenameActivityAt
      ? (latestEventActivityAt.getTime() >= latestRenameActivityAt.getTime() ? latestEventActivityAt : latestRenameActivityAt)
      : latestEventActivityAt || latestRenameActivityAt || null,
  };
}

export async function recomputePpcMemberForUser(
  userId: string,
  options: { emitRankUp?: boolean } = {},
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });
  if (!user) return;

  const eligible = isPpcMemberEligibleUser(user);
  const previousMember = eligible
    ? buildMemberProgress({
      rawScore: user.ppcMemberScoreRaw || 0,
      lastActiveAt: user.ppcMemberLastActiveAt || null,
    })
    : undefined;

  const computed = eligible
    ? await getPpcMemberBreakdown(user.id)
    : { rawScore: 0, lastActiveAt: null as Date | null };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ppcMemberScoreRaw: computed.rawScore,
      ppcMemberLastActiveAt: computed.lastActiveAt,
    },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

  const nextMember = eligible
    ? buildMemberProgress({
      rawScore: updated.ppcMemberScoreRaw || 0,
      lastActiveAt: updated.ppcMemberLastActiveAt || null,
    })
    : undefined;

  const rankUp = Boolean(
    previousMember
    && nextMember
    && isMemberRankUpgrade(previousMember.rank, nextMember.rank),
  );

  const dto = mapUser(updated);
  publish("user.updated", dto);
  if (updated.isOnline) {
    publish("presence.updated", dto);
  }

  if (options.emitRankUp !== false && rankUp && nextMember) {
    await emitSystemMessage(
      `${updated.username} ist auf ${memberRankLabel(nextMember.rank)} aufgestiegen · ${PPC_MEMBER_BRAND} ${nextMember.score}`,
      { authorId: updated.id },
    );
  }
}

function readBehaviorEventMeta(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function mapBehaviorEvent(event: {
  id: string;
  type: UserBehaviorEventType;
  createdAt: Date;
  messageId: string | null;
  relatedUserId: string | null;
  reaction: MessageReactionType | null;
  preview: string | null;
  meta: unknown;
}): TasteProfileEventDTO {
  const meta = readBehaviorEventMeta(event.meta);
  const relatedUsername = typeof meta.relatedUsername === "string" ? meta.relatedUsername : undefined;
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt.toISOString(),
    messageId: event.messageId ?? undefined,
    relatedUserId: event.relatedUserId ?? undefined,
    relatedUsername,
    reaction: event.reaction ? toReactionType(event.reaction) : undefined,
    preview: event.preview || undefined,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}

function extractTagsFromTaggingPayload(raw: unknown): Array<{ tag: string; score: number }> {
  const payload = asRecord(raw);
  if (!payload) return [];
  return normalizeScoredTags(payload.messageTags, TAGGING_MAX_MESSAGE_TAGS);
}

function sumTagScores(
  target: Map<string, number>,
  tags: Array<{ tag: string; score: number }>,
  weight: number,
): void {
  for (const item of tags) {
    const next = (target.get(item.tag) || 0) + item.score * weight;
    target.set(item.tag, next);
  }
}

async function recomputeTasteProfileForUser(userId: string): Promise<void> {
  const windowStart = new Date(Date.now() - TASTE_PROFILE_WINDOW_MS);
  const [ownMessages, reactedRows, reactionsReceived] = await Promise.all([
    prisma.message.findMany({
      where: {
        authorId: userId,
        createdAt: { gte: windowStart },
        authorName: { not: "System" },
      },
      select: {
        taggingPayload: true,
      },
    }),
    prisma.messageReaction.findMany({
      where: {
        userId,
        updatedAt: { gte: windowStart },
      },
      select: {
        reaction: true,
        message: {
          select: {
            authorName: true,
            content: true,
            taggingPayload: true,
          },
        },
      },
    }),
    prisma.messageReaction.count({
      where: {
        message: { authorId: userId },
        updatedAt: { gte: windowStart },
      },
    }),
  ]);

  const tagScores = new Map<string, number>();
  for (const row of ownMessages) {
    sumTagScores(tagScores, extractTagsFromTaggingPayload(row.taggingPayload), 1);
  }
  for (const row of reactedRows) {
    const reaction = toReactionType(row.reaction);
    const weight = MESSAGE_REACTION_SCORES[reaction] || 1;
    sumTagScores(tagScores, extractTagsFromTaggingPayload(row.message.taggingPayload), weight);
    const joinUsernameTag =
      row.message.authorName === "System"
        ? extractJoinUsernameTag(row.message.content)
        : null;
    if (joinUsernameTag) {
      sumTagScores(tagScores, [{ tag: joinUsernameTag, score: 1 }], weight);
    }
  }

  const reactionDistributionMap = new Map<ReactionType, number>(
    MESSAGE_REACTION_TYPES.map((reaction) => [reaction, 0]),
  );
  for (const row of reactedRows) {
    const reaction = toReactionType(row.reaction);
    reactionDistributionMap.set(reaction, (reactionDistributionMap.get(reaction) || 0) + 1);
  }

  const topTags = [...tagScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([tag, score]) => ({ tag, score: Math.round(score * 1000) / 1000 }));

  const payload = {
    reactionsReceived,
    reactionDistribution: MESSAGE_REACTION_TYPES.map((reaction) => ({
      reaction,
      count: reactionDistributionMap.get(reaction) || 0,
    })),
    topTags,
  };

  await prisma.userTasteProfile.upsert({
    where: { userId },
    update: {
      windowDays: TASTE_PROFILE_WINDOW_DAYS,
      payload,
    },
    create: {
      userId,
      windowDays: TASTE_PROFILE_WINDOW_DAYS,
      payload,
    },
  });
}

function mapMessage(
  message: MessageRow,
  options: {
    viewerUserId?: string | null;
  } = {},
): MessageDTO {
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
    member:
      message.author && isPpcMemberEligibleUser(message.author)
        ? buildMemberProgress({
          rawScore: message.author.ppcMemberScoreRaw || 0,
          lastActiveAt: message.author.ppcMemberLastActiveAt || null,
        })
        : undefined,
    tagging: mapMessageTagging(message),
    reactions: mapMessageReactions(message, options.viewerUserId),
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

async function publishMessageUpdatedById(messageId: string): Promise<MessageRow | null> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    include: MESSAGE_INCLUDE,
  });
  if (!row) return null;
  publish("message.updated", mapMessage(row));
  if (row.authorId) {
    await recomputeTasteProfileForUser(row.authorId);
  }
  return row;
}

function toNullableJsonField(
  value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

async function updateMessageTaggingState(input: {
  messageId: string;
  status: AiJobStatus;
  payload?: Prisma.JsonValue | Prisma.InputJsonValue | null;
  error?: string | null;
  generatedAt?: Date | null;
}): Promise<void> {
  const result = await prisma.message.updateMany({
    where: { id: input.messageId },
    data: {
      taggingStatus: input.status,
      taggingPayload: toNullableJsonField(input.payload),
      taggingError: input.error ?? null,
      taggingUpdatedAt: input.generatedAt ?? null,
    },
  });
  if (result.count > 0) {
    const updatedRow = await publishMessageUpdatedById(input.messageId);
    if (
      updatedRow?.authorId
      && (input.status === AiJobStatus.COMPLETED || input.status === AiJobStatus.FAILED)
    ) {
      const behaviorType = input.status === AiJobStatus.COMPLETED
        ? UserBehaviorEventType.MESSAGE_TAGGING_COMPLETED
        : UserBehaviorEventType.MESSAGE_TAGGING_FAILED;
      try {
        await createBehaviorEvent({
          userId: updatedRow.authorId,
          type: behaviorType,
          messageId: updatedRow.id,
          preview: updatedRow.content,
          meta: input.status === AiJobStatus.FAILED
            ? ({ error: input.error || "Tagging fehlgeschlagen" } as Prisma.InputJsonValue)
            : null,
        });
        publishTasteUpdated(updatedRow.authorId, "tagging");
        if (input.status === AiJobStatus.COMPLETED) {
          await recomputePpcMemberForUser(updatedRow.authorId);
        }
      } catch (error) {
        console.error("Failed to persist tagging behavior event:", error);
      }
    }
  }
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
    select: { id: true },
  });

  if (existing) {
    throw new AppError("Dieser Benutzername ist bereits vergeben", 409);
  }
}

async function emitSystemMessage(
  content: string,
  options: {
    authorId?: string | null;
  } = {},
): Promise<void> {
  const baseData = {
    type: MessageType.MESSAGE,
    content,
    authorName: "System",
    authorProfilePicture: getDefaultProfilePicture(),
    ...(options.authorId ? { authorId: options.authorId } : {}),
  } satisfies Prisma.MessageCreateInput;

  try {
    const created = await prisma.message.create({
      data: baseData,
      include: MESSAGE_INCLUDE,
    });
    publish("message.created", mapMessage(created));
    return;
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
  }

  try {
    await prisma.message.create({
      data: {
        type: MessageType.MESSAGE,
        content,
        authorName: "System",
        authorProfilePicture: getDefaultProfilePicture(),
      },
      select: { id: true },
    });
  } catch (legacyError) {
    if (!isMissingColumnError(legacyError)) throw legacyError;
    console.warn("Skipping system message emission because message table columns are out of date.");
  }
}

async function cleanupOfflineUsers(): Promise<void> {
  const threshold = new Date(Date.now() - PRESENCE_TIMEOUT_MS);
  const staleUsers = await prisma.user.findMany({
    where: {
      isOnline: true,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
    },
    orderBy: [{ lastSeenAt: "asc" }],
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
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

    await emitSystemMessage(`${user.username} hat den Chat verlassen`);
  }
}

export async function getOnlineUsers(): Promise<UserPresenceDTO[]> {
  await cleanupOfflineUsers();

  const users = await prisma.user.findMany({
    where: { isOnline: true },
    orderBy: [{ username: "asc" }],
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

  return users.map(mapUser);
}

export async function getAiStatus(): Promise<AiStatusDTO> {
  const chatgptModel = aiStatusState.chatgptModel || fallbackModelLabelForProvider("chatgpt");
  const grokModel = aiStatusState.grokModel || fallbackModelLabelForProvider("grok");

  if (!hasAnyAiProviderApiKey()) {
    return {
      chatgpt: "offline",
      grok: "offline",
      chatgptModel,
      grokModel,
      updatedAt: new Date().toISOString(),
    };
  }

  const persisted = await prisma.user.findUnique({
    where: { clientId: AI_STATUS_CLIENT_ID },
    select: {
      status: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

  return {
    chatgpt: hasOpenAiApiKey() ? persisted?.status || aiStatusState.chatgpt : "offline",
    grok: hasGrokApiKey() ? aiStatusState.grok : "offline",
    chatgptModel,
    grokModel,
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
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
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
      include: MESSAGE_INCLUDE,
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
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
      take: limit + 1,
    });
    return {
      rows: rows.slice(0, limit).reverse(),
      hasMore: rows.length > limit,
    };
  }

  const rows = await prisma.message.findMany({
    include: MESSAGE_INCLUDE,
    orderBy: [{ createdAt: "desc" }],
    take: limit + 1,
  });

  return {
    rows: rows.slice(0, limit).reverse(),
    hasMore: rows.length > limit,
  };
}

function publishAiStatus(
  provider: AiProvider,
  status: string,
  options?: { model?: string },
): void {
  const modelKey = provider === "grok" ? "grokModel" : "chatgptModel";
  const providedModel = options?.model?.trim();
  aiStatusState = {
    ...aiStatusState,
    [provider]: status,
    [modelKey]: providedModel || aiStatusState[modelKey] || fallbackModelLabelForProvider(provider),
    updatedAt: new Date().toISOString(),
  };
  publish("ai.status", { status, provider, ...(providedModel ? { model: providedModel } : {}) });
  void persistAiStatusToDatabase(aiStatusState);
}

async function persistAiStatusToDatabase(payload: AiStatusDTO): Promise<void> {
  if (!canPersistAiStatusRow) return;

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
      select: { id: true },
    });
  } catch (error) {
    if (isMissingColumnError(error)) {
      canPersistAiStatusRow = false;
      return;
    }
    console.error("Failed to persist AI status:", error);
  }
}

interface AiTriggerPayload {
  provider: AiProvider;
  sourceMessageId: string;
  threadMessageId?: string;
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
const POLL_INTENT_REGEX = /\b(poll|umfrage|abstimmung|vote|voting)\b/i;
function shouldUseWebSearchTool(message: string): boolean {
  return WEB_SEARCH_HINT_REGEX.test(message);
}

function isLikelyPollIntent(message: string): boolean {
  return POLL_INTENT_REGEX.test(message);
}

function shouldUseImageGenerationTool(
  message: string,
  imageInputCount: number,
): boolean {
  const hasActionHint = IMAGE_GENERATION_ACTION_REGEX.test(message);
  const hasImageNoun = IMAGE_GENERATION_NOUN_REGEX.test(message);
  const hasImageContext = IMAGE_GENERATION_CONTEXT_REGEX.test(message);

  if (imageInputCount > 0) {
    // With user-provided images, default to analysis unless edit/generation intent is explicit.
    return hasActionHint;
  }

  if (hasActionHint && (hasImageNoun || hasImageContext)) {
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

type StoredTaggingPayload = Omit<MessageTaggingDTOValue, "status" | "error"> & { generatedAt: string };
interface TaggingImageSource {
  sourceImageUrl: string;
  analysisImageUrls: string[];
}

function appendUniqueTags(
  current: ScoredTagDTOValue[],
  incoming: ScoredTagDTOValue[],
  maxCount: number,
): ScoredTagDTOValue[] {
  const next = [...current];
  const seen = new Set(next.map((entry) => entry.tag));
  for (const entry of incoming) {
    if (seen.has(entry.tag)) continue;
    seen.add(entry.tag);
    next.push(entry);
    if (next.length >= maxCount) break;
  }
  return next.slice(0, maxCount);
}

const SYNTHETIC_CATEGORY_SCORE_FACTOR = 0.92;
const MESSAGE_CATEGORY_LIMITS: Record<keyof MessageTaggingDTOValue["categories"], number> = {
  themes: TAGGING_MAX_THEME_TAGS,
  humor: TAGGING_MAX_HUMOR_TAGS,
  art: TAGGING_MAX_ART_TAGS,
  tone: TAGGING_MAX_TONE_TAGS,
  topics: TAGGING_MAX_TOPIC_TAGS,
};
const HUMOR_TAG_VALUES = new Set([
  "humor:sarcasm",
  "humor:irony",
  "humor:absurdism",
  "humor:wordplay",
  "humor:dark-humor",
  "humor:satire",
  "humor:self-deprecating",
  "humor:playful-banter",
]);
const THEME_TAG_VALUES = new Set([
  "theme:poll",
  "theme:question",
  "theme:request",
  "theme:opinion",
  "theme:comparison",
  "theme:instruction",
  "theme:announcement",
  "theme:story",
]);
const ART_TAG_VALUES = new Set([
  "art:illustration",
  "art:photo",
  "art:cinematic",
  "art:anime",
  "art:pixel-art",
  "art:graphic-design",
  "art:visual-style",
]);
const TONE_TAG_PREFIXES = ["language:", "complexity:", "register:", "directness:", "affect:"] as const;
const GENERIC_LOW_INFO_TAGS = new Set([
  "funny",
  "humor",
  "theme",
  "topic",
  "casual",
  "neutral",
  "request",
  "short",
  "simple",
  "message",
  "text",
  "content",
]);
const INSTRUCTIONAL_NOISE_TAG_PATTERNS = [
  /^(request|create|command|username|at mention|user instruction|ai prompt|topic [\w-]+)$/i,
  /^(no image|single select|multiple choice|poll option)$/i,
];
const TOPIC_BROAD_MAPPINGS: Array<{ topic: string; patterns: RegExp[] }> = [
  {
    topic: "topic:animals",
    patterns: [/\b(animal|animals|pet|pets|pig|pigs|schwein|schweine|dog|dogs|cat|cats)\b/i],
  },
  {
    topic: "topic:food",
    patterns: [/\b(food|meal|eat|eating|cooking|recipe|dish|tasty|burger|pizza|drink|breakfast|frühstück|fruehstueck)\b/i],
  },
  {
    topic: "topic:relationships",
    patterns: [/\b(friend|friends|best friend|relationship|dating|love|partner)\b/i],
  },
  {
    topic: "topic:technology",
    patterns: [/\b(technology|tech|software|hardware|ai|chatgpt|grok|model|coding|programming)\b/i],
  },
  {
    topic: "topic:school",
    patterns: [/\b(school|class|classes|homework|exam|teacher|student|university)\b/i],
  },
  {
    topic: "topic:entertainment",
    patterns: [/\b(entertainment|movie|film|music|song|game|gaming|meme|show|series)\b/i],
  },
];
const TAG_CANONICAL_SYNONYMS: Record<string, string> = {
  umfrage: "theme:poll",
  survey: "theme:poll",
  "single select": "theme:poll",
  "multiple choice": "theme:poll",
  quiz: "theme:poll",
  frage: "theme:question",
  "sarkasmus": "humor:sarcasm",
  sarcastic: "humor:sarcasm",
  ironisch: "humor:irony",
  ironic: "humor:irony",
  absurd: "humor:absurdism",
  witz: "humor:wordplay",
  pun: "humor:wordplay",
  "dark humor": "humor:dark-humor",
  "dunkler humor": "humor:dark-humor",
  satire: "humor:satire",
  banter: "humor:playful-banter",
  deutsch: "language:german",
  german: "language:german",
  englisch: "language:english",
  english: "language:english",
  einfach: "complexity:simple",
  simple: "complexity:simple",
  komplex: "complexity:complex",
  complex: "complexity:complex",
  intellektuell: "complexity:complex",
  informal: "register:informal",
  locker: "register:informal",
  formal: "register:formal",
  direct: "directness:direct",
  direkt: "directness:direct",
  indirect: "directness:indirect",
  serious: "affect:serious",
  freundlich: "affect:friendly",
  friendly: "affect:friendly",
  aggressiv: "affect:aggressive",
  aggressive: "affect:aggressive",
  playful: "affect:playful",
};
const MESSAGE_THEME_PATTERNS = [
  /\b(theme:(poll|question|request|opinion|comparison|instruction|announcement|story)|poll|survey|umfrage|question|frage|opinion|meinung|comparison|vergleich|instruction|anweisung|announcement|story|geschichte)\b/i,
];
const MESSAGE_HUMOR_PATTERNS = [
  /\b(humor:(sarcasm|irony|absurdism|wordplay|dark-humor|satire|self-deprecating|playful-banter)|sarcasm|sarkasmus|irony|ironisch|absurd|wordplay|pun|witz|satire|dark humor|banter)\b/i,
];
const MESSAGE_ART_PATTERNS = [
  /\b(art:(illustration|photo|cinematic|anime|pixel-art|graphic-design|visual-style)|drawing|illustration|photo|cinematic|anime|pixelart|design|visual style)\b/i,
];
const MESSAGE_TONE_PATTERNS = [
  /\b(language:|complexity:|register:|directness:|affect:|german|english|deutsch|englisch|simple|einfach|complex|intellektuell|formal|informal|direct|indirect|friendly|aggressive|serious|playful)\b/i,
];
const IMAGE_THEME_PATTERNS = [
  /\b(game|spiel|movie|film|food|essen|travel|reise|sport|nature|natur|portrait|porträt|portraet|meme|animation|scene|szene|landscape|landschaft)\b/i,
];
const IMAGE_HUMOR_PATTERNS = [
  /\b(meme|funny|lustig|joke|witz|absurd|sarcasm|sarkasmus|wtf|chaos|comedic|humor|lol)\b/i,
];
const IMAGE_ART_PATTERNS = [
  /\b(drawing|zeichnung|design|style|stil|aesthetic|ästhetik|aesthetik|color|farbe|composition|komposition|cinematic|anime|pixelart|illustration|photo|foto|render|graphic|grafik)\b/i,
];
const IMAGE_TONE_PATTERNS = [
  /\b(happy|glücklich|gluecklich|sad|traurig|angry|wütend|wuetend|chill|chillig|aggressive|aggressiv|neutral|wholesome|toxic|toxisch|dramatic|dramatisch|dark|dunkel|bright|hell)\b/i,
];
const IMAGE_OBJECT_PATTERNS = [
  /\b(person|people|mensch|man|woman|face|gesicht|head|kopf|hand|dog|hund|cat|katze|animal|tier|car|auto|truck|lkw|bike|fahrrad|bus|train|zug|plane|flugzeug|tree|baum|flower|blume|house|haus|building|gebäude|gebaeude|road|straße|strasse|phone|handy|computer|screen|bildschirm|table|tisch|chair|stuhl|door|tür|tuer|window|fenster|shirt|hemd|hat|mütze|muetze|food|essen|burger|pizza|drink|getränk|getraenk|ball|book|buch|bag|tasche|glasses|brille|logo)\b/i,
];

function canonicalizeTag(raw: unknown): string {
  const normalized = normalizeTagLabel(raw);
  if (!normalized) return "";
  const deUnderscored = normalized.replace(/_/g, " ").replace(/\s+/g, " ");
  return TAG_CANONICAL_SYNONYMS[deUnderscored] || deUnderscored;
}

function isInstructionalNoiseTag(tag: string): boolean {
  if (!tag) return true;
  return INSTRUCTIONAL_NOISE_TAG_PATTERNS.some((pattern) => pattern.test(tag));
}

function isGenericLowInformationTag(
  tag: string,
  category?: keyof MessageTaggingDTOValue["categories"],
): boolean {
  if (!tag) return true;
  if (GENERIC_LOW_INFO_TAGS.has(tag)) return true;
  if (category === "themes") return tag === "theme:general";
  if (category === "humor") return tag === "humor";
  if (category === "tone") return tag === "tone";
  if (category === "topics") return tag === "topic:general";
  return false;
}

function canonicalizeThemeTag(tag: string): string {
  const normalized = canonicalizeTag(tag);
  if (!normalized) return "";
  if (THEME_TAG_VALUES.has(normalized)) return normalized;
  if (/\b(poll|survey|umfrage|quiz|vote)\b/i.test(normalized)) return "theme:poll";
  if (/\b(question|frage)\b/i.test(normalized)) return "theme:question";
  if (/\b(request|ask|bitte)\b/i.test(normalized)) return "theme:request";
  if (/\b(opinion|stance|meinung)\b/i.test(normalized)) return "theme:opinion";
  if (/\b(compare|comparison|vergleich|versus|vs)\b/i.test(normalized)) return "theme:comparison";
  if (/\b(instruction|anweisung|how to)\b/i.test(normalized)) return "theme:instruction";
  if (/\b(announcement|ankuendigung|ankündigung)\b/i.test(normalized)) return "theme:announcement";
  if (/\b(story|geschichte|anecdote)\b/i.test(normalized)) return "theme:story";
  return "";
}

function canonicalizeHumorTag(tag: string): string {
  const normalized = canonicalizeTag(tag);
  if (!normalized) return "";
  if (HUMOR_TAG_VALUES.has(normalized)) return normalized;
  if (/\b(sarcasm|sarkasmus)\b/i.test(normalized)) return "humor:sarcasm";
  if (/\b(irony|ironisch|ironic)\b/i.test(normalized)) return "humor:irony";
  if (/\b(absurd|absurdism|wtf|chaos)\b/i.test(normalized)) return "humor:absurdism";
  if (/\b(wordplay|pun|witz)\b/i.test(normalized)) return "humor:wordplay";
  if (/\b(dark humor|dark-humor)\b/i.test(normalized)) return "humor:dark-humor";
  if (/\b(satire)\b/i.test(normalized)) return "humor:satire";
  if (/\b(self[- ]deprecating|self[- ]deprecation)\b/i.test(normalized)) return "humor:self-deprecating";
  if (/\b(banter|playful banter)\b/i.test(normalized)) return "humor:playful-banter";
  return "";
}

function canonicalizeArtTag(tag: string): string {
  const normalized = canonicalizeTag(tag);
  if (!normalized) return "";
  if (ART_TAG_VALUES.has(normalized)) return normalized;
  if (/\b(illustration|drawing)\b/i.test(normalized)) return "art:illustration";
  if (/\b(photo|photography)\b/i.test(normalized)) return "art:photo";
  if (/\b(cinematic)\b/i.test(normalized)) return "art:cinematic";
  if (/\b(anime)\b/i.test(normalized)) return "art:anime";
  if (/\b(pixelart|pixel art)\b/i.test(normalized)) return "art:pixel-art";
  if (/\b(graphic design|design)\b/i.test(normalized)) return "art:graphic-design";
  if (/\b(visual style|aesthetic|style)\b/i.test(normalized)) return "art:visual-style";
  return "";
}

function canonicalizeToneTag(tag: string): string {
  const normalized = canonicalizeTag(tag);
  if (!normalized) return "";
  if (TONE_TAG_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return normalized;
  if (/\b(german|deutsch)\b/i.test(normalized)) return "language:german";
  if (/\b(english|englisch)\b/i.test(normalized)) return "language:english";
  if (/\b(simple|einfach|leicht)\b/i.test(normalized)) return "complexity:simple";
  if (/\b(complex|komplex|intellektuell|technical)\b/i.test(normalized)) return "complexity:complex";
  if (/\b(informal|locker|casual)\b/i.test(normalized)) return "register:informal";
  if (/\b(formal)\b/i.test(normalized)) return "register:formal";
  if (/\b(direct|direkt)\b/i.test(normalized)) return "directness:direct";
  if (/\b(indirect)\b/i.test(normalized)) return "directness:indirect";
  if (/\b(friendly|freundlich)\b/i.test(normalized)) return "affect:friendly";
  if (/\b(playful)\b/i.test(normalized)) return "affect:playful";
  if (/\b(serious|ernst)\b/i.test(normalized)) return "affect:serious";
  if (/\b(aggressive|aggressiv)\b/i.test(normalized)) return "affect:aggressive";
  return "";
}

function canonicalizeTopicTag(tag: string): string {
  const normalized = canonicalizeTag(tag);
  if (!normalized) return "";
  if (normalized.startsWith("topic:")) return normalized;
  for (const mapping of TOPIC_BROAD_MAPPINGS) {
    if (mapping.patterns.some((pattern) => pattern.test(normalized))) {
      return mapping.topic;
    }
  }
  return "";
}

function canonicalizeTagForCategory(
  tag: string,
  category: keyof MessageTaggingDTOValue["categories"],
): string {
  if (category === "themes") return canonicalizeThemeTag(tag);
  if (category === "humor") return canonicalizeHumorTag(tag);
  if (category === "art") return canonicalizeArtTag(tag);
  if (category === "tone") return canonicalizeToneTag(tag);
  return canonicalizeTopicTag(tag);
}

function scoreTagForSyntheticCategory(tag: ScoredTagDTOValue): ScoredTagDTOValue {
  return {
    tag: canonicalizeTag(tag.tag),
    score: Math.round(clampNumber(tag.score * SYNTHETIC_CATEGORY_SCORE_FACTOR, 0, 1) * 1000) / 1000,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function dedupeScoredTags(tags: ScoredTagDTOValue[], maxCount: number): ScoredTagDTOValue[] {
  const bestScoreByTag = new Map<string, number>();
  for (const entry of tags) {
    const tag = normalizeTagLabel(entry.tag);
    if (!tag) continue;
    const score = normalizeTagScore(entry.score);
    const previous = bestScoreByTag.get(tag) ?? -1;
    if (score > previous) {
      bestScoreByTag.set(tag, score);
    }
  }

  return [...bestScoreByTag.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxCount)
    .map(([tag, score]) => ({ tag, score }));
}

function filterTagSet(input: {
  tags: ScoredTagDTOValue[];
  maxCount: number;
  minScore: number;
  category?: keyof MessageTaggingDTOValue["categories"];
}): ScoredTagDTOValue[] {
  const bestByTag = new Map<string, number>();
  for (const entry of input.tags) {
    const score = normalizeTagScore(entry.score);
    if (score < input.minScore) continue;
    const canonical = input.category
      ? canonicalizeTagForCategory(entry.tag, input.category)
      : canonicalizeTag(entry.tag);
    if (!canonical) continue;
    if (isInstructionalNoiseTag(canonical)) continue;
    if (isGenericLowInformationTag(canonical, input.category)) continue;
    const previous = bestByTag.get(canonical) ?? -1;
    if (score > previous) {
      bestByTag.set(canonical, score);
    }
  }

  return [...bestByTag.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, input.maxCount)
    .map(([tag, score]) => ({ tag, score }));
}

function matchesAnyPattern(tag: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(tag));
}

function countPatternMatches(tag: string, patterns: RegExp[]): number {
  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(tag)) score += 1;
  }
  return score;
}

const MESSAGE_PRIMARY_CATEGORY_ORDER = ["themes", "humor", "art", "tone"] as const;
const IMAGE_PRIMARY_CATEGORY_ORDER = ["themes", "humor", "art", "tone"] as const;
const MESSAGE_CATEGORY_ORDER = [...MESSAGE_PRIMARY_CATEGORY_ORDER, "topics"] as const;
const IMAGE_CATEGORY_ORDER = [...IMAGE_PRIMARY_CATEGORY_ORDER, "objects"] as const;

function pickBestCategoryFromPatterns<CategoryKey extends string>(
  tag: string,
  categoryOrder: readonly CategoryKey[],
  patternMap: Record<CategoryKey, RegExp[]>,
): CategoryKey | null {
  let bestCategory: CategoryKey | null = null;
  let bestScore = 0;

  for (const category of categoryOrder) {
    const score = countPatternMatches(tag, patternMap[category]);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestScore > 0 ? bestCategory : null;
}

function enforceExclusiveMessageCategories(
  categories: MessageTaggingDTOValue["categories"],
): MessageTaggingDTOValue["categories"] {
  const next = createEmptyMessageTagCategories();
  const seen = new Set<string>();

  for (const key of MESSAGE_CATEGORY_ORDER) {
    const uniqueByScore = dedupeScoredTags(categories[key], MESSAGE_CATEGORY_LIMITS[key]);
    const filtered: ScoredTagDTOValue[] = [];
    for (const entry of uniqueByScore) {
      if (seen.has(entry.tag)) continue;
      seen.add(entry.tag);
      filtered.push(entry);
      if (filtered.length >= MESSAGE_CATEGORY_LIMITS[key]) break;
    }
    next[key] = filtered;
  }

  return next;
}

function enforceExclusiveImageCategories(
  categories: MessageTaggingDTOValue["images"][number]["categories"],
): MessageTaggingDTOValue["images"][number]["categories"] {
  const next = createEmptyImageTagCategories();
  const seen = new Set<string>();

  for (const key of IMAGE_CATEGORY_ORDER) {
    const uniqueByScore = dedupeScoredTags(categories[key], TAGGING_MAX_IMAGE_TAGS);
    const filtered: ScoredTagDTOValue[] = [];
    for (const entry of uniqueByScore) {
      if (seen.has(entry.tag)) continue;
      seen.add(entry.tag);
      filtered.push(entry);
      if (filtered.length >= TAGGING_MAX_IMAGE_TAGS) break;
    }
    next[key] = filtered;
  }

  return next;
}

function classifyMessageTagsToCategories(tags: ScoredTagDTOValue[]): MessageTaggingDTOValue["categories"] {
  const categories = createEmptyMessageTagCategories();
  const patternMap: Record<(typeof MESSAGE_PRIMARY_CATEGORY_ORDER)[number], RegExp[]> = {
    themes: MESSAGE_THEME_PATTERNS,
    humor: MESSAGE_HUMOR_PATTERNS,
    art: MESSAGE_ART_PATTERNS,
    tone: MESSAGE_TONE_PATTERNS,
  };

  for (const originalTag of tags) {
    const tag = scoreTagForSyntheticCategory(originalTag);
    if (!tag.tag) continue;

    const category = pickBestCategoryFromPatterns(tag.tag, MESSAGE_PRIMARY_CATEGORY_ORDER, patternMap);
    if (category) {
      const canonical = canonicalizeTagForCategory(tag.tag, category);
      if (!canonical) continue;
      categories[category].push({ ...tag, tag: canonical });
      continue;
    }
    const broadTopic = canonicalizeTopicTag(tag.tag);
    if (!broadTopic) continue;
    categories.topics.push({ ...tag, tag: broadTopic });
  }

  categories.themes = filterTagSet({
    tags: categories.themes,
    maxCount: MESSAGE_CATEGORY_LIMITS.themes,
    minScore: TAGGING_MIN_CATEGORY_SCORE,
    category: "themes",
  });
  categories.humor = filterTagSet({
    tags: categories.humor,
    maxCount: MESSAGE_CATEGORY_LIMITS.humor,
    minScore: TAGGING_MIN_CATEGORY_SCORE,
    category: "humor",
  });
  categories.art = filterTagSet({
    tags: categories.art,
    maxCount: MESSAGE_CATEGORY_LIMITS.art,
    minScore: TAGGING_MIN_CATEGORY_SCORE,
    category: "art",
  });
  categories.tone = filterTagSet({
    tags: categories.tone,
    maxCount: MESSAGE_CATEGORY_LIMITS.tone,
    minScore: TAGGING_MIN_CATEGORY_SCORE,
    category: "tone",
  });
  categories.topics = filterTagSet({
    tags: categories.topics,
    maxCount: MESSAGE_CATEGORY_LIMITS.topics,
    minScore: TAGGING_MIN_CATEGORY_SCORE,
    category: "topics",
  });
  return enforceExclusiveMessageCategories(categories);
}

function classifyImageTagsToCategories(tags: ScoredTagDTOValue[]): MessageTaggingDTOValue["images"][number]["categories"] {
  const categories = createEmptyImageTagCategories();
  const patternMap: Record<(typeof IMAGE_PRIMARY_CATEGORY_ORDER)[number], RegExp[]> = {
    themes: IMAGE_THEME_PATTERNS,
    humor: IMAGE_HUMOR_PATTERNS,
    art: IMAGE_ART_PATTERNS,
    tone: IMAGE_TONE_PATTERNS,
  };
  const unmatched: ScoredTagDTOValue[] = [];
  const objectCandidates: ScoredTagDTOValue[] = [];

  for (const originalTag of tags) {
    const tag = scoreTagForSyntheticCategory(originalTag);
    if (!tag.tag) continue;
    const category = pickBestCategoryFromPatterns(tag.tag, IMAGE_PRIMARY_CATEGORY_ORDER, patternMap);
    if (category) {
      categories[category].push(tag);
      continue;
    }

    unmatched.push(tag);
    if (matchesAnyPattern(tag.tag, IMAGE_OBJECT_PATTERNS)) {
      objectCandidates.push(tag);
    }
  }

  categories.themes = dedupeScoredTags(categories.themes, TAGGING_MAX_IMAGE_TAGS);
  categories.humor = dedupeScoredTags(categories.humor, TAGGING_MAX_IMAGE_TAGS);
  categories.art = dedupeScoredTags(categories.art, TAGGING_MAX_IMAGE_TAGS);
  categories.tone = dedupeScoredTags(categories.tone, TAGGING_MAX_IMAGE_TAGS);
  categories.objects = dedupeScoredTags(objectCandidates.length > 0 ? objectCandidates : unmatched, TAGGING_MAX_IMAGE_TAGS);
  return enforceExclusiveImageCategories(categories);
}

function mergeAndFillCategoryLists(
  existing: ScoredTagDTOValue[],
  synthesized: ScoredTagDTOValue[],
  maxCount: number,
): ScoredTagDTOValue[] {
  return dedupeScoredTags([...existing, ...synthesized], maxCount);
}

function createFallbackCategoryTag(
  label: string,
  used: Set<string>,
  score = 0.34,
): ScoredTagDTOValue {
  const normalizedBase = normalizeTagLabel(label) || "general";
  let next = normalizedBase;
  let index = 2;
  while (used.has(next)) {
    next = normalizeTagLabel(`${normalizedBase} ${index}`) || `${normalizedBase}-${index}`;
    index += 1;
  }
  return {
    tag: next,
    score: normalizeTagScore(score),
  };
}

function pickCategoryFallbackTag(input: {
  candidates: ScoredTagDTOValue[];
  used: Set<string>;
  preferredPatterns?: RegExp[];
  fallbackLabel: string;
  fallbackScore?: number;
}): ScoredTagDTOValue {
  if (input.preferredPatterns && input.preferredPatterns.length > 0) {
    const matched = input.candidates.find((entry) =>
      !input.used.has(entry.tag) && matchesAnyPattern(entry.tag, input.preferredPatterns!));
    if (matched) return matched;
  }

  const nextUnused = input.candidates.find((entry) => !input.used.has(entry.tag));
  if (nextUnused) return nextUnused;

  return createFallbackCategoryTag(input.fallbackLabel, input.used, input.fallbackScore);
}

function ensureMessageCategoriesPopulated(
  categories: MessageTaggingDTOValue["categories"],
  sourceMessage: string,
): MessageTaggingDTOValue["categories"] {
  const next: MessageTaggingDTOValue["categories"] = {
    themes: filterTagSet({
      tags: categories.themes,
      maxCount: MESSAGE_CATEGORY_LIMITS.themes,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "themes",
    }),
    humor: filterTagSet({
      tags: categories.humor,
      maxCount: MESSAGE_CATEGORY_LIMITS.humor,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "humor",
    }),
    art: filterTagSet({
      tags: categories.art,
      maxCount: MESSAGE_CATEGORY_LIMITS.art,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "art",
    }),
    tone: filterTagSet({
      tags: categories.tone,
      maxCount: MESSAGE_CATEGORY_LIMITS.tone,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "tone",
    }),
    topics: filterTagSet({
      tags: categories.topics,
      maxCount: MESSAGE_CATEGORY_LIMITS.topics,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "topics",
    }),
  };

  const tone = [...next.tone];
  const hasLanguageMarker = tone.some((entry) => entry.tag.startsWith("language:"));
  const hasComplexityMarker = tone.some((entry) => entry.tag.startsWith("complexity:"));
  const normalizedMessage = sourceMessage.toLowerCase();
  const germanSignals = (normalizedMessage.match(/\b(der|die|das|und|nicht|ist|ein|eine)\b/g) || []).length
    + (/[äöüß]/i.test(sourceMessage) ? 1 : 0);
  const englishSignals = (normalizedMessage.match(/\b(the|and|is|are|this|that|with)\b/g) || []).length;

  if (!hasLanguageMarker) {
    if (germanSignals > englishSignals && germanSignals > 0) {
      tone.push({ tag: "language:german", score: TAGGING_MIN_CATEGORY_SCORE });
    } else if (englishSignals > 0) {
      tone.push({ tag: "language:english", score: TAGGING_MIN_CATEGORY_SCORE });
    }
  }

  if (!hasComplexityMarker) {
    const words = sourceMessage
      .replace(/@\w+/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length > 0) {
      const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
      tone.push({
        tag: avgWordLength >= 6 ? "complexity:complex" : "complexity:simple",
        score: TAGGING_MIN_CATEGORY_SCORE,
      });
    }
  }

  next.tone = filterTagSet({
    tags: tone,
    maxCount: MESSAGE_CATEGORY_LIMITS.tone,
    minScore: TAGGING_MIN_CATEGORY_SCORE,
    category: "tone",
  });
  return enforceExclusiveMessageCategories(next);
}

function ensureImageCategoriesPopulated(
  categories: MessageTaggingDTOValue["images"][number]["categories"],
  imageTags: ScoredTagDTOValue[],
): MessageTaggingDTOValue["images"][number]["categories"] {
  const next = createEmptyImageTagCategories();
  for (const key of IMAGE_CATEGORY_ORDER) {
    next[key] = categories[key].slice(0, TAGGING_MAX_IMAGE_TAGS);
  }

  const used = new Set(
    [...next.themes, ...next.humor, ...next.art, ...next.tone, ...next.objects]
      .map((entry) => entry.tag),
  );
  const candidates = dedupeScoredTags(imageTags, TAGGING_MAX_IMAGE_TAGS);

  const fillIfEmpty = (
    key: keyof MessageTaggingDTOValue["images"][number]["categories"],
    patterns: RegExp[] | undefined,
    fallbackLabel: string,
    fallbackScore?: number,
  ) => {
    if (next[key].length > 0) return;
    const picked = pickCategoryFallbackTag({
      candidates,
      used,
      preferredPatterns: patterns,
      fallbackLabel,
      fallbackScore,
    });
    used.add(picked.tag);
    next[key] = [picked];
  };

  fillIfEmpty("themes", IMAGE_THEME_PATTERNS, "szene", 0.36);
  fillIfEmpty("humor", IMAGE_HUMOR_PATTERNS, "leichter humor", 0.32);
  fillIfEmpty("art", IMAGE_ART_PATTERNS, "visueller stil", 0.32);
  fillIfEmpty("tone", IMAGE_TONE_PATTERNS, "neutraler ton", 0.32);
  fillIfEmpty("objects", IMAGE_OBJECT_PATTERNS, "objekt", 0.38);

  return enforceExclusiveImageCategories(next);
}

function collectImageUrlsForTagging(imageUrls: string[]): string[] {
  const unique = new Set<string>();
  for (const imageUrl of imageUrls) {
    const normalized = normalizeAiImageUrlCandidate(imageUrl);
    if (!normalized) continue;
    unique.add(normalized);
  }
  return [...unique].slice(0, 4);
}

function isGifImageSource(url: string): boolean {
  const normalized = normalizeAiImageUrlCandidate(url).toLowerCase();
  if (normalized.startsWith("data:image/gif")) return true;
  return /\.gif(\?.*)?$/i.test(normalized);
}

async function loadImageBytesForTagging(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    const commaIndex = url.indexOf(",");
    assert(commaIndex > 0, "Invalid data URL for GIF tagging", 400);
    const metadata = url.slice(5, commaIndex).toLowerCase();
    const rawData = url.slice(commaIndex + 1);
    if (metadata.includes(";base64")) {
      return Buffer.from(rawData, "base64");
    }
    return Buffer.from(decodeURIComponent(rawData), "utf8");
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch GIF for tagging (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

function selectGifFrameIndexes(frameCount: number): number[] {
  if (frameCount <= 1) return [0, 0, 0];
  const last = frameCount - 1;
  const middle = Math.floor(last / 2);
  return [0, middle, last];
}

function renderGifFramesToRgbaSnapshots(bytes: Buffer): Array<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gif = parseGIF(arrayBuffer);

  const width = Number(gif.lsd.width || 0);
  const height = Number(gif.lsd.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid GIF dimensions for tagging");
  }

  const frames = decompressFrames(gif, true);
  if (frames.length === 0) {
    throw new Error("GIF has no frames for tagging");
  }

  let canvas = new Uint8ClampedArray(width * height * 4);
  const rendered: Uint8ClampedArray[] = [];

  for (const frame of frames) {
    const dims = frame.dims;
    const patch = frame.patch;
    if (!dims || !patch) continue;

    const left = Math.max(0, Number(dims.left || 0));
    const top = Math.max(0, Number(dims.top || 0));
    const frameWidth = Math.max(0, Number(dims.width || 0));
    const frameHeight = Math.max(0, Number(dims.height || 0));
    if (frameWidth === 0 || frameHeight === 0) continue;

    const previousCanvas = frame.disposalType === 3 ? canvas.slice() : null;

    for (let y = 0; y < frameHeight; y += 1) {
      const destY = top + y;
      if (destY < 0 || destY >= height) continue;
      for (let x = 0; x < frameWidth; x += 1) {
        const destX = left + x;
        if (destX < 0 || destX >= width) continue;
        const src = (y * frameWidth + x) * 4;
        const dst = (destY * width + destX) * 4;
        canvas[dst] = patch[src] ?? 0;
        canvas[dst + 1] = patch[src + 1] ?? 0;
        canvas[dst + 2] = patch[src + 2] ?? 0;
        canvas[dst + 3] = patch[src + 3] ?? 0;
      }
    }

    rendered.push(canvas.slice());

    if (frame.disposalType === 2) {
      for (let y = 0; y < frameHeight; y += 1) {
        const destY = top + y;
        if (destY < 0 || destY >= height) continue;
        for (let x = 0; x < frameWidth; x += 1) {
          const destX = left + x;
          if (destX < 0 || destX >= width) continue;
          const dst = (destY * width + destX) * 4;
          canvas[dst] = 0;
          canvas[dst + 1] = 0;
          canvas[dst + 2] = 0;
          canvas[dst + 3] = 0;
        }
      }
    } else if (frame.disposalType === 3 && previousCanvas) {
      canvas = previousCanvas;
    }
  }

  if (rendered.length === 0) {
    throw new Error("GIF frame rendering failed for tagging");
  }

  return selectGifFrameIndexes(rendered.length).map((index) => ({
    width,
    height,
    rgba: rendered[index] ?? rendered[rendered.length - 1],
  }));
}

function rgbaToPngDataUrl(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): string {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  const encoded = PNG.sync.write(png);
  return `data:image/png;base64,${encoded.toString("base64")}`;
}

async function convertGifToPngFrameUrls(sourceGifUrl: string): Promise<string[]> {
  const bytes = await loadImageBytesForTagging(sourceGifUrl);
  const snapshots = renderGifFramesToRgbaSnapshots(bytes);
  return snapshots.slice(0, TAGGING_GIF_FRAME_COUNT).map((snapshot) =>
    rgbaToPngDataUrl(snapshot.width, snapshot.height, snapshot.rgba),
  );
}

async function prepareTaggingImageSources(imageUrls: string[]): Promise<TaggingImageSource[]> {
  const sources: TaggingImageSource[] = [];

  for (const sourceImageUrl of imageUrls) {
    if (isGifImageSource(sourceImageUrl)) {
      const frames = await convertGifToPngFrameUrls(sourceImageUrl);
      if (frames.length === 0) {
        throw new Error("GIF conversion produced no PNG frames");
      }
      while (frames.length < TAGGING_GIF_FRAME_COUNT) {
        frames.push(frames[frames.length - 1] || frames[0]);
      }
      sources.push({
        sourceImageUrl,
        analysisImageUrls: frames.slice(0, TAGGING_GIF_FRAME_COUNT),
      });
      continue;
    }

    sources.push({
      sourceImageUrl,
      analysisImageUrls: [sourceImageUrl],
    });
  }

  return sources;
}

function buildTaggingRequestText(payload: { username: string; message: string; imageSources: TaggingImageSource[] }): string {
  return [
    TAGGING_MODEL_PROMPT,
    "",
    `username: ${payload.username}`,
    `message: ${payload.message}`,
    `imageSources: ${payload.imageSources.length > 0
      ? JSON.stringify(
        payload.imageSources.map((source) => ({
          sourceImageUrl: source.sourceImageUrl,
          analysisImageCount: source.analysisImageUrls.length,
        })),
      )
      : "[]"}`,
    "Analysis images are attached in exact source order. Use all analysis frames for GIF sources and return one images entry per sourceImageUrl.",
  ].join("\n");
}

function normalizeGeneratedTaggingPayload(input: {
  rawText: string;
  sourceImageUrls: string[];
  model: string;
  message: string;
}): StoredTaggingPayload {
  const normalizedText = input.rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedText);
  } catch {
    throw new Error("Tagging response is not valid JSON");
  }

  const record = asRecord(parsed);
  if (!record) {
    throw new Error("Tagging response JSON must be an object");
  }

  const normalizedModelCategories = normalizeMessageTagCategories(record.categories);
  const modelCategories: MessageTaggingDTOValue["categories"] = {
    themes: filterTagSet({
      tags: normalizedModelCategories.themes,
      maxCount: MESSAGE_CATEGORY_LIMITS.themes,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "themes",
    }),
    humor: filterTagSet({
      tags: normalizedModelCategories.humor,
      maxCount: MESSAGE_CATEGORY_LIMITS.humor,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "humor",
    }),
    art: filterTagSet({
      tags: normalizedModelCategories.art,
      maxCount: MESSAGE_CATEGORY_LIMITS.art,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "art",
    }),
    tone: filterTagSet({
      tags: normalizedModelCategories.tone,
      maxCount: MESSAGE_CATEGORY_LIMITS.tone,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "tone",
    }),
    topics: filterTagSet({
      tags: normalizedModelCategories.topics,
      maxCount: MESSAGE_CATEGORY_LIMITS.topics,
      minScore: TAGGING_MIN_CATEGORY_SCORE,
      category: "topics",
    }),
  };
  const modelCategoryTags = [
    ...modelCategories.themes,
    ...modelCategories.humor,
    ...modelCategories.art,
    ...modelCategories.tone,
    ...modelCategories.topics,
  ];

  let messageTags = filterTagSet({
    tags: normalizeScoredTags(record.messageTags, TAGGING_MAX_MESSAGE_TAGS),
    maxCount: TAGGING_MAX_MESSAGE_TAGS,
    minScore: TAGGING_MIN_MESSAGE_SCORE,
  });
  if (messageTags.length < TAGGING_MESSAGE_TARGET_MIN) {
    messageTags = appendUniqueTags(messageTags, modelCategoryTags, TAGGING_MAX_MESSAGE_TAGS);
  }

  const synthesizedMessageCategories = classifyMessageTagsToCategories(messageTags);
  const mergedMessageCategories = enforceExclusiveMessageCategories({
    themes: mergeAndFillCategoryLists(
      modelCategories.themes,
      synthesizedMessageCategories.themes,
      MESSAGE_CATEGORY_LIMITS.themes,
    ),
    humor: mergeAndFillCategoryLists(
      modelCategories.humor,
      synthesizedMessageCategories.humor,
      MESSAGE_CATEGORY_LIMITS.humor,
    ),
    art: mergeAndFillCategoryLists(
      modelCategories.art,
      synthesizedMessageCategories.art,
      MESSAGE_CATEGORY_LIMITS.art,
    ),
    tone: mergeAndFillCategoryLists(
      modelCategories.tone,
      synthesizedMessageCategories.tone,
      MESSAGE_CATEGORY_LIMITS.tone,
    ),
    topics: mergeAndFillCategoryLists(
      modelCategories.topics,
      synthesizedMessageCategories.topics,
      MESSAGE_CATEGORY_LIMITS.topics,
    ),
  });
  const categories = ensureMessageCategoriesPopulated(mergedMessageCategories, input.message);
  messageTags = filterTagSet({
    tags: appendUniqueTags(
      messageTags,
      [...categories.themes, ...categories.humor, ...categories.art, ...categories.tone, ...categories.topics],
      TAGGING_MAX_MESSAGE_TAGS,
    ),
    maxCount: TAGGING_MAX_MESSAGE_TAGS,
    minScore: TAGGING_MIN_MESSAGE_SCORE,
  });

  const sourceImageUrls = collectImageUrlsForTagging(input.sourceImageUrls);
  const returnedImages = normalizeTaggedImages(record.images);
  const imageByUrl = new Map(returnedImages.map((image) => [normalizeAiImageUrlCandidate(image.imageUrl), image]));

  const images = sourceImageUrls.map((sourceImageUrl) => {
    const image = imageByUrl.get(sourceImageUrl);
    if (!image) {
      return {
        imageUrl: sourceImageUrl,
        tags: [],
        categories: createEmptyImageTagCategories(),
      };
    }

    const modelImageCategories = image.categories;
    const modelImageCategoryTags = [
      ...modelImageCategories.themes,
      ...modelImageCategories.humor,
      ...modelImageCategories.art,
      ...modelImageCategories.tone,
      ...modelImageCategories.objects,
    ];
    const baseTags = image.tags.length < 12
      ? appendUniqueTags(image.tags, modelImageCategoryTags, TAGGING_MAX_IMAGE_TAGS)
      : image.tags.slice(0, TAGGING_MAX_IMAGE_TAGS);
    const synthesizedImageCategories = classifyImageTagsToCategories(baseTags);
    const mergedImageCategories = enforceExclusiveImageCategories({
      themes: mergeAndFillCategoryLists(
        modelImageCategories.themes,
        synthesizedImageCategories.themes,
        TAGGING_MAX_IMAGE_TAGS,
      ),
      humor: mergeAndFillCategoryLists(
        modelImageCategories.humor,
        synthesizedImageCategories.humor,
        TAGGING_MAX_IMAGE_TAGS,
      ),
      art: mergeAndFillCategoryLists(
        modelImageCategories.art,
        synthesizedImageCategories.art,
        TAGGING_MAX_IMAGE_TAGS,
      ),
      tone: mergeAndFillCategoryLists(
        modelImageCategories.tone,
        synthesizedImageCategories.tone,
        TAGGING_MAX_IMAGE_TAGS,
      ),
      objects: mergeAndFillCategoryLists(
        modelImageCategories.objects,
        synthesizedImageCategories.objects,
        TAGGING_MAX_IMAGE_TAGS,
      ),
    });
    const categories = ensureImageCategoriesPopulated(mergedImageCategories, baseTags);
    const mergedImageCategoryTags = [
      ...categories.themes,
      ...categories.humor,
      ...categories.art,
      ...categories.tone,
      ...categories.objects,
    ];
    const tags = baseTags.length < 12
      ? appendUniqueTags(baseTags, mergedImageCategoryTags, TAGGING_MAX_IMAGE_TAGS)
      : baseTags.slice(0, TAGGING_MAX_IMAGE_TAGS);

    return {
      imageUrl: sourceImageUrl,
      tags,
      categories,
    };
  });

  return {
    provider: TAGGING_PROVIDER,
    model: input.model,
    language: TAGGING_LANGUAGE,
    generatedAt: new Date().toISOString(),
    messageTags,
    categories,
    images,
  };
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
const AI_POLL_OPTION_LINE_REGEX = /^\s*(?:(?:\d{1,2}|[A-Oa-o])[.)]|[-*])\s+(.+)$/;
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

  const preOptionLines = firstOptionIndex > 0 ? lines.slice(0, firstOptionIndex) : lines;
  const nonOptionHintLines = preOptionLines.filter(
    (line) => AI_POLL_HINT_REGEX.test(line) && !AI_POLL_OPTION_LINE_REGEX.test(line),
  );
  const headingLine = [...nonOptionHintLines].reverse().find((line) => line.includes(":"))
    || [...nonOptionHintLines].reverse()[0];
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
  const hasPollIntent = isLikelyPollIntent(cleanedPrompt);
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
      ? "Bildanalyse ist für @grok erlaubt. Bildgenerierung und Bildbearbeitung sind deaktiviert. Wenn der User Bildgenerierung oder Bildbearbeitung verlangt, sag kurz, dass er dafür @chatgpt nutzen soll."
      : "Wenn ein Bild gewünscht wird, liefere den Inhalt normal weiter und behaupte nicht, dass du keine Bilder generieren kannst.",
    hasImageInputs
      ? provider === "grok"
        ? "Die Nachricht enthält Bild-Inputs. Nutze sie nur für textliche Analyse/Beschreibung, nicht für Bildgenerierung."
        : "Die Nachricht enthält Bild-Inputs. Falls ein Bild gewünscht ist, nutze sie als Referenz-/Bearbeitungsbilder."
      : "",
    hasPollIntent
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

async function queueTaggingForCreatedMessage(input: {
  messageId: string;
  username: string;
  message: string;
  imageUrls: string[];
}): Promise<void> {
  if (hasGrokApiKey()) {
    try {
      await enqueueMessageTagging({
        sourceMessageId: input.messageId,
        username: input.username,
        message: input.message,
        imageUrls: input.imageUrls,
      });
    } catch (error) {
      await updateMessageTaggingState({
        messageId: input.messageId,
        status: AiJobStatus.FAILED,
        payload: null,
        error: error instanceof Error ? error.message : "Tagging queue enqueue failed",
        generatedAt: null,
      });
    }
    return;
  }

  await updateMessageTaggingState({
    messageId: input.messageId,
    status: AiJobStatus.FAILED,
    payload: null,
    error: "GROK_API_KEY fehlt für Tagging.",
    generatedAt: null,
  });
}

async function createAiMessageRecord(input: {
  provider: AiProvider;
  threadMessageId: string;
  content: string;
  queueTagging?: boolean;
}): Promise<MessageRow> {
  const created = await prisma.message.create({
    data: {
      type: MessageType.MESSAGE,
      content: input.content,
      questionMessageId: input.threadMessageId,
      authorName: getAiProviderDisplayName(input.provider),
      authorProfilePicture: getAiProviderAvatar(input.provider),
      taggingStatus: AiJobStatus.PENDING,
      taggingPayload: Prisma.JsonNull,
      taggingUpdatedAt: null,
      taggingError: null,
    },
    include: MESSAGE_INCLUDE,
  });
  invalidateMediaCache();
  publish("message.created", mapMessage(created));
  if (input.queueTagging !== false) {
    await queueTaggingForCreatedMessage({
      messageId: created.id,
      username: created.authorName,
      message: created.content,
      imageUrls: extractImageUrlsForAi(created.content),
    });
  }
  return created;
}

async function createAiMessage(input: {
  provider: AiProvider;
  threadMessageId: string;
  content: string;
}): Promise<void> {
  await createAiMessageRecord({
    provider: input.provider,
    threadMessageId: input.threadMessageId,
    content: input.content,
    queueTagging: true,
  });
}

async function updateAiMessageContent(input: {
  messageId: string;
  content: string;
  queueTagging?: boolean;
}): Promise<void> {
  const updated = await prisma.message.update({
    where: { id: input.messageId },
    data: {
      content: input.content,
    },
    include: MESSAGE_INCLUDE,
  });
  invalidateMediaCache();
  publish("message.updated", mapMessage(updated));
  if (input.queueTagging !== false) {
    await queueTaggingForCreatedMessage({
      messageId: updated.id,
      username: updated.authorName,
      message: updated.content,
      imageUrls: extractImageUrlsForAi(updated.content),
    });
  }
}

async function streamAiTextToMessage(input: {
  provider: AiProvider;
  threadMessageId: string;
  responsesApi: {
    stream?: (request: unknown) => {
      on?: (event: string, handler: (payload: { delta?: string }) => void) => void;
      finalResponse: () => Promise<OpenAIResponse>;
    };
  };
  buildRequest: (mode: AiInputMode) => Promise<unknown>;
}): Promise<{
  supported: boolean;
  messageId: string | null;
  rawOutputText: string;
  model?: string;
}> {
  if (typeof input.responsesApi.stream !== "function") {
    return { supported: false, messageId: null, rawOutputText: "", model: undefined };
  }

  let messageId: string | null = null;
  let model: string | undefined;
  let text = "";
  let lastPublishedLength = 0;
  let lastPublishedAt = 0;
  let flushChain: Promise<void> = Promise.resolve();

  const flush = (force = false) => {
    flushChain = flushChain.then(async () => {
      const candidate = text;
      if (!candidate.trim()) return;

      const now = Date.now();
      const deltaLength = candidate.length - lastPublishedLength;
      const shouldSkip = !force
        && deltaLength < 18
        && now - lastPublishedAt < 120
        && !candidate.endsWith("\n");
      if (shouldSkip) return;

      if (!messageId) {
        const created = await createAiMessageRecord({
          provider: input.provider,
          threadMessageId: input.threadMessageId,
          content: candidate,
          queueTagging: false,
        });
        messageId = created.id;
      } else {
        await updateAiMessageContent({
          messageId,
          content: candidate,
          queueTagging: false,
        });
      }

      lastPublishedLength = candidate.length;
      lastPublishedAt = now;
    });
    return flushChain;
  };

  const runMode = async (mode: AiInputMode): Promise<OpenAIResponse> => {
    const stream = await input.responsesApi.stream!(await input.buildRequest(mode));
    if (!stream || typeof stream.finalResponse !== "function") {
      throw new Error("STREAM_UNAVAILABLE");
    }
    stream.on?.("response.output_text.delta", (event) => {
      if (typeof event.delta !== "string" || !event.delta) return;
      text += event.delta;
      void flush(false);
    });
    const finalResponse = await stream.finalResponse();
    model = resolveModelFromResponse(finalResponse) || model;
    await flush(true);
    const finalText = stripLeadingAiMentions(finalResponse.output_text?.trim() || "");
    if (finalText && finalText !== text) {
      text = finalText;
      await flush(true);
    }
    return finalResponse;
  };

  try {
    await runMode("full");
  } catch (error) {
    if (isContextWindowError(error)) {
      try {
        await runMode("minimal");
      } catch (minimalError) {
        if (!messageId) {
          return { supported: false, messageId: null, rawOutputText: "", model: undefined };
        }
        throw minimalError;
      }
    } else if (!messageId) {
      return { supported: false, messageId: null, rawOutputText: "", model: undefined };
    } else {
      throw error;
    }
  }

  await flushChain;

  return {
    supported: true,
    messageId,
    rawOutputText: stripLeadingAiMentions(text.trim()),
    model,
  };
}

async function createAiPollMessage(input: {
  provider: AiProvider;
  threadMessageId: string;
  question: string;
  options: string[];
  multiSelect: boolean;
}): Promise<void> {
  const created = await prisma.message.create({
    data: {
      type: MessageType.VOTING_POLL,
      content: input.question,
      questionMessageId: input.threadMessageId,
      authorName: getAiProviderDisplayName(input.provider),
      authorProfilePicture: getAiProviderAvatar(input.provider),
      optionOne: input.options[0] || null,
      optionTwo: input.options[1] || null,
      pollMultiSelect: input.multiSelect,
      pollAllowVoteChange: true,
      pollLeftCount: 0,
      pollRightCount: 0,
      taggingStatus: AiJobStatus.PENDING,
      taggingPayload: Prisma.JsonNull,
      taggingUpdatedAt: null,
      taggingError: null,
      pollOptions: {
        create: input.options.map((label, sortOrder) => ({
          label,
          sortOrder,
        })),
      },
    },
    include: MESSAGE_INCLUDE,
  });
  invalidateMediaCache();
  publish("message.created", mapMessage(created));
  const pollTaggingMessage = [input.question, ...input.options.map((option, index) => `${index + 1}. ${option}`)]
    .filter(Boolean)
    .join("\n");
  await queueTaggingForCreatedMessage({
    messageId: created.id,
    username: created.authorName,
    message: pollTaggingMessage,
    imageUrls: [],
  });
}

async function emitAiBusyNotice(threadMessageId: string, provider: AiProvider): Promise<void> {
  const now = Date.now();
  if (now - lastAiBusyNoticeAt < AI_BUSY_NOTICE_COOLDOWN_MS) return;
  lastAiBusyNoticeAt = now;
  await createAiMessage({
    provider,
    threadMessageId,
    content: `Zu viele ${getAiProviderMention(provider)} Anfragen gleichzeitig. Bitte in wenigen Sekunden erneut versuchen.`,
  });
}

async function emitAiResponse(payload: AiTriggerPayload): Promise<void> {
  if (!isProviderConfigured(payload.provider)) return;
  const threadMessageId = payload.threadMessageId ?? payload.sourceMessageId;

  publishAiStatus(payload.provider, "denkt nach…", {
    model: payload.provider === "grok" ? getGrokRuntimeConfig().textModel : undefined,
  });

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

      const shouldTryRealtimeText = !useImageGenerationTool && !isLikelyPollIntent(cleanedMessage);
      if (shouldTryRealtimeText) {
        const streamResult = await streamAiTextToMessage({
          provider: payload.provider,
          threadMessageId,
          responsesApi: openai.responses as unknown as {
            stream?: (request: unknown) => {
              on?: (event: string, handler: (payload: { delta?: string }) => void) => void;
              finalResponse: () => Promise<OpenAIResponse>;
            };
          },
          buildRequest: async (mode) => buildRequest({ mode }),
        });

        if (streamResult.supported) {
          const outputWithoutPoll = stripAiPollBlocks(streamResult.rawOutputText);
          const text = outputWithoutPoll.trim();
          const finalText = !text || text === "[NO_RESPONSE]"
            ? "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal."
            : text;

          publishAiStatus(payload.provider, "schreibt…", { model: streamResult.model });
          if (streamResult.messageId) {
            await updateAiMessageContent({
              messageId: streamResult.messageId,
              content: finalText,
              queueTagging: true,
            });
          } else {
            await createAiMessage({
              provider: payload.provider,
              threadMessageId,
              content: finalText,
            });
          }
          return;
        }
      }

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
      const responseModel = resolveModelFromResponse(response);

      const hasImageOutput = Array.isArray(response.output)
        && response.output.some((item) => item.type === "image_generation_call");
      if (hasImageOutput) {
        publishAiStatus(payload.provider, "erstellt Bild…", { model: responseModel });
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
        publishAiStatus(payload.provider, "schreibt…", { model: responseModel });
        await createAiPollMessage({
          provider: payload.provider,
          threadMessageId,
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
        publishAiStatus(payload.provider, "schreibt…", { model: responseModel });
        await createAiMessage({
          provider: payload.provider,
          threadMessageId,
          content: "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal.",
        });
        return;
      }

      publishAiStatus(payload.provider, "schreibt…", { model: responseModel });
      await createAiMessage({
        provider: payload.provider,
        threadMessageId,
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
      publishAiStatus(payload.provider, "schreibt…", { model: grokConfig.textModel });
      await createAiMessage({
        provider: payload.provider,
        threadMessageId,
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

    const shouldTryRealtimeText = !isLikelyPollIntent(cleanedMessage);
    if (shouldTryRealtimeText) {
      const streamResult = await streamAiTextToMessage({
        provider: payload.provider,
        threadMessageId,
        responsesApi: grok.responses as unknown as {
          stream?: (request: unknown) => {
            on?: (event: string, handler: (payload: { delta?: string }) => void) => void;
            finalResponse: () => Promise<OpenAIResponse>;
          };
        },
        buildRequest: buildGrokRequest,
      });

      if (streamResult.supported) {
        const text = stripAiPollBlocks(streamResult.rawOutputText).trim();
        const finalText = !text || text === "[NO_RESPONSE]"
          ? "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal."
          : text;

        publishAiStatus(payload.provider, "schreibt…", {
          model: streamResult.model || grokConfig.textModel,
        });
        if (streamResult.messageId) {
          await updateAiMessageContent({
            messageId: streamResult.messageId,
            content: finalText,
            queueTagging: true,
          });
        } else {
          await createAiMessage({
            provider: payload.provider,
            threadMessageId,
            content: finalText,
          });
        }
        return;
      }
    }

    let response: OpenAIResponse;
    try {
      response = (await grok.responses.create(await buildGrokRequest("full"))) as OpenAIResponse;
    } catch (error) {
      if (!isContextWindowError(error)) {
        throw error;
      }
      response = (await grok.responses.create(await buildGrokRequest("minimal"))) as OpenAIResponse;
    }
    const responseModel = resolveModelFromResponse(response) || grokConfig.textModel;

    const rawOutputText = stripLeadingAiMentions(response.output_text?.trim() || "");
    const pollPayload = extractAiPollPayload(rawOutputText);
    if (pollPayload) {
      publishAiStatus(payload.provider, "schreibt…", { model: responseModel });
      await createAiPollMessage({
        provider: payload.provider,
        threadMessageId,
        question: pollPayload.question,
        options: pollPayload.options,
        multiSelect: pollPayload.multiSelect,
      });
      return;
    }

    const text = stripAiPollBlocks(rawOutputText).trim();

    if (!text || text === "[NO_RESPONSE]") {
      publishAiStatus(payload.provider, "schreibt…", { model: responseModel });
      await createAiMessage({
        provider: payload.provider,
        threadMessageId,
        content: "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal.",
      });
      return;
    }

    publishAiStatus(payload.provider, "schreibt…", { model: responseModel });
    await createAiMessage({
      provider: payload.provider,
      threadMessageId,
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
      threadMessageId,
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
type EnqueueTaggingResult = "queued" | "duplicate";

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

async function resolveThreadRootMessageId(sourceMessageId: string): Promise<string> {
  const normalizedSource = sourceMessageId.trim();
  if (!normalizedSource) return sourceMessageId;

  let currentMessageId: string | null = normalizedSource;
  let resolvedMessageId = normalizedSource;
  const visited = new Set<string>();

  while (currentMessageId && !visited.has(currentMessageId)) {
    visited.add(currentMessageId);
    const row: { id: string; questionMessageId: string | null } | null = await prisma.message.findUnique({
      where: { id: currentMessageId },
      select: { id: true, questionMessageId: true },
    });
    if (!row) break;

    resolvedMessageId = row.id;
    currentMessageId = row.questionMessageId;
  }

  return resolvedMessageId;
}

interface ClaimedMessageTagJobRow {
  id: string;
  sourceMessageId: string;
  username: string;
  message: string;
  imageUrls: Prisma.JsonValue;
  attempts: number;
}

function parseTaggingJobImageUrls(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map(normalizeAiImageUrlCandidate)
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
}

function scheduleTaggingQueueDrain(): void {
  if (taggingQueueDrainScheduled) return;
  taggingQueueDrainScheduled = true;
  queueMicrotask(() => {
    taggingQueueDrainScheduled = false;
    void processTaggingQueue({ maxJobs: TAGGING_QUEUE_CONCURRENCY }).catch((error) => {
      console.error("Tagging queue worker error:", error instanceof Error ? error.message : error);
    });
  });
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
      const threadMessageId = await resolveThreadRootMessageId(job.sourceMessageId);

      for (const provider of providers) {
        if (!isProviderConfigured(provider)) continue;
        await emitAiResponse({
          provider,
          sourceMessageId: job.sourceMessageId,
          threadMessageId,
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

async function recoverStaleTaggingJobs(): Promise<void> {
  await prisma.messageTagJob.updateMany({
    where: {
      status: AiJobStatus.PROCESSING,
      OR: [
        {
          lockedAt: {
            lt: new Date(Date.now() - TAGGING_QUEUE_STALE_PROCESSING_MS),
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

async function claimNextTaggingJob(): Promise<ClaimedMessageTagJobRow | null> {
  const rows = await prisma.$queryRawUnsafe<ClaimedMessageTagJobRow[]>(`
    WITH next_job AS (
      SELECT "id"
      FROM "MessageTagJob"
      WHERE "status" = 'PENDING'::"AiJobStatus"
        AND "runAt" <= NOW()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "MessageTagJob" AS job
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

async function enqueueMessageTagging(payload: {
  sourceMessageId: string;
  username: string;
  message: string;
  imageUrls: string[];
}): Promise<EnqueueTaggingResult> {
  try {
    await prisma.messageTagJob.create({
      data: {
        sourceMessageId: payload.sourceMessageId,
        username: payload.username,
        message: payload.message,
        imageUrls: collectImageUrlsForTagging(payload.imageUrls),
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

async function generateTaggingPayloadForJob(input: {
  username: string;
  message: string;
  imageUrls: string[];
}): Promise<StoredTaggingPayload> {
  const grokConfig = getGrokRuntimeConfig();
  if (!grokConfig.apiKey) {
    throw new Error("GROK_API_KEY fehlt für Tagging.");
  }

  const grok = new OpenAI({
    apiKey: grokConfig.apiKey,
    baseURL: grokConfig.baseUrl,
  });

  const sourceImageUrls = collectImageUrlsForTagging(input.imageUrls);
  const imageSources = await prepareTaggingImageSources(sourceImageUrls);
  const analysisImageUrls = imageSources.flatMap((source) => source.analysisImageUrls);
  const baseRequest = {
    model: grokConfig.textModel,
    input: [
      {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: buildTaggingRequestText({
              username: input.username,
              message: input.message,
              imageSources,
            }),
          },
          ...analysisImageUrls.map((imageUrl) => ({
            type: "input_image" as const,
            image_url: imageUrl,
            detail: "auto" as const,
          })),
        ],
      },
    ],
    text: {
      format: { type: "text" as const },
    },
  };

  let response: OpenAIResponse;
  try {
    response = (await grok.responses.create(baseRequest)) as OpenAIResponse;
  } catch (error) {
    if (!isContextWindowError(error)) {
      throw error;
    }
    response = (await grok.responses.create({
      ...baseRequest,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildTaggingRequestText({
                username: input.username,
                message: clampText(input.message, 450),
                imageSources,
              }),
            },
            ...analysisImageUrls.map((imageUrl) => ({
              type: "input_image" as const,
              image_url: imageUrl,
              detail: "auto" as const,
            })),
          ],
        },
      ],
    })) as OpenAIResponse;
  }

  const rawText = response.output_text?.trim() || "";
  if (!rawText) {
    throw new Error("Tagging response is empty");
  }
  return normalizeGeneratedTaggingPayload({
    rawText,
    sourceImageUrls,
    model: grokConfig.textModel,
    message: input.message,
  });
}

export async function processTaggingQueue(
  input: { maxJobs?: number } = {},
): Promise<{ processed: number; lockSkipped: boolean }> {
  await recoverStaleTaggingJobs();

  const maxJobs = Math.max(1, Math.min(20, input.maxJobs ?? TAGGING_QUEUE_CONCURRENCY));
  let processed = 0;

  while (processed < maxJobs) {
    const job = await claimNextTaggingJob();
    if (!job) break;

    try {
      await updateMessageTaggingState({
        messageId: job.sourceMessageId,
        status: AiJobStatus.PROCESSING,
        payload: null,
        error: null,
        generatedAt: null,
      });

      const payload = await generateTaggingPayloadForJob({
        username: job.username,
        message: job.message,
        imageUrls: parseTaggingJobImageUrls(job.imageUrls),
      });

      await prisma.messageTagJob.update({
        where: { id: job.id },
        data: {
          status: AiJobStatus.COMPLETED,
          completedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });

      await updateMessageTaggingState({
        messageId: job.sourceMessageId,
        status: AiJobStatus.COMPLETED,
        payload: payload as unknown as Prisma.InputJsonValue,
        error: null,
        generatedAt: new Date(payload.generatedAt),
      });
    } catch (error) {
      const shouldFail = job.attempts >= TAGGING_QUEUE_MAX_ATTEMPTS;
      const retryDelayMs = Math.min(60_000, 3_000 * job.attempts);
      const errorMessage = error instanceof Error ? error.message : "Unknown tagging queue error";

      await prisma.messageTagJob.update({
        where: { id: job.id },
        data: {
          status: shouldFail ? AiJobStatus.FAILED : AiJobStatus.PENDING,
          ...(shouldFail ? {} : { runAt: new Date(Date.now() + retryDelayMs) }),
          failedAt: shouldFail ? new Date() : null,
          lockedAt: null,
          lastError: errorMessage,
        },
      });

      await updateMessageTaggingState({
        messageId: job.sourceMessageId,
        status: shouldFail ? AiJobStatus.FAILED : AiJobStatus.PENDING,
        payload: null,
        error: errorMessage,
        generatedAt: null,
      });
    }

    processed += 1;
  }

  const remaining = await prisma.messageTagJob.count({
    where: {
      status: AiJobStatus.PENDING,
      runAt: { lte: new Date() },
    },
  });
  if (remaining > 0) {
    scheduleTaggingQueueDrain();
  }

  return { processed, lockSkipped: false };
}

async function maybeRespondAsAi(payload: Omit<AiTriggerPayload, "provider">): Promise<void> {
  const mentionedProviders = detectAiProviders(payload.message);
  if (mentionedProviders.length === 0) return;
  const threadMessageId = await resolveThreadRootMessageId(payload.sourceMessageId);

  const configuredProviders = mentionedProviders.filter((provider) => isProviderConfigured(provider));
  const unconfiguredProviders = mentionedProviders.filter((provider) => !isProviderConfigured(provider));

  for (const provider of unconfiguredProviders) {
    publishAiStatus(provider, "offline");
    await createAiMessage({
      provider,
      threadMessageId,
      content: `Ich bin aktuell nicht konfiguriert. Bitte ${provider === "grok" ? "GROK_API_KEY" : "OPENAI_API_KEY"} setzen.`,
    });
  }

  if (configuredProviders.length === 0) return;

  const queued = await enqueueAiResponse(payload);
  if (queued === "full") {
    for (const provider of configuredProviders) {
      await emitAiBusyNotice(threadMessageId, provider);
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
  taggingQueueDrainScheduled = false;
  lastAiBusyNoticeAt = 0;
}

export function __extractAiPollPayloadForTests(rawText: string): AiPollPayload | null {
  return extractAiPollPayload(rawText);
}

async function getUserByClientId(clientId: string) {
  const user = await prisma.user.findUnique({
    where: { clientId },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });
  assert(user, "Nutzersitzung nicht gefunden. Bitte erneut anmelden.", 401);
  return user;
}

async function resolveViewerUserId(clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null;
  const viewer = await prisma.user.findUnique({
    where: { clientId },
    select: { id: true },
  });
  return viewer?.id ?? null;
}

export async function getSnapshot(input: { limit?: number; viewerClientId?: string } = {}): Promise<SnapshotDTO> {
  const [users, messagePage, aiStatus, background] = await Promise.all([
    getOnlineUsers(),
    getMessages({ limit: input.limit, viewerClientId: input.viewerClientId }),
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
  viewerClientId?: string;
} = {}): Promise<MessagePageDTO> {
  const page = await getPagedMessageRows(input);
  const viewerUserId = await resolveViewerUserId(input.viewerClientId);
  return {
    messages: page.rows.map((row) => mapMessage(row, { viewerUserId })),
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

function toAuthSessionResponse(user: {
  id: string;
  clientId: string;
  loginName: string | null;
  loginNameEncrypted?: string | null;
  sessionToken: string | null;
  sessionExpiresAt: Date | null;
  username: string;
  profilePicture: string;
  status: string;
  isOnline: boolean;
  lastSeenAt: Date | null;
  ppcMemberScoreRaw?: number | null;
  ppcMemberLastActiveAt?: Date | null;
}): AuthSessionDTO {
  assert(user.sessionToken, "Sitzung fehlt. Bitte erneut anmelden.", 401);
  assert(user.sessionExpiresAt, "Sitzung fehlt. Bitte erneut anmelden.", 401);

  const loginName = (() => {
    if (user.loginNameEncrypted) {
      return decryptLoginName(user.loginNameEncrypted);
    }
    if (user.loginName) {
      return normalizeLoginName(user.loginName);
    }
    throw new AppError("Konto ist unvollständig. Bitte erneut anmelden.", 401);
  })();

  const isDeveloperAlias = user.username.trim().toLowerCase().startsWith(DEVELOPER_USERNAME.toLowerCase());
  const devMode = isDeveloperAlias || isDevUnlockUsername(loginName) || isDevUnlockUsername(user.username);
  const devAuthToken = devMode ? issueDevAuthToken(user.clientId) ?? undefined : undefined;

  return {
    ...mapUser(user),
    loginName,
    sessionToken: user.sessionToken,
    sessionExpiresAt: user.sessionExpiresAt.toISOString(),
    devMode,
    devAuthToken,
  };
}

export async function signUpAccount(input: AuthSignUpRequest): Promise<AuthSessionDTO> {
  const loginName = normalizeLoginName(input.loginName);
  const loginNameLookup = hashLoginNameLookup(loginName);
  const requestedDisplayName = input.displayName.trim();
  assert(requestedDisplayName.length >= 3, "Anzeigename muss mindestens 3 Zeichen lang sein", 400);
  await assertUsernameAllowed(requestedDisplayName);

  let supportsEncryptedLoginNameColumns = true;
  let existing: { id: string } | null = null;
  try {
    existing = await prisma.user.findFirst({
      where: {
        OR: [
          { loginNameLookup },
          { loginName },
        ],
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    supportsEncryptedLoginNameColumns = false;
    markEncryptedLoginColumnsUnavailable();
    existing = await prisma.user.findFirst({
      where: { loginName },
      select: { id: true },
    });
  }
  assert(!existing, "Dieser Login-Name ist bereits vergeben", 409);

  const clientId = randomUUID();
  const sessionToken = createSessionToken();
  const sessionExpiresAt = new Date(Date.now() + AUTH_SESSION_WINDOW_MS);
  const now = new Date();

  let user: {
    id: string;
    clientId: string;
    loginName: string | null;
    loginNameEncrypted?: string | null;
    sessionToken: string | null;
    sessionExpiresAt: Date | null;
    username: string;
    profilePicture: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: Date | null;
    ppcMemberScoreRaw?: number | null;
    ppcMemberLastActiveAt?: Date | null;
  };
  try {
    user = await prisma.user.create({
      data: {
        clientId,
        loginName: supportsEncryptedLoginNameColumns ? null : loginName,
        ...(supportsEncryptedLoginNameColumns
          ? {
            loginNameEncrypted: encryptLoginName(loginName),
            loginNameLookup,
          }
          : {}),
        passwordHash: hashPassword(input.password),
        sessionToken,
        sessionExpiresAt,
        username: requestedDisplayName,
        profilePicture: input.profilePicture || getDefaultProfilePicture(),
        isOnline: true,
        status: "",
        lastSeenAt: now,
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        ...(supportsEncryptedLoginNameColumns ? { loginNameEncrypted: true } : {}),
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    }) as typeof user;
    markEncryptedLoginColumnsAvailableIfUnknown();
  } catch (error) {
    if (!supportsEncryptedLoginNameColumns || !isMissingColumnError(error)) throw error;
    supportsEncryptedLoginNameColumns = false;
    markEncryptedLoginColumnsUnavailable();
    user = await prisma.user.create({
      data: {
        clientId,
        loginName,
        passwordHash: hashPassword(input.password),
        sessionToken,
        sessionExpiresAt,
        username: requestedDisplayName,
        profilePicture: input.profilePicture || getDefaultProfilePicture(),
        isOnline: true,
        status: "",
        lastSeenAt: now,
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    }) as typeof user;
  }

  const dto = mapUser(user);
  publish("user.updated", dto);
  publish("presence.updated", dto);
  await emitSystemMessage(`${user.username} ist dem Chat beigetreten`, { authorId: user.id });
  return toAuthSessionResponse(user);
}

export async function signInAccount(input: AuthSignInRequest): Promise<AuthSessionDTO> {
  const loginName = normalizeLoginName(input.loginName);
  const loginNameLookup = hashLoginNameLookup(loginName);
  let supportsEncryptedLoginNameColumns = true;
  let existing: {
    id: string;
    clientId: string;
    loginName: string | null;
    loginNameEncrypted: string | null;
    loginNameLookup: string | null;
    passwordHash: string | null;
    sessionToken: string | null;
    sessionExpiresAt: Date | null;
    username: string;
    profilePicture: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: Date | null;
  } | null = null;
  try {
    existing = await prisma.user.findFirst({
      where: {
        OR: [
          { loginNameLookup },
          { loginName },
        ],
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        loginNameEncrypted: true,
        loginNameLookup: true,
        passwordHash: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    });
    markEncryptedLoginColumnsAvailableIfUnknown();
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    supportsEncryptedLoginNameColumns = false;
    markEncryptedLoginColumnsUnavailable();
    const legacyExisting = await prisma.user.findFirst({
      where: { loginName },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        passwordHash: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    });
    existing = legacyExisting
      ? {
        ...legacyExisting,
        loginNameEncrypted: null,
        loginNameLookup: null,
      }
      : null;
  }

  if (!existing) {
    const hasAnyAccount = await prisma.user.count({
      where: {
        passwordHash: {
          not: null,
        },
      },
    });
    if (hasAnyAccount === 0) {
      throw new AppError("Es existiert noch kein Konto. Bitte zuerst registrieren.", 401);
    }
    throw new AppError("Login fehlgeschlagen", 401);
  }
  assert(existing.passwordHash, "Login fehlgeschlagen", 401);
  assert(verifyPassword(input.password, existing.passwordHash), "Login fehlgeschlagen", 401);

  const sessionToken = createSessionToken();
  const sessionExpiresAt = new Date(Date.now() + AUTH_SESSION_WINDOW_MS);
  const now = new Date();
  const shouldMigrateLegacyLoginName = supportsEncryptedLoginNameColumns && (Boolean(existing.loginName)
    || !existing.loginNameEncrypted
    || existing.loginNameLookup !== loginNameLookup);

  let user: {
    id: string;
    clientId: string;
    loginName: string | null;
    loginNameEncrypted?: string | null;
    sessionToken: string | null;
    sessionExpiresAt: Date | null;
    username: string;
    profilePicture: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: Date | null;
    ppcMemberScoreRaw?: number | null;
    ppcMemberLastActiveAt?: Date | null;
  };
  try {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        sessionToken,
        sessionExpiresAt,
        isOnline: true,
        status: "",
        lastSeenAt: now,
        ...(shouldMigrateLegacyLoginName
          ? {
            loginNameEncrypted: encryptLoginName(loginName),
            loginNameLookup,
            loginName: null,
          }
          : {}),
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        ...(supportsEncryptedLoginNameColumns ? { loginNameEncrypted: true } : {}),
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    }) as typeof user;
    if (supportsEncryptedLoginNameColumns) {
      markEncryptedLoginColumnsAvailableIfUnknown();
    }
  } catch (error) {
    if (!supportsEncryptedLoginNameColumns || !isMissingColumnError(error)) throw error;
    supportsEncryptedLoginNameColumns = false;
    markEncryptedLoginColumnsUnavailable();
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        sessionToken,
        sessionExpiresAt,
        isOnline: true,
        status: "",
        lastSeenAt: now,
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    }) as typeof user;
  }

  const dto = mapUser(user);
  publish("user.updated", dto);
  publish("presence.updated", dto);
  return toAuthSessionResponse(user);
}

export async function restoreSession(input: LoginRequest): Promise<LoginResponseDTO> {
  let supportsEncryptedLoginNameColumns = true;
  let user: {
    id: string;
    clientId: string;
    loginName: string | null;
    loginNameEncrypted: string | null;
    passwordHash: string | null;
    sessionToken: string | null;
    sessionExpiresAt: Date | null;
    username: string;
    profilePicture: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: Date | null;
  } | null = null;
  try {
    user = await prisma.user.findFirst({
      where: {
        clientId: input.clientId,
        sessionToken: input.sessionToken,
        sessionExpiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        loginNameEncrypted: true,
        passwordHash: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    });
    markEncryptedLoginColumnsAvailableIfUnknown();
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    supportsEncryptedLoginNameColumns = false;
    markEncryptedLoginColumnsUnavailable();
    const legacyUser = await prisma.user.findFirst({
      where: {
        clientId: input.clientId,
        sessionToken: input.sessionToken,
        sessionExpiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        passwordHash: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
      },
    });
    user = legacyUser
      ? {
        ...legacyUser,
        loginNameEncrypted: null,
      }
      : null;
  }
  assert(user, "Sitzung ist abgelaufen. Bitte erneut anmelden.", 401);

  const now = new Date();
  const refreshedExpiry = new Date(Date.now() + AUTH_SESSION_WINDOW_MS);
  let updated: {
    id: string;
    clientId: string;
    username: string;
    profilePicture: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: Date | null;
    sessionToken: string | null;
    sessionExpiresAt: Date | null;
  };
  try {
    updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        isOnline: true,
        status: "",
        lastSeenAt: now,
        sessionExpiresAt: refreshedExpiry,
      },
      select: {
        id: true,
        clientId: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
        sessionToken: true,
        sessionExpiresAt: true,
      },
    });
    if (supportsEncryptedLoginNameColumns) {
      markEncryptedLoginColumnsAvailableIfUnknown();
    }
  } catch (error) {
    if (!supportsEncryptedLoginNameColumns || !isMissingColumnError(error)) throw error;
    supportsEncryptedLoginNameColumns = false;
    markEncryptedLoginColumnsUnavailable();
    updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        isOnline: true,
        status: "",
        lastSeenAt: now,
        sessionExpiresAt: refreshedExpiry,
      },
      select: {
        id: true,
        clientId: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
        sessionToken: true,
        sessionExpiresAt: true,
      },
    });
  }
  const dto = mapUser(updated);
  publish("user.updated", dto);
  publish("presence.updated", dto);
  return toAuthSessionResponse({
    ...updated,
    loginName: user.loginName,
    loginNameEncrypted: user.loginNameEncrypted,
    sessionToken: user.sessionToken,
    sessionExpiresAt: refreshedExpiry,
  });
}

async function loginUserLegacy(input: {
  username: string;
  clientId: string;
  profilePicture?: string;
}): Promise<LoginResponseDTO> {
  const requestedUsername = input.username.trim();
  assert(requestedUsername.length >= 3, "Benutzername muss mindestens 3 Zeichen lang sein", 400);
  const devMode = isDevUnlockUsername(requestedUsername) || requestedUsername.toLowerCase().startsWith(DEVELOPER_USERNAME.toLowerCase());
  const username = requestedUsername;
  await assertUsernameAllowed(username);
  await assertUsernameAvailable(username, input.clientId);

  const existingUser = await prisma.user.findUnique({
    where: { clientId: input.clientId },
    select: { isOnline: true },
  });

  const sessionToken = createSessionToken();
  const sessionExpiresAt = new Date(Date.now() + AUTH_SESSION_WINDOW_MS);

  const user = await prisma.user.upsert({
    where: { clientId: input.clientId },
    update: {
      username,
      profilePicture: input.profilePicture || getDefaultProfilePicture(),
      sessionToken,
      sessionExpiresAt,
      isOnline: true,
      status: "",
      lastSeenAt: new Date(),
    },
    create: {
      clientId: input.clientId,
      username,
      profilePicture: input.profilePicture || getDefaultProfilePicture(),
      loginName: null,
      passwordHash: null,
      sessionToken,
      sessionExpiresAt,
      isOnline: true,
      status: "",
      lastSeenAt: new Date(),
    },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

  const dto = mapUser(user);
  publish("user.updated", dto);
  publish("presence.updated", dto);

  if (!existingUser) {
    await emitSystemMessage(`${user.username} ist dem Chat beigetreten`, { authorId: user.id });
  }

  return {
    ...dto,
    loginName: `legacy-${user.clientId}`,
    sessionToken,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
    devMode,
    devAuthToken: devMode ? issueDevAuthToken(user.clientId) ?? undefined : undefined,
  };
}

export async function loginUser(
  input: LoginRequest | { username: string; clientId: string; profilePicture?: string },
): Promise<LoginResponseDTO> {
  if ("username" in input) {
    return loginUserLegacy(input);
  }
  return restoreSession(input);
}

export async function signOutAccount(input: { clientId: string }): Promise<void> {
  await prisma.user.updateMany({
    where: { clientId: input.clientId },
    data: {
      sessionToken: null,
      sessionExpiresAt: null,
      isOnline: false,
      status: "",
      lastSeenAt: new Date(),
    },
  });
}

export async function updateOwnAccount(input: UpdateOwnAccountRequest): Promise<AuthSessionDTO> {
  const nextLoginName = input.newLoginName ? normalizeLoginName(input.newLoginName) : undefined;
  const nextPassword = input.newPassword?.trim();
  assert(nextLoginName || nextPassword, "Entweder newLoginName oder newPassword ist erforderlich", 400);

  let supportsEncryptedLoginNameColumns = canUseEncryptedLoginColumns();
  let current: {
    id: string;
    clientId: string;
    loginName: string | null;
    loginNameEncrypted: string | null;
    passwordHash: string | null;
    sessionToken: string | null;
    sessionExpiresAt: Date | null;
    username: string;
    profilePicture: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: Date | null;
    ppcMemberScoreRaw?: number | null;
    ppcMemberLastActiveAt?: Date | null;
  } | null = null;

  if (supportsEncryptedLoginNameColumns) {
    try {
      current = await prisma.user.findUnique({
        where: { clientId: input.clientId },
        select: {
          id: true,
          clientId: true,
          loginName: true,
          loginNameEncrypted: true,
          passwordHash: true,
          sessionToken: true,
          sessionExpiresAt: true,
          username: true,
          profilePicture: true,
          status: true,
          isOnline: true,
          lastSeenAt: true,
          ppcMemberScoreRaw: true,
          ppcMemberLastActiveAt: true,
        },
      });
      markEncryptedLoginColumnsAvailableIfUnknown();
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      supportsEncryptedLoginNameColumns = false;
      markEncryptedLoginColumnsUnavailable();
    }
  }

  if (!supportsEncryptedLoginNameColumns) {
    const legacyCurrent = await prisma.user.findUnique({
      where: { clientId: input.clientId },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        passwordHash: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
        ppcMemberScoreRaw: true,
        ppcMemberLastActiveAt: true,
      },
    });
    current = legacyCurrent
      ? {
        ...legacyCurrent,
        loginNameEncrypted: null,
      }
      : null;
  }

  assert(current, "Nutzersitzung nicht gefunden. Bitte erneut anmelden.", 401);

  const currentLoginName = current.loginNameEncrypted
    ? decryptLoginName(current.loginNameEncrypted)
    : current.loginName ? normalizeLoginName(current.loginName) : null;
  const hasAccountPassword = Boolean(current.passwordHash && currentLoginName);
  assert(hasAccountPassword, "Für diesen Nutzer ist kein Konto-Passwort hinterlegt.", 400);
  assert(verifyPassword(input.currentPassword, current.passwordHash!), "Aktuelles Passwort ist falsch.", 401);

  const shouldChangeLoginName = Boolean(nextLoginName && nextLoginName !== currentLoginName);
  if (shouldChangeLoginName) {
    let existing: { id: string } | null = null;
    if (supportsEncryptedLoginNameColumns) {
      try {
        existing = await prisma.user.findFirst({
          where: {
            id: { not: current.id },
            OR: [
              { loginNameLookup: hashLoginNameLookup(nextLoginName as string) },
              { loginName: nextLoginName },
            ],
          },
          select: { id: true },
        });
        markEncryptedLoginColumnsAvailableIfUnknown();
      } catch (error) {
        if (!isMissingColumnError(error)) throw error;
        supportsEncryptedLoginNameColumns = false;
        markEncryptedLoginColumnsUnavailable();
      }
    }

    if (!supportsEncryptedLoginNameColumns) {
      existing = await prisma.user.findFirst({
        where: {
          id: { not: current.id },
          loginName: nextLoginName,
        },
        select: { id: true },
      });
    }

    assert(!existing, "Dieser Login-Name ist bereits vergeben", 409);
  }

  const sessionToken = createSessionToken();
  const sessionExpiresAt = new Date(Date.now() + AUTH_SESSION_WINDOW_MS);
  const now = new Date();
  const baseData = {
    sessionToken,
    sessionExpiresAt,
    isOnline: true,
    status: "",
    lastSeenAt: now,
    ...(nextPassword ? { passwordHash: hashPassword(nextPassword) } : {}),
  };

  let updated: {
    id: string;
    clientId: string;
    loginName: string | null;
    loginNameEncrypted?: string | null;
    sessionToken: string | null;
    sessionExpiresAt: Date | null;
    username: string;
    profilePicture: string;
    status: string;
    isOnline: boolean;
    lastSeenAt: Date | null;
    ppcMemberScoreRaw?: number | null;
    ppcMemberLastActiveAt?: Date | null;
  } | null = null;

  if (supportsEncryptedLoginNameColumns) {
    try {
      updated = await prisma.user.update({
        where: { id: current.id },
        data: {
          ...baseData,
          ...(shouldChangeLoginName
            ? {
              loginNameEncrypted: encryptLoginName(nextLoginName as string),
              loginNameLookup: hashLoginNameLookup(nextLoginName as string),
              loginName: null,
            }
            : {}),
        },
        select: {
          id: true,
          clientId: true,
          loginName: true,
          loginNameEncrypted: true,
          sessionToken: true,
          sessionExpiresAt: true,
          username: true,
          profilePicture: true,
          status: true,
          isOnline: true,
          lastSeenAt: true,
          ppcMemberScoreRaw: true,
          ppcMemberLastActiveAt: true,
        },
      });
      markEncryptedLoginColumnsAvailableIfUnknown();
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      supportsEncryptedLoginNameColumns = false;
      markEncryptedLoginColumnsUnavailable();
    }
  }

  if (!updated) {
    updated = await prisma.user.update({
      where: { id: current.id },
      data: {
        ...baseData,
        ...(shouldChangeLoginName ? { loginName: nextLoginName } : {}),
      },
      select: {
        id: true,
        clientId: true,
        loginName: true,
        sessionToken: true,
        sessionExpiresAt: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
        ppcMemberScoreRaw: true,
        ppcMemberLastActiveAt: true,
      },
    });
  }

  const dto = mapUser(updated);
  publish("user.updated", dto);
  publish("presence.updated", dto);

  return toAuthSessionResponse(updated);
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
  }
  const didRename = Boolean(newUsername && currentUser.username !== newUsername);

  const user = await prisma.user.update({
    where: { clientId: input.clientId },
    data: {
      ...(newUsername ? { username: newUsername } : {}),
      ...(profilePicture ? { profilePicture } : {}),
      updatedAt: new Date(),
    },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

  const dto = mapUser(user);
  publish("user.updated", dto);

  if (didRename) {
    await emitSystemMessage(`${newUsername} ist dem Chat beigetreten`, { authorId: user.id });
  }

  if (didRename && isPpcMemberEligibleUser(user) && USERNAME_CHANGED_EVENT_TYPE) {
    const nextUsername = newUsername as string;
    try {
      await createBehaviorEvent({
        userId: currentUser.id,
        type: USERNAME_CHANGED_EVENT_TYPE,
        preview: `${currentUser.username} -> ${nextUsername}`,
        meta: {
          previousUsername: currentUser.username,
          nextUsername,
        },
      });
    } catch (error) {
      if (!isMissingUsernameChangedEnumValueError(error)) {
        throw error;
      }
      usernameChangedEnumValueAvailable = false;
    }
    await recomputePpcMemberForUser(currentUser.id);
  }

  return dto;
}

export async function pingPresence(input: { clientId: string }): Promise<UserPresenceDTO> {
  const user = await prisma.user.update({
    where: { clientId: input.clientId },
    data: { isOnline: true, lastSeenAt: new Date() },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
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
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

  const dto = mapUser(user);
  publish("presence.updated", dto);
  return dto;
}

export async function markUserOffline(input: { clientId: string }): Promise<UserPresenceDTO> {
  const user = await prisma.user.findUnique({
    where: { clientId: input.clientId },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });
  assert(user, "Nutzersitzung nicht gefunden. Bitte erneut anmelden.", 401);

  const offlineUser = await prisma.user.update({
    where: { clientId: input.clientId },
    data: { isOnline: false, status: "", lastSeenAt: new Date(), sessionToken: null, sessionExpiresAt: null },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

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
  } else if (referencedMessage) {
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
      taggingStatus: AiJobStatus.PENDING,
      taggingPayload: Prisma.JsonNull,
      taggingUpdatedAt: null,
      taggingError: null,
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
    include: MESSAGE_INCLUDE,
  });

  invalidateMediaCache();
  const dto = mapMessage(created, { viewerUserId: user.id });
  publish("message.created", dto);

  const createdAt = created.createdAt || new Date();
  await createBehaviorEvent({
    userId: user.id,
    type: UserBehaviorEventType.MESSAGE_CREATED,
    messageId: created.id,
    preview: content,
    meta: {
      messageType: toChatMessageType(type),
      hasImages: extractImageUrlsForAi(content).length > 0,
    } as Prisma.InputJsonValue,
    createdAt,
  });
  publishTasteUpdated(user.id, "message");

  if (type === MessageType.VOTING_POLL) {
    await createBehaviorEvent({
      userId: user.id,
      type: UserBehaviorEventType.POLL_CREATED,
      messageId: created.id,
      preview: content,
      meta: {
        optionsCount: pollOptions.length,
        multiSelect: Boolean(input.pollMultiSelect),
      } as Prisma.InputJsonValue,
      createdAt,
    });
    publishTasteUpdated(user.id, "poll");
  }

  const mentionedProviders = detectAiProviders(message);
  if (mentionedProviders.length > 0) {
    await createBehaviorEvent({
      userId: user.id,
      type: UserBehaviorEventType.AI_MENTION_SENT,
      messageId: created.id,
      preview: message,
      meta: {
        providers: mentionedProviders,
      } as Prisma.InputJsonValue,
      createdAt,
    });
    publishTasteUpdated(user.id, "message");
  }

  await recomputePpcMemberForUser(user.id);

  await queueTaggingForCreatedMessage({
    messageId: created.id,
    username: user.username,
    message: content,
    imageUrls: extractImageUrlsForAi(content),
  });

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
    include: MESSAGE_INCLUDE,
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
    include: MESSAGE_INCLUDE,
  });

  const dto = mapMessage(updated, { viewerUserId: user.id });
  publish("poll.updated", dto);

  await createBehaviorEvent({
    userId: user.id,
    type: UserBehaviorEventType.POLL_VOTE_GIVEN,
    messageId: poll.id,
    preview: poll.content,
    meta: {
      selectedOptionIds: [...new Set(targetOptionIds)],
    } as Prisma.InputJsonValue,
  });
  publishTasteUpdated(user.id, "poll");
  await recomputePpcMemberForUser(user.id);
  return dto;
}

export async function extendPoll(input: {
  clientId: string;
  pollMessageId: string;
  pollOptions: string[];
}): Promise<MessageDTO> {
  const user = await getUserByClientId(input.clientId);

  const poll = await prisma.message.findUnique({
    where: { id: input.pollMessageId },
    include: MESSAGE_INCLUDE,
  });

  assert(poll, "Umfrage nicht gefunden", 404);
  assert(poll.type === MessageType.VOTING_POLL, "Nachricht ist keine Umfrage", 400);
  assert(poll.pollOptions.length > 0, "Diese Umfrage kann nicht erweitert werden", 400);

  const normalizedIncomingOptions = input.pollOptions.map((option) => option.trim()).filter(Boolean);
  assert(normalizedIncomingOptions.length > 0, "Mindestens eine Umfrageoption ist erforderlich", 400);
  assert(normalizedIncomingOptions.length <= 15, "Umfragen unterstützen bis zu 15 neue Optionen", 400);

  const uniqueIncomingOptions = new Set(normalizedIncomingOptions.map((option) => option.toLowerCase()));
  assert(
    uniqueIncomingOptions.size === normalizedIncomingOptions.length,
    "Neue Umfrageoptionen müssen eindeutig sein",
    400,
  );

  const sortedOptions = [...poll.pollOptions].sort((a, b) => a.sortOrder - b.sortOrder);
  const existingOptionLabels = new Set(sortedOptions.map((option) => option.label.trim().toLowerCase()));
  assert(
    normalizedIncomingOptions.every((option) => !existingOptionLabels.has(option.toLowerCase())),
    "Mindestens eine Option existiert bereits in der Umfrage",
    400,
  );

  assert(
    sortedOptions.length + normalizedIncomingOptions.length <= 15,
    "Umfragen unterstützen maximal 15 Optionen",
    400,
  );

  const nextSortOrder = sortedOptions.length > 0
    ? Math.max(...sortedOptions.map((option) => option.sortOrder)) + 1
    : 0;

  const updated = await prisma.message.update({
    where: { id: poll.id },
    data: {
      pollOptions: {
        create: normalizedIncomingOptions.map((label, index) => ({
          label,
          sortOrder: nextSortOrder + index,
        })),
      },
    },
    include: MESSAGE_INCLUDE,
  });

  const dto = mapMessage(updated, { viewerUserId: user.id });
  publish("poll.updated", dto);

  await createBehaviorEvent({
    userId: user.id,
    type: UserBehaviorEventType.POLL_EXTENDED,
    messageId: poll.id,
    preview: poll.content,
    meta: {
      addedOptions: normalizedIncomingOptions,
      addedCount: normalizedIncomingOptions.length,
    } as Prisma.InputJsonValue,
  });
  publishTasteUpdated(user.id, "poll");
  await recomputePpcMemberForUser(user.id);
  return dto;
}

export async function reactToMessage(input: {
  clientId: string;
  messageId: string;
  reaction: ReactionType;
}): Promise<MessageDTO> {
  const user = await getUserByClientId(input.clientId);
  assert(MESSAGE_REACTION_TYPES.includes(input.reaction), "Ungültige Reaktion", 400);

  const message = await prisma.message.findUnique({
    where: { id: input.messageId },
    include: MESSAGE_INCLUDE,
  });

  assert(message, "Nachricht nicht gefunden", 404);
  if (message.authorName === "System") {
    assert(isReactableSystemMessage(message), "Diese Systemnachricht kann nicht bewertet werden", 400);
  }

  let messageAuthorId = message.authorId ?? null;
  const joinMessageUsername = message.authorName === "System"
    ? extractSystemJoinUsername(message.content)
    : null;
  const messageTargetUsername = joinMessageUsername || message.authorName;

  if (!messageAuthorId && joinMessageUsername) {
    const resolvedAuthorId = await resolveJoinMessageTargetUserId(message.content);
    if (resolvedAuthorId) {
      messageAuthorId = resolvedAuthorId;
      await prisma.message.updateMany({
        where: {
          id: message.id,
          authorId: null,
        },
        data: {
          authorId: resolvedAuthorId,
        },
      });
    }
  }

  const existingReaction = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId: {
        messageId: message.id,
        userId: user.id,
      },
    },
  });

  const nextReaction = input.reaction as MessageReactionType;
  let hasActiveReaction = false;
  let reactionAction: "created" | "updated" | "removed" = "created";

  if (existingReaction) {
    if (existingReaction.reaction === nextReaction) {
      await prisma.messageReaction.delete({
        where: { id: existingReaction.id },
      });
      reactionAction = "removed";
    } else {
      await prisma.messageReaction.update({
        where: { id: existingReaction.id },
        data: { reaction: nextReaction },
      });
      hasActiveReaction = true;
      reactionAction = "updated";
    }
  } else {
    await prisma.messageReaction.create({
      data: {
        messageId: message.id,
        userId: user.id,
        reaction: nextReaction,
      },
    });
    hasActiveReaction = true;
    reactionAction = "created";
  }

  const updatedMessage = await prisma.message.findUnique({
    where: { id: message.id },
    include: MESSAGE_INCLUDE,
  });
  assert(updatedMessage, "Nachricht nicht gefunden", 404);

  const dto = mapMessage(updatedMessage, { viewerUserId: user.id });
  publish("message.updated", mapMessage(updatedMessage));

  await createBehaviorEvent({
    userId: user.id,
    type: UserBehaviorEventType.REACTION_GIVEN,
    messageId: message.id,
    relatedUserId: messageAuthorId,
    relatedUsername: messageTargetUsername,
    reaction: input.reaction,
    preview: message.content,
    meta: {
      action: reactionAction,
      active: hasActiveReaction,
    } as Prisma.InputJsonValue,
  });

  if (hasActiveReaction && messageAuthorId && messageAuthorId !== user.id) {
    const createdNotification = await prisma.notification.create({
      data: {
        userId: messageAuthorId,
        actorUserId: user.id,
        actorUsernameSnapshot: user.username,
        messageId: message.id,
        reaction: nextReaction,
        messagePreview: buildMessagePreview(message.content),
      },
    });
    publish("notification.created", mapNotification(createdNotification));
    publish("reaction.received", {
      targetUserId: messageAuthorId,
      targetUsername: messageTargetUsername,
      fromUsername: user.username,
      messageId: message.id,
      reaction: input.reaction,
      messagePreview: buildMessagePreview(message.content),
      createdAt: new Date().toISOString(),
    });

    await createBehaviorEvent({
      userId: messageAuthorId,
      type: UserBehaviorEventType.REACTION_RECEIVED,
      messageId: message.id,
      relatedUserId: user.id,
      relatedUsername: user.username,
      reaction: input.reaction,
      preview: message.content,
      meta: {
        action: reactionAction,
      } as Prisma.InputJsonValue,
    });
  }

  await recomputeTasteProfileForUser(user.id);
  publishTasteUpdated(user.id, "reaction");
  await recomputePpcMemberForUser(user.id);
  if (messageAuthorId) {
    await recomputeTasteProfileForUser(messageAuthorId);
    if (messageAuthorId !== user.id) {
      publishTasteUpdated(messageAuthorId, "reaction");
    }
    await recomputePpcMemberForUser(messageAuthorId);
  }

  return dto;
}

export async function getNotifications(input: {
  clientId: string;
  limit?: number;
}): Promise<NotificationPageDTO> {
  const user = await getUserByClientId(input.clientId);
  const limit = Math.max(1, Math.min(100, Number(input.limit || 50)));
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    }),
    prisma.notification.count({
      where: {
        userId: user.id,
        isRead: false,
      },
    }),
  ]);

  return {
    items: rows.map(mapNotification),
    unreadCount,
  };
}

export async function markNotificationsRead(input: {
  clientId: string;
  notificationIds?: string[];
}): Promise<NotificationPageDTO> {
  const user = await getUserByClientId(input.clientId);
  const where: Prisma.NotificationWhereInput = {
    userId: user.id,
    isRead: false,
    ...(input.notificationIds?.length
      ? { id: { in: input.notificationIds } }
      : {}),
  };

  await prisma.notification.updateMany({
    where,
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
  publish("notification.read", { userId: user.id, notificationIds: input.notificationIds });
  return getNotifications({ clientId: input.clientId });
}

function parseTasteProfilePayload(payloadRaw: unknown): {
  reactionsReceived: number;
  reactionDistribution: Array<{ reaction: ReactionType; count: number }>;
  topTags: Array<{ tag: string; score: number }>;
} {
  const payload = asRecord(payloadRaw) || {};
  const reactionsReceived =
    typeof payload.reactionsReceived === "number" && Number.isFinite(payload.reactionsReceived)
      ? payload.reactionsReceived
      : 0;
  const reactionDistribution = Array.isArray(payload.reactionDistribution)
    ? payload.reactionDistribution
      .map((row) => {
        const item = asRecord(row);
        if (!item) return null;
        if (!MESSAGE_REACTION_TYPES.includes(item.reaction as ReactionType)) return null;
        return {
          reaction: item.reaction as ReactionType,
          count: typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 0,
        };
      })
      .filter((row): row is { reaction: ReactionType; count: number } => Boolean(row))
    : [];
  const topTags = Array.isArray(payload.topTags)
    ? payload.topTags
      .map((row) => {
        const item = asRecord(row);
        if (!item) return null;
        const tag = normalizeTagLabel(item.tag);
        const score = normalizeTagScore(item.score);
        if (!tag) return null;
        return { tag, score };
      })
      .filter((row): row is { tag: string; score: number } => Boolean(row))
    : [];

  return {
    reactionsReceived,
    reactionDistribution,
    topTags,
  };
}

const MESSAGE_TASTE_CATEGORY_KEYS = ["themes", "humor", "art", "tone", "topics"] as const;
const IMAGE_TASTE_CATEGORY_KEYS = ["themes", "humor", "art", "tone", "objects"] as const;
const TASTE_WINDOWS: Array<{ key: TasteWindowKey; days: number | null }> = [
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
  { key: "all", days: null },
];

function resolveTasteWindowStart(days: number | null): Date | null {
  if (!days) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
}

function buildReactionCountMap(): Map<ReactionType, number> {
  return new Map(MESSAGE_REACTION_TYPES.map((reaction) => [reaction, 0]));
}

function toReactionCountList(counter: Map<ReactionType, number>): Array<{ reaction: ReactionType; count: number }> {
  return MESSAGE_REACTION_TYPES.map((reaction) => ({
    reaction,
    count: counter.get(reaction) || 0,
  }));
}

function roundTasteScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function addScoredTagsToMap(
  target: Map<string, number>,
  tags: Array<{ tag: string; score: number }>,
  weight = 1,
): void {
  for (const entry of tags) {
    const key = normalizeTagLabel(entry.tag);
    if (!key) continue;
    const nextScore = (target.get(key) || 0) + normalizeTagScore(entry.score) * weight;
    target.set(key, nextScore);
  }
}

function mapToSortedTagList(
  source: Map<string, number>,
  limit: number,
): Array<{ tag: string; score: number }> {
  return [...source.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, score]) => ({ tag, score: roundTasteScore(score) }));
}

function extractTaggingPayloadForTaste(raw: unknown): {
  messageTags: Array<{ tag: string; score: number }>;
  messageCategories: ReturnType<typeof normalizeMessageTagCategories>;
  imageCategories: Array<ReturnType<typeof normalizeImageTagCategories>>;
} {
  const payload = asRecord(raw);
  if (!payload) {
    return {
      messageTags: [],
      messageCategories: createEmptyMessageTagCategories(),
      imageCategories: [],
    };
  }
  const normalizedImages = normalizeTaggedImages(payload.images);
  return {
    messageTags: normalizeScoredTags(payload.messageTags, TAGGING_MAX_MESSAGE_TAGS),
    messageCategories: normalizeMessageTagCategories(payload.categories),
    imageCategories: normalizedImages.map((image) => image.categories),
  };
}

function createCategoryAccumulator<TKey extends string>(keys: readonly TKey[]): Record<TKey, Map<string, number>> {
  const result = {} as Record<TKey, Map<string, number>>;
  for (const key of keys) {
    result[key] = new Map<string, number>();
  }
  return result;
}

function addCategoryAccumulator<TKey extends string>(
  target: Record<TKey, Map<string, number>>,
  source: Record<TKey, Array<{ tag: string; score: number }>>,
  keys: readonly TKey[],
  weight = 1,
): void {
  for (const key of keys) {
    addScoredTagsToMap(target[key], source[key], weight);
  }
}

function mapCategoryAccumulator<TKey extends string>(
  source: Record<TKey, Map<string, number>>,
  keys: readonly TKey[],
  limit: number,
): Record<TKey, Array<{ tag: string; score: number }>> {
  const result = {} as Record<TKey, Array<{ tag: string; score: number }>>;
  for (const key of keys) {
    result[key] = mapToSortedTagList(source[key], limit);
  }
  return result;
}

function hasMediaInMessage(content: string): boolean {
  return extractImageUrlsForAi(content).length > 0;
}

function getAiMentionCounters(messages: Array<{ content: string }>): { chatgpt: number; grok: number } {
  const counters = { chatgpt: 0, grok: 0 };
  for (const message of messages) {
    const providers = detectAiProviders(message.content);
    if (providers.includes("chatgpt")) counters.chatgpt += 1;
    if (providers.includes("grok")) counters.grok += 1;
  }
  return counters;
}

function toWeekdayAndHourHistograms(timestamps: Date[]): {
  activeDays: number;
  activityByWeekday: Array<{ weekday: number; count: number }>;
  activityByHour: Array<{ hour: number; count: number }>;
} {
  const weekdayMap = new Map<number, number>(Array.from({ length: 7 }, (_, weekday) => [weekday, 0]));
  const hourMap = new Map<number, number>(Array.from({ length: 24 }, (_, hour) => [hour, 0]));
  const activeDays = new Set<string>();

  for (const timestamp of timestamps) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;
    weekdayMap.set(date.getDay(), (weekdayMap.get(date.getDay()) || 0) + 1);
    hourMap.set(date.getHours(), (hourMap.get(date.getHours()) || 0) + 1);
    activeDays.add(date.toISOString().slice(0, 10));
  }

  return {
    activeDays: activeDays.size,
    activityByWeekday: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      count: weekdayMap.get(weekday) || 0,
    })),
    activityByHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourMap.get(hour) || 0,
    })),
  };
}

function toSocialEntry(
  map: Map<string, { userId: string; username: string; profilePicture: string; given: number; received: number }>,
  userId: string,
  fallback: { username: string; profilePicture: string },
): { userId: string; username: string; profilePicture: string; given: number; received: number } {
  const existing = map.get(userId);
  if (existing) return existing;
  const created = {
    userId,
    username: fallback.username,
    profilePicture: fallback.profilePicture || getDefaultProfilePicture(),
    given: 0,
    received: 0,
  };
  map.set(userId, created);
  return created;
}

async function getTasteWindowStats(input: {
  userId: string;
  windowStart: Date | null;
}): Promise<TasteProfileDetailedDTO["windows"][TasteWindowKey]> {
  const createdAtFilter = input.windowStart ? { gte: input.windowStart } : undefined;
  const messageWhere: Prisma.MessageWhereInput = {
    authorId: input.userId,
    authorName: { not: "System" },
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };
  const reactionGivenWhere: Prisma.MessageReactionWhereInput = {
    userId: input.userId,
    ...(createdAtFilter ? { updatedAt: createdAtFilter } : {}),
  };
  const reactionReceivedWhere: Prisma.MessageReactionWhereInput = {
    message: { authorId: input.userId },
    ...(createdAtFilter ? { updatedAt: createdAtFilter } : {}),
  };
  const behaviorWhere: Prisma.UserBehaviorEventWhereInput = {
    userId: input.userId,
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };
  const pollVoteWhere: Prisma.PollChoiceVoteWhereInput = {
    userId: input.userId,
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };

  const [ownMessages, reactionsGiven, reactionsReceived, behaviorEvents, pollVoteRows] = await Promise.all([
    prisma.message.findMany({
      where: messageWhere,
      select: {
        id: true,
        type: true,
        content: true,
        createdAt: true,
        taggingStatus: true,
        taggingPayload: true,
      },
    }),
    prisma.messageReaction.findMany({
      where: reactionGivenWhere,
      select: {
        reaction: true,
        updatedAt: true,
        message: {
          select: {
            id: true,
            authorId: true,
            authorName: true,
            authorProfilePicture: true,
            content: true,
            taggingPayload: true,
          },
        },
      },
    }),
    prisma.messageReaction.findMany({
      where: reactionReceivedWhere,
      select: {
        reaction: true,
        updatedAt: true,
        userId: true,
        user: {
          select: {
            id: true,
            username: true,
            profilePicture: true,
          },
        },
      },
    }),
    prisma.userBehaviorEvent.findMany({
      where: behaviorWhere,
      select: {
        type: true,
        createdAt: true,
      },
    }),
    prisma.pollChoiceVote.findMany({
      where: pollVoteWhere,
      select: { createdAt: true },
    }),
  ]);

  const givenByType = buildReactionCountMap();
  for (const row of reactionsGiven) {
    const reaction = toReactionType(row.reaction);
    givenByType.set(reaction, (givenByType.get(reaction) || 0) + 1);
  }

  const receivedByType = buildReactionCountMap();
  for (const row of reactionsReceived) {
    const reaction = toReactionType(row.reaction);
    receivedByType.set(reaction, (receivedByType.get(reaction) || 0) + 1);
  }

  const postByTypeCounter = new Map<MessageType, number>([
    [MessageType.MESSAGE, 0],
    [MessageType.QUESTION, 0],
    [MessageType.ANSWER, 0],
    [MessageType.VOTING_POLL, 0],
  ]);
  for (const row of ownMessages) {
    postByTypeCounter.set(row.type, (postByTypeCounter.get(row.type) || 0) + 1);
  }

  const taggingCompleted = ownMessages.filter((row) => row.taggingStatus === AiJobStatus.COMPLETED).length;
  const taggingFailed = ownMessages.filter((row) => row.taggingStatus === AiJobStatus.FAILED).length;
  const taggingPending = ownMessages.filter((row) =>
    row.taggingStatus === AiJobStatus.PENDING || row.taggingStatus === AiJobStatus.PROCESSING).length;
  const postsTotal = ownMessages.length;

  const topTagsAccumulator = new Map<string, number>();
  const messageCategoryAccumulator = createCategoryAccumulator(MESSAGE_TASTE_CATEGORY_KEYS);
  const imageCategoryAccumulator = createCategoryAccumulator(IMAGE_TASTE_CATEGORY_KEYS);

  for (const row of ownMessages) {
    const parsed = extractTaggingPayloadForTaste(row.taggingPayload);
    addScoredTagsToMap(topTagsAccumulator, parsed.messageTags, 1);
    addCategoryAccumulator(messageCategoryAccumulator, parsed.messageCategories, MESSAGE_TASTE_CATEGORY_KEYS, 1);
    for (const imageCategories of parsed.imageCategories) {
      addCategoryAccumulator(imageCategoryAccumulator, imageCategories, IMAGE_TASTE_CATEGORY_KEYS, 1);
    }
  }

  for (const row of reactionsGiven) {
    if (!row.message) continue;
    const reactionType = toReactionType(row.reaction);
    const reactionWeight = MESSAGE_REACTION_SCORES[reactionType] || 1;
    const parsed = extractTaggingPayloadForTaste(row.message.taggingPayload);
    addScoredTagsToMap(topTagsAccumulator, parsed.messageTags, reactionWeight);
    const joinUsernameTag =
      row.message.authorName === "System"
        ? extractJoinUsernameTag(row.message.content)
        : null;
    if (joinUsernameTag) {
      addScoredTagsToMap(topTagsAccumulator, [{ tag: joinUsernameTag, score: 1 }], reactionWeight);
    }
    addCategoryAccumulator(
      messageCategoryAccumulator,
      parsed.messageCategories,
      MESSAGE_TASTE_CATEGORY_KEYS,
      reactionWeight,
    );
    for (const imageCategories of parsed.imageCategories) {
      addCategoryAccumulator(imageCategoryAccumulator, imageCategories, IMAGE_TASTE_CATEGORY_KEYS, reactionWeight);
    }
  }

  const interactionMap = new Map<
    string,
    { userId: string; username: string; profilePicture: string; given: number; received: number }
  >();
  for (const row of reactionsGiven) {
    const targetUserId = row.message?.authorId;
    if (!targetUserId) continue;
    const targetUsername = row.message.authorName === "System"
      ? extractSystemJoinUsername(row.message.content) || row.message.authorName
      : row.message.authorName;
    const entry = toSocialEntry(interactionMap, targetUserId, {
      username: targetUsername,
      profilePicture: row.message.authorProfilePicture,
    });
    entry.given += 1;
  }
  for (const row of reactionsReceived) {
    const reactorId = row.userId;
    if (!reactorId) continue;
    const entry = toSocialEntry(interactionMap, reactorId, {
      username: row.user?.username || "Unbekannt",
      profilePicture: row.user?.profilePicture || getDefaultProfilePicture(),
    });
    entry.received += 1;
  }

  const behaviorCounter = new Map<UserBehaviorEventType, number>();
  for (const row of behaviorEvents) {
    behaviorCounter.set(row.type, (behaviorCounter.get(row.type) || 0) + 1);
  }
  const pollsExtended = behaviorCounter.get(UserBehaviorEventType.POLL_EXTENDED) || 0;

  const histogramSource = [
    ...ownMessages.map((row) => row.createdAt),
    ...reactionsGiven.map((row) => row.updatedAt),
    ...reactionsReceived.map((row) => row.updatedAt),
    ...pollVoteRows.map((row) => row.createdAt),
    ...behaviorEvents.map((row) => row.createdAt),
  ];
  const histograms = toWeekdayAndHourHistograms(histogramSource);

  return {
    reactions: {
      givenTotal: reactionsGiven.length,
      receivedTotal: reactionsReceived.length,
      givenByType: toReactionCountList(givenByType),
      receivedByType: toReactionCountList(receivedByType),
    },
    interests: {
      topTags: mapToSortedTagList(topTagsAccumulator, 60),
      topMessageCategories: mapCategoryAccumulator(messageCategoryAccumulator, MESSAGE_TASTE_CATEGORY_KEYS, 30),
      topImageCategories: mapCategoryAccumulator(imageCategoryAccumulator, IMAGE_TASTE_CATEGORY_KEYS, 30),
    },
    activity: {
      postsTotal,
      postsByType: [
        { type: "message", count: postByTypeCounter.get(MessageType.MESSAGE) || 0 },
        { type: "question", count: postByTypeCounter.get(MessageType.QUESTION) || 0 },
        { type: "answer", count: postByTypeCounter.get(MessageType.ANSWER) || 0 },
        { type: "votingPoll", count: postByTypeCounter.get(MessageType.VOTING_POLL) || 0 },
      ],
      postsWithImages: ownMessages.filter((row) => hasMediaInMessage(row.content)).length,
      pollVotesGiven: pollVoteRows.length,
      pollsCreated: postByTypeCounter.get(MessageType.VOTING_POLL) || 0,
      pollsExtended,
      aiMentions: getAiMentionCounters(ownMessages),
      activeDays: histograms.activeDays,
      activityByWeekday: histograms.activityByWeekday,
      activityByHour: histograms.activityByHour,
      tagging: {
        completed: taggingCompleted,
        failed: taggingFailed,
        pending: taggingPending,
        coverage: postsTotal > 0 ? roundTasteScore(taggingCompleted / postsTotal) : 0,
      },
    },
    social: {
      topInteractedUsers: [...interactionMap.values()]
        .map((entry) => ({
          ...entry,
          total: entry.given + entry.received,
        }))
        .sort((a, b) =>
          b.total - a.total
          || b.received - a.received
          || b.given - a.given
          || a.username.localeCompare(b.username))
        .slice(0, 20),
    },
  };
}

export async function getTasteProfileDetailed(input: { clientId: string }): Promise<TasteProfileDetailedDTO> {
  const user = await getUserByClientId(input.clientId);
  await cleanupExpiredBehaviorEvents();
  const eligible = isPpcMemberEligibleUser(user);

  const windows = await Promise.all(
    TASTE_WINDOWS.map(async (windowConfig) => {
      const stats = await getTasteWindowStats({
        userId: user.id,
        windowStart: resolveTasteWindowStart(windowConfig.days),
      });
      return [windowConfig.key, stats] as const;
    }),
  );

  const firstEvent = await prisma.userBehaviorEvent.findFirst({
    where: { userId: user.id },
    orderBy: [{ createdAt: "asc" }],
    select: { createdAt: true },
  });

  const memberData = eligible
    ? await getPpcMemberBreakdown(user.id)
    : {
      breakdown: {
        messagesCreated: 0,
        reactionsGiven: 0,
        reactionsReceived: 0,
        aiMentions: 0,
        pollsCreated: 0,
        pollsExtended: 0,
        pollVotes: 0,
        taggingCompleted: 0,
        usernameChanges: 0,
        rawScore: 0,
      },
      rawScore: 0,
      lastActiveAt: null as Date | null,
    };

  return {
    userId: user.id,
    generatedAt: new Date().toISOString(),
    member: eligible
      ? buildMemberProgress({
        rawScore: user.ppcMemberScoreRaw || memberData.rawScore,
        lastActiveAt: user.ppcMemberLastActiveAt || memberData.lastActiveAt,
      })
      : undefined,
    memberBreakdown: memberData.breakdown,
    windows: Object.fromEntries(windows) as Record<TasteWindowKey, TasteProfileDetailedDTO["windows"][TasteWindowKey]>,
    transparency: {
      eventRetentionDays: BEHAVIOR_EVENT_RETENTION_DAYS,
      rawEventsAvailableSince: firstEvent?.createdAt?.toISOString(),
      sources: [
        "Eigene Nachrichten und deren Tagging-Daten",
        "Deine Reaktionen auf Beiträge",
        "Reaktionen auf deine Beiträge",
        "Umfrage-Aktionen (erstellen, erweitern, abstimmen)",
        "KI-Mentions in deinen Nachrichten",
        "Anzeigename-Änderungen",
      ],
    },
  };
}

export async function getPublicUserProfile(input: {
  viewerClientId: string;
  targetClientId: string;
}): Promise<PublicUserProfileDTO> {
  await getUserByClientId(input.viewerClientId);

  const targetUser = await prisma.user.findUnique({
    where: { clientId: input.targetClientId },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });
  assert(targetUser, "Profil nicht gefunden.", 404);

  const fullStats = await getTasteWindowStats({
    userId: targetUser.id,
    windowStart: null,
  });
  const presence = mapUser(targetUser);

  return {
    userId: presence.id,
    clientId: presence.clientId,
    username: presence.username,
    profilePicture: presence.profilePicture,
    status: presence.status,
    isOnline: presence.isOnline,
    lastSeenAt: presence.lastSeenAt,
    member: presence.member,
    stats: {
      postsTotal: fullStats.activity.postsTotal,
      reactionsGiven: fullStats.reactions.givenTotal,
      reactionsReceived: fullStats.reactions.receivedTotal,
      pollsCreated: fullStats.activity.pollsCreated,
      pollVotes: fullStats.activity.pollVotesGiven,
      activeDays: fullStats.activity.activeDays,
    },
  };
}

export async function getTasteProfileEvents(input: {
  clientId: string;
  limit?: number;
  before?: string;
}): Promise<TasteProfileEventPageDTO> {
  const user = await getUserByClientId(input.clientId);
  await cleanupExpiredBehaviorEvents();

  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const before = input.before?.trim();
  let beforeDate: Date | null = null;
  if (before) {
    beforeDate = new Date(before);
    assert(!Number.isNaN(beforeDate.getTime()), "before ist ungültig", 400);
  }

  const rows = await prisma.userBehaviorEvent.findMany({
    where: {
      userId: user.id,
      ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      type: true,
      createdAt: true,
      messageId: true,
      relatedUserId: true,
      reaction: true,
      preview: true,
      meta: true,
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => mapBehaviorEvent(row));
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.createdAt.toISOString() || null : null;

  return {
    items,
    nextCursor,
    hasMore,
  };
}

export async function getTasteProfile(input: { clientId: string }): Promise<UserTasteProfileDTO> {
  const user = await getUserByClientId(input.clientId);
  await recomputeTasteProfileForUser(user.id);
  const profile = await prisma.userTasteProfile.findUnique({
    where: { userId: user.id },
    select: {
      userId: true,
      windowDays: true,
      payload: true,
      updatedAt: true,
    },
  });
  assert(profile, "Taste-Profil konnte nicht geladen werden.", 500);
  const parsed = parseTasteProfilePayload(profile.payload);

  return {
    userId: profile.userId,
    windowDays: profile.windowDays,
    updatedAt: profile.updatedAt.toISOString(),
    reactionsReceived: parsed.reactionsReceived,
    reactionDistribution: parsed.reactionDistribution,
    topTags: parsed.topTags,
  };
}

export async function getDeveloperTasteProfiles(input: {
  clientId: string;
  devAuthToken: string;
  limit?: number;
}): Promise<DeveloperUserTasteListDTO> {
  await assertDeveloperMode(input);
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));

  const users = await prisma.user.findMany({
    where: {
      clientId: {
        notIn: [...SYSTEM_CLIENT_IDS],
      },
      NOT: {
        clientId: input.clientId,
      },
    },
    orderBy: [{ isOnline: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
    },
  });

  for (const user of users) {
    await recomputeTasteProfileForUser(user.id);
  }

  const profiles = await prisma.userTasteProfile.findMany({
    where: {
      userId: {
        in: users.map((user) => user.id),
      },
    },
    select: {
      userId: true,
      windowDays: true,
      payload: true,
      updatedAt: true,
    },
  });

  const profileByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));
  const items = users
    .map((user) => {
      const profile = profileByUserId.get(user.id);
      if (!profile) {
        return {
          userId: user.id,
          clientId: user.clientId,
          username: user.username,
          profilePicture: user.profilePicture,
          windowDays: TASTE_PROFILE_WINDOW_DAYS,
          updatedAt: new Date(0).toISOString(),
          reactionsReceived: 0,
          reactionDistribution: [],
          topTags: [],
        };
      }

      const parsed = parseTasteProfilePayload(profile.payload);
      return {
        userId: user.id,
        clientId: user.clientId,
        username: user.username,
        profilePicture: user.profilePicture,
        windowDays: profile.windowDays,
        updatedAt: profile.updatedAt.toISOString(),
        reactionsReceived: parsed.reactionsReceived,
        reactionDistribution: parsed.reactionDistribution,
        topTags: parsed.topTags,
      };
    })
    .sort((a, b) =>
      b.reactionsReceived - a.reactionsReceived
      || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      || a.username.localeCompare(b.username),
    );

  return { items };
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

export async function getAdminUsers(input: {
  clientId: string;
  devAuthToken: string;
}): Promise<AdminUserListResponseDTO> {
  await assertDeveloperMode(input);

  let supportsEncryptedLoginNameColumns = canUseEncryptedLoginColumns();
  let users: Array<{
    id: string;
    clientId: string;
    username: string;
    profilePicture: string;
    isOnline: boolean;
    status: string;
    lastSeenAt: Date | null;
    ppcMemberScoreRaw: number;
    ppcMemberLastActiveAt: Date | null;
    loginName: string | null;
    loginNameEncrypted: string | null;
    passwordHash: string | null;
  }> = [];
  if (supportsEncryptedLoginNameColumns) {
    try {
      users = await prisma.user.findMany({
        where: {
          clientId: {
            notIn: [...SYSTEM_CLIENT_IDS],
          },
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          clientId: true,
          username: true,
          profilePicture: true,
          isOnline: true,
          status: true,
          lastSeenAt: true,
          ppcMemberScoreRaw: true,
          ppcMemberLastActiveAt: true,
          loginName: true,
          loginNameEncrypted: true,
          passwordHash: true,
        },
      });
      markEncryptedLoginColumnsAvailableIfUnknown();
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      markEncryptedLoginColumnsUnavailable();
      supportsEncryptedLoginNameColumns = false;
    }
  }

  if (!supportsEncryptedLoginNameColumns) {
    const legacyUsers = await prisma.user.findMany({
      where: {
        clientId: {
          notIn: [...SYSTEM_CLIENT_IDS],
        },
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        clientId: true,
        username: true,
        profilePicture: true,
        isOnline: true,
        status: true,
        lastSeenAt: true,
        ppcMemberScoreRaw: true,
        ppcMemberLastActiveAt: true,
        loginName: true,
        passwordHash: true,
      },
    });
    users = legacyUsers.map((user) => ({ ...user, loginNameEncrypted: null }));
  }

  const statsByUserId = new Map<string, {
    postsTotal: number;
    reactionsGiven: number;
    reactionsReceived: number;
    pollsCreated: number;
    pollVotes: number;
    activeDays: number;
  }>();

  await Promise.all(users.map(async (user) => {
    const fullStats = await getTasteWindowStats({
      userId: user.id,
      windowStart: null,
    });
    statsByUserId.set(user.id, {
      postsTotal: fullStats.activity.postsTotal,
      reactionsGiven: fullStats.reactions.givenTotal,
      reactionsReceived: fullStats.reactions.receivedTotal,
      pollsCreated: fullStats.activity.pollsCreated,
      pollVotes: fullStats.activity.pollVotesGiven,
      activeDays: fullStats.activity.activeDays,
    });
  }));

  return {
    items: users.map((user) => {
      const loginName = user.loginNameEncrypted
        ? decryptLoginName(user.loginNameEncrypted)
        : user.loginName ? normalizeLoginName(user.loginName) : null;
      const hasAccount = Boolean(user.passwordHash && loginName);
      const member = isPpcMemberEligibleUser({ clientId: user.clientId, username: user.username })
        ? buildMemberProgress({
          rawScore: user.ppcMemberScoreRaw || 0,
          lastActiveAt: user.ppcMemberLastActiveAt || null,
        })
        : undefined;
      const stats = statsByUserId.get(user.id) || {
        postsTotal: 0,
        reactionsGiven: 0,
        reactionsReceived: 0,
        pollsCreated: 0,
        pollVotes: 0,
        activeDays: 0,
      };

      return {
        userId: user.id,
        clientId: user.clientId,
        username: user.username,
        profilePicture: user.profilePicture,
        loginName,
        hasAccount,
        canResetPassword: hasAccount,
        isOnline: user.isOnline,
        member,
        memberRawScore: Math.max(0, user.ppcMemberScoreRaw || 0),
        stats,
      };
    }),
  };
}

export async function adminResetUserPassword(input: {
  clientId: string;
  devAuthToken: string;
  targetUserId: string;
  newPassword: string;
}): Promise<AdminResetUserPasswordResponse> {
  await assertDeveloperMode(input);

  const targetUserId = input.targetUserId.trim();
  const newPassword = input.newPassword.trim();
  assert(targetUserId, "targetUserId ist erforderlich", 400);
  assert(newPassword.length >= 8, "newPassword muss mindestens 8 Zeichen lang sein", 400);

  let supportsEncryptedLoginNameColumns = canUseEncryptedLoginColumns();
  let target: {
    id: string;
    username: string;
    loginName: string | null;
    loginNameEncrypted: string | null;
    passwordHash: string | null;
  } | null = null;
  if (supportsEncryptedLoginNameColumns) {
    try {
      target = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          username: true,
          loginName: true,
          loginNameEncrypted: true,
          passwordHash: true,
        },
      });
      markEncryptedLoginColumnsAvailableIfUnknown();
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      supportsEncryptedLoginNameColumns = false;
      markEncryptedLoginColumnsUnavailable();
    }
  }

  if (!supportsEncryptedLoginNameColumns) {
    const legacyTarget = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        loginName: true,
        passwordHash: true,
      },
    });
    target = legacyTarget
      ? {
        ...legacyTarget,
        loginNameEncrypted: null,
      }
      : null;
  }
  assert(target, "Zielnutzer nicht gefunden", 404);

  const loginName = target.loginNameEncrypted
    ? decryptLoginName(target.loginNameEncrypted)
    : target.loginName ? normalizeLoginName(target.loginName) : null;
  const hasAccount = Boolean(target.passwordHash && loginName);
  assert(hasAccount, "Dieser Nutzer hat kein Konto-Passwort", 400);

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: hashPassword(newPassword),
      ...(supportsEncryptedLoginNameColumns
        ? {
          loginNameEncrypted: encryptLoginName(loginName!),
          loginNameLookup: hashLoginNameLookup(loginName!),
          loginName: null,
        }
        : {
          loginName,
        }),
      sessionToken: null,
      sessionExpiresAt: null,
      isOnline: false,
      status: "",
      lastSeenAt: new Date(),
    },
    select: {
      id: true,
      clientId: true,
      username: true,
      profilePicture: true,
      status: true,
      isOnline: true,
      lastSeenAt: true,
      ppcMemberScoreRaw: true,
      ppcMemberLastActiveAt: true,
    },
  });

  publish("user.updated", mapUser(updated));
  publish("presence.updated", mapUser(updated));

  return {
    ok: true,
    message: `Passwort für ${target.username} wurde zurückgesetzt.`,
  };
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

  if (action === "set_user_score") {
    const targetUserId = input.targetUserId?.trim();
    const targetScore = Number(input.targetScore);
    assert(targetUserId, "targetUserId ist für set_user_score erforderlich", 400);
    assert(Number.isFinite(targetScore), "targetScore ist für set_user_score erforderlich", 400);
    const nextRawScore = Math.max(0, Math.round(targetScore));
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    assert(target, "Zielnutzer nicht gefunden", 404);

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ppcMemberScoreRaw: nextRawScore,
        ppcMemberLastActiveAt: new Date(),
      },
      select: {
        id: true,
        clientId: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
        ppcMemberScoreRaw: true,
        ppcMemberLastActiveAt: true,
      },
    });

    publish("user.updated", mapUser(updated));
    publish("presence.updated", mapUser(updated));
    const nextMember = buildMemberProgress({
      rawScore: updated.ppcMemberScoreRaw || 0,
      lastActiveAt: updated.ppcMemberLastActiveAt || null,
    });
    message = `PPC Score für ${updated.username} wurde auf ${nextMember.score} gesetzt.`;
  }

  if (action === "set_user_rank") {
    const targetUserId = input.targetUserId?.trim();
    const targetRank = input.targetRank;
    assert(targetUserId, "targetUserId ist für set_user_rank erforderlich", 400);
    assert(targetRank, "targetRank ist für set_user_rank erforderlich", 400);
    const targetStep = MEMBER_RANK_STEPS.find((step) => step.rank === targetRank);
    assert(targetStep, "targetRank ist ungültig", 400);
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    assert(target, "Zielnutzer nicht gefunden", 404);

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ppcMemberScoreRaw: targetStep.minScore,
        ppcMemberLastActiveAt: new Date(),
      },
      select: {
        id: true,
        clientId: true,
        username: true,
        profilePicture: true,
        status: true,
        isOnline: true,
        lastSeenAt: true,
        ppcMemberScoreRaw: true,
        ppcMemberLastActiveAt: true,
      },
    });

    publish("user.updated", mapUser(updated));
    publish("presence.updated", mapUser(updated));
    message = `Rang für ${updated.username} wurde auf ${memberRankLabel(targetRank)} gesetzt.`;
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
