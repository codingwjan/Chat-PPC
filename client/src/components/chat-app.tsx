"use client";
/* eslint-disable @next/next/no-img-element */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowDownTrayIcon,
  Bars3Icon,
  ClipboardDocumentIcon,
  PlusIcon,
  ShareIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChatComposer, type ComposerMode } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { MemberProgressInline } from "@/components/member-progress-inline";
import { ChatShellSidebar } from "@/components/chat-shell-sidebar";
import { UiToast } from "@/components/ui-toast";
import { hasLeadingAiTag, toggleLeadingAiTag } from "@/lib/composer-ai-tags";
import { apiJson } from "@/lib/http";
import { MEMBER_RANK_STEPS, memberRankLabel, PPC_MEMBER_POINT_RULES } from "@/lib/member-progress";
import {
  clearSession,
  getDefaultProfilePicture,
  loadSession,
  saveSession,
  type SessionState,
} from "@/lib/session";
import type {
  AdminActionRequest,
  AppKillDTO,
  AiStatusDTO,
  AuthSessionDTO,
  BotLanguagePreference,
  BotManagerDTO,
  ChatBackgroundDTO,
  CreateMessageRequest,
  ExtendPollRequest,
  LoginResponseDTO,
  ManagedBotDTO,
  MediaItemDTO,
  MediaPageDTO,
  MemberRank,
  MessageDTO,
  MessagePageDTO,
  PublicUserProfileDTO,
  PublicUserProfileStatsDTO,
  ReactMessageRequest,
  ReactionType,
  RenameUserRequest,
  SnapshotDTO,
  TasteProfileDetailedDTO,
  TasteProfileEventDTO,
  TasteProfileEventPageDTO,
  TasteWindowKey,
  UpdateOwnAccountRequest,
  UserPresenceDTO,
  VotePollRequest,
} from "@/lib/types";
import chatgptAvatar from "@/resources/chatgpt.png";
import grokAvatar from "@/resources/grokAvatar.png";
interface UploadResponse {
  url: string;
}

interface UploadedDraftImage {
  id: string;
  url: string;
  label: string;
}

function OverlayDialogSkeleton() {
  return (
    <div className="fixed inset-0 z-[68] grid place-items-center bg-slate-900/45 backdrop-blur-sm p-3">
      <div className="glass-panel-strong w-full max-w-2xl rounded-2xl p-6 animate-pulse">
        <div className="h-5 w-40 rounded bg-slate-200/70" />
        <div className="mt-3 h-4 w-64 rounded bg-slate-200/70" />
        <div className="mt-6 space-y-3">
          <div className="h-10 rounded-xl bg-slate-200/70" />
          <div className="h-10 rounded-xl bg-slate-200/70" />
          <div className="h-24 rounded-xl bg-slate-200/70" />
        </div>
      </div>
    </div>
  );
}

function MemberDrawerSkeleton() {
  return (
    <div className="fixed inset-0 z-[75] bg-slate-900/45 backdrop-blur-sm">
      <div className="absolute inset-y-0 right-0 w-full max-w-xl p-2 sm:p-4">
        <div className="glass-panel-strong h-full rounded-2xl p-5 animate-pulse">
          <div className="h-5 w-28 rounded bg-slate-200/70" />
          <div className="mt-6 h-28 rounded-2xl bg-slate-200/70" />
          <div className="mt-4 space-y-3">
            <div className="h-4 w-2/3 rounded bg-slate-200/70" />
            <div className="h-4 w-1/2 rounded bg-slate-200/70" />
            <div className="h-24 rounded-xl bg-slate-200/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileCropSkeleton() {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/55 p-4">
      <div className="glass-panel-strong w-full max-w-xl rounded-2xl p-5 animate-pulse">
        <div className="h-5 w-44 rounded bg-slate-200/70" />
        <div className="mt-4 aspect-square w-full rounded-2xl bg-slate-200/70" />
        <div className="mt-4 h-10 w-40 rounded-xl bg-slate-200/70" />
      </div>
    </div>
  );
}

const AppOverlayDialog = dynamic(
  () => import("@/components/app-overlay-dialog").then((module) => module.AppOverlayDialog),
  {
    ssr: false,
    loading: () => <OverlayDialogSkeleton />,
  },
);

const MemberProfileDrawer = dynamic(
  () => import("@/components/member-profile-drawer").then((module) => module.MemberProfileDrawer),
  {
    ssr: false,
    loading: () => <MemberDrawerSkeleton />,
  },
);

const ProfileImageCropModal = dynamic(
  () => import("@/components/profile-image-crop-modal").then((module) => module.ProfileImageCropModal),
  {
    ssr: false,
    loading: () => <ProfileCropSkeleton />,
  },
);

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const MESSAGE_PAGE_SIZE = 36;
const SNAPSHOT_LIMIT = 40;
const RECONCILE_INTERVAL_MS = 15_000;
const PRESENCE_PING_INTERVAL_MS = 20_000;
const STREAM_RECONNECT_BASE_MS = 900;
const STREAM_RECONNECT_MAX_MS = 8_000;
const STREAM_STALE_MS = 45_000;
const STREAM_WATCHDOG_INTERVAL_MS = 10_000;
const AI_WORKER_POLL_INTERVAL_MS = 60_000;
const PROFILE_UPLOAD_TIMEOUT_MS = 20_000;
const AUTO_SCROLL_NEAR_BOTTOM_PX = 420;
const TOP_LOAD_TRIGGER_PX = 160;
const TOP_LOAD_COOLDOWN_MS = 750;
const ONBOARDING_KEY = "chatppc.onboarding.v1";
const MAX_VISIBLE_MESSAGES = Number.POSITIVE_INFINITY;
const MESSAGE_RENDER_WINDOW = Number.POSITIVE_INFINITY;
const MESSAGE_RENDER_CHUNK = 60;
const SUPPORTED_CHAT_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const SUPPORTED_PROFILE_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const LOGIN_NAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const MEDIA_PAGE_SIZE = 3;
const MEDIA_CACHE_KEY = "chatppc.media.cache.v1";
const MEDIA_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_COMPOSER_HEIGHT_PX = 208;
const COMPOSER_BOTTOM_GAP_PX = 16;
const LAST_MESSAGE_EXTRA_CLEARANCE_PX = 28;
const HARD_BOTTOM_ATTACH_PX = 8;
const MANUAL_DETACH_DELTA_PX = 24;
const REACTION_OPTIONS: Array<{ reaction: ReactionType; emoji: string; label: string }> = [
  { reaction: "LIKE", emoji: "❤️", label: "Like" },
  { reaction: "LOL", emoji: "😂", label: "LOL" },
  { reaction: "FIRE", emoji: "🔥", label: "FIRE" },
  { reaction: "BASED", emoji: "🫡", label: "BASED" },
  { reaction: "WTF", emoji: "💀", label: "WTF" },
  { reaction: "BIG_BRAIN", emoji: "🧠", label: "BIG BRAIN" },
];
const AI_ASSISTANT_USERNAMES = new Set(["chatgpt", "grok"]);
const AI_CLIENT_IDS = new Set(["chatgpt", "grok"]);
const REACTION_SCORE_BY_TYPE: Record<ReactionType, number> = {
  LIKE: 1.0,
  LOL: 1.4,
  FIRE: 1.2,
  BASED: 1.1,
  WTF: 1.0,
  BIG_BRAIN: 1.2,
};

function hasChatGptMention(message: string): boolean {
  return /(^|\s)@chatgpt\b/i.test(message);
}

function aiTagForReplyMessage(message: MessageDTO): "chatgpt" | "grok" | null {
  const normalizedUsername = message.username.trim().toLowerCase();
  if (normalizedUsername === "chatgpt" || message.authorId === "chatgpt") return "chatgpt";
  if (normalizedUsername === "grok" || message.authorId === "grok") return "grok";
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureLeadingAiReplyTag(draft: string, provider: "chatgpt" | "grok"): string {
  const oppositeProvider = provider === "chatgpt" ? "grok" : "chatgpt";
  let nextDraft = draft;

  if (hasLeadingAiTag(nextDraft, oppositeProvider)) {
    nextDraft = toggleLeadingAiTag(nextDraft, oppositeProvider);
  }
  if (!hasLeadingAiTag(nextDraft, provider)) {
    nextDraft = toggleLeadingAiTag(nextDraft, provider);
  }
  return nextDraft;
}

function ensureLeadingMentionTag(draft: string, mentionHandle: string): string {
  const normalizedHandle = mentionHandle.trim().replace(/^@+/, "");
  if (!normalizedHandle) return draft;

  const leadingMentionPattern = new RegExp(`^\\s*@${escapeRegExp(normalizedHandle)}\\b`, "i");
  if (leadingMentionPattern.test(draft)) {
    return draft;
  }

  const trimmedDraft = draft.trimStart();
  return trimmedDraft ? `@${normalizedHandle} ${trimmedDraft}` : `@${normalizedHandle} `;
}

function mergeUser(users: UserPresenceDTO[], next: UserPresenceDTO): UserPresenceDTO[] {
  const index = users.findIndex((user) => user.clientId === next.clientId);
  if (index === -1) return [...users, next];
  const copy = [...users];
  copy[index] = next;
  return copy;
}

function mergeMessage(
  messages: MessageDTO[],
  next: MessageDTO,
  options: { preserveViewerReaction?: boolean } = {},
): MessageDTO[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index === -1) {
    return [...messages, next].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }
  const copy = [...messages];
  const previous = copy[index];
  const preserveViewerReaction =
    Boolean(options.preserveViewerReaction) &&
    previous?.reactions
    && next.reactions
    && next.reactions.viewerReaction === null
    && previous.reactions.viewerReaction !== null;
  if (preserveViewerReaction && previous.reactions && next.reactions) {
    copy[index] = {
      ...next,
      reactions: {
        ...next.reactions,
        viewerReaction: previous.reactions.viewerReaction,
      },
    };
    return copy;
  }
  copy[index] = next;
  return copy;
}

function mergeMessages(
  messages: MessageDTO[],
  incoming: MessageDTO[],
  options: { preserveViewerReaction?: boolean } = {},
): MessageDTO[] {
  return incoming.reduce((current, message) => mergeMessage(current, message, options), messages);
}

function limitVisibleMessages(messages: MessageDTO[]): MessageDTO[] {
  if (messages.length <= MAX_VISIBLE_MESSAGES) return messages;
  return messages.slice(-MAX_VISIBLE_MESSAGES);
}

function mergeMediaItems(current: MediaItemDTO[], incoming: MediaItemDTO[]): MediaItemDTO[] {
  const seen = new Set(current.map((item) => item.url));
  const merged = [...current];
  for (const item of incoming) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push(item);
  }
  return merged;
}

function normalizeProfilePictureUrl(value: string | null | undefined, fallback = getDefaultProfilePicture()): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return fallback;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return fallback;
  }
}

function toSessionState(session: AuthSessionDTO): SessionState {
  return {
    id: session.id,
    clientId: session.clientId,
    loginName: session.loginName,
    username: session.username,
    profilePicture: session.profilePicture || getDefaultProfilePicture(),
    sessionToken: session.sessionToken,
    sessionExpiresAt: session.sessionExpiresAt,
    devMode: session.devMode,
    devAuthToken: session.devAuthToken,
  };
}

function applyOptimisticPollVote(
  messages: MessageDTO[],
  input: {
    pollMessageId: string;
    optionIds: string[];
    voter: {
      id: string;
      username: string;
      profilePicture: string;
    };
  },
): MessageDTO[] {
  let changed = false;
  const normalizedVoter = input.voter.username.trim().toLowerCase();
  const selected = new Set(input.optionIds);

  const nextMessages = messages.map((message) => {
    if (message.id !== input.pollMessageId || !message.poll) {
      return message;
    }

    let optionChanged = false;
    const nextOptions = message.poll.options.map((option) => {
      const votersWithoutCurrent = option.voters.filter(
        (voter) => voter.username.trim().toLowerCase() !== normalizedVoter,
      );

      const shouldSelect = selected.has(option.id);
      const nextVoters = shouldSelect
        ? [
          ...votersWithoutCurrent,
          {
            id: input.voter.id,
            username: input.voter.username,
            profilePicture: input.voter.profilePicture,
          },
        ]
        : votersWithoutCurrent;

      const nextVotes = nextVoters.length;
      if (nextVotes !== option.votes || nextVoters.length !== option.voters.length) {
        optionChanged = true;
      }

      return {
        ...option,
        votes: nextVotes,
        voters: nextVoters,
      };
    });

    if (!optionChanged) {
      return message;
    }

    changed = true;
    return {
      ...message,
      poll: {
        ...message.poll,
        options: nextOptions,
      },
      resultone: String(nextOptions[0]?.votes ?? 0),
      resulttwo: String(nextOptions[1]?.votes ?? 0),
    };
  });

  return changed ? nextMessages : messages;
}

function applyOptimisticReaction(
  messages: MessageDTO[],
  input: {
    messageId: string;
    reaction: ReactionType;
  },
): MessageDTO[] {
  let changed = false;

  const nextMessages = messages.map((message) => {
    if (message.id !== input.messageId || !message.reactions) return message;

    const summaryMap = new Map<ReactionType, number>(
      REACTION_OPTIONS.map((option) => [option.reaction, 0]),
    );
    const usersMap = new Map<
      ReactionType,
      Array<{ id: string; username: string; profilePicture: string }>
    >(REACTION_OPTIONS.map((option) => [option.reaction, []]));
    for (const entry of message.reactions.summary) {
      summaryMap.set(entry.reaction, entry.count);
      usersMap.set(entry.reaction, entry.users);
    }

    const currentReaction = message.reactions.viewerReaction;
    const nextReaction = currentReaction === input.reaction ? null : input.reaction;

    if (currentReaction) {
      summaryMap.set(currentReaction, Math.max(0, (summaryMap.get(currentReaction) || 0) - 1));
    }
    if (nextReaction) {
      summaryMap.set(nextReaction, (summaryMap.get(nextReaction) || 0) + 1);
    }

    const summary = REACTION_OPTIONS.map((option) => ({
      reaction: option.reaction,
      count: summaryMap.get(option.reaction) || 0,
      users: usersMap.get(option.reaction) || [],
    }));
    const total = summary.reduce((sum, entry) => sum + entry.count, 0);
    const score = Math.round(
      summary.reduce((sum, entry) => sum + entry.count * REACTION_SCORE_BY_TYPE[entry.reaction], 0) * 100,
    ) / 100;

    changed = true;
    return {
      ...message,
      reactions: {
        ...message.reactions,
        viewerReaction: nextReaction,
        total,
        score,
        summary,
      },
    };
  });

  return changed ? nextMessages : messages;
}

function toNewestTimestamp(current: string | null, candidate: string): string {
  if (!current) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

interface LightboxState {
  url: string;
  alt: string;
}

type LightboxCopyState = "idle" | "success" | "link" | "error";

interface ReplyTargetState {
  id: string;
  username: string;
  message: string;
}

interface PollExtendDraftState {
  pollMessageId: string;
  existingOptions: string[];
}

async function uploadProfileImage(file: File, signal?: AbortSignal): Promise<string> {
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch("/api/uploads/profile", { method: "POST", body: formData, signal });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Upload fehlgeschlagen");
  }
  const payload = (await response.json()) as UploadResponse;
  return payload.url;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

function extractSupportedImageFiles(
  dataTransfer: DataTransfer | null | undefined,
  supportedMimeTypes: Set<string>,
): File[] {
  if (!dataTransfer) return [];

  const fromItems = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
    .filter((file) => supportedMimeTypes.has(file.type));
  if (fromItems.length > 0) return fromItems;

  return Array.from(dataTransfer.files).filter((file) => supportedMimeTypes.has(file.type));
}

function statusForComposer(input: {
  mode: ComposerMode;
  messageDraft: string;
  hasUploadedImages: boolean;
  questionDraft: string;
  pollQuestion: string;
  pollOptions: string[];
}): string {
  if (input.mode === "message" && (input.messageDraft.trim() || input.hasUploadedImages)) return "schreibt…";
  if (input.mode === "question" && input.questionDraft.trim()) return "stellt eine Frage…";
  if (input.mode === "poll") {
    const hasPollContent = input.pollQuestion.trim() || input.pollOptions.some((option) => option.trim());
    if (hasPollContent) return "erstellt eine Umfrage…";
  }
  return "";
}

const LAST_SEEN_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

function formatLastSeenStatus(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "zuletzt kürzlich aktiv";
  return `zuletzt aktiv ${date.toLocaleTimeString("de-DE", LAST_SEEN_TIME_OPTIONS)}`;
}

function formatPresenceStatus(user: UserPresenceDTO): string {
  const explicitStatusRaw = user.status.trim();
  const explicitStatus = explicitStatusRaw.toLowerCase();
  if (explicitStatus === "online") return "online";
  if (explicitStatus === "typing…") return "schreibt…";
  if (explicitStatus === "thinking…") return "denkt nach…";
  if (explicitStatus === "creating image…") return "erstellt Bild…";
  if (explicitStatus === "writing…") return "schreibt…";
  if (explicitStatusRaw) return explicitStatusRaw;
  if (user.isOnline) return "online";
  if (user.lastSeenAt) return formatLastSeenStatus(user.lastSeenAt);
  return "online";
}

function toSyntheticPublicProfile(user: UserPresenceDTO): PublicUserProfileDTO {
  return {
    userId: user.id,
    clientId: user.clientId,
    username: user.username,
    profilePicture: normalizeProfilePictureUrl(user.profilePicture),
    status: user.status,
    isOnline: user.isOnline,
    lastSeenAt: user.lastSeenAt,
    memberSince: null,
    mentionHandle: user.mentionHandle,
    member: user.member,
    bot: user.bot,
    stats: {
      postsTotal: 0,
      reactionsGiven: 0,
      reactionsReceived: 0,
      pollsCreated: 0,
      pollVotes: 0,
      activeDays: 0,
    },
  };
}

function isRightAlignedMessage(message: MessageDTO, currentUsername: string, currentUserId?: string): boolean {
  if (currentUserId && message.authorId === currentUserId) return true;

  const viewerUsernameNormalized = currentUsername.trim().toLowerCase();
  if (!viewerUsernameNormalized) return false;

  const authorNameNormalized = message.username.trim().toLowerCase();
  if (authorNameNormalized === viewerUsernameNormalized) return true;

  return AI_ASSISTANT_USERNAMES.has(authorNameNormalized)
    && message.oldusername?.trim().toLowerCase() === viewerUsernameNormalized;
}

function buildDownloadFileName(alt: string): string {
  const sanitized = alt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!sanitized) return "chatppc-bild.png";
  return `${sanitized.slice(0, 48)}.png`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function aiProgressForStatus(status: string): number {
  const normalized = status.trim().toLowerCase();
  if (!normalized || normalized === "online") return 0;
  if (normalized.includes("thinking") || normalized.includes("denkt")) return 34;
  if (normalized.includes("creating image") || normalized.includes("erstellt bild")) return 70;
  if (normalized.includes("writing") || normalized.includes("schreibt")) return 90;
  return 55;
}

function shouldShowAiProgress(user: UserPresenceDTO): boolean {
  return (user.clientId === "chatgpt" || user.clientId === "grok") && aiProgressForStatus(user.status) > 0;
}

function createDefaultAiStatus(): AiStatusDTO {
  return {
    chatgpt: "online",
    grok: "online",
    chatgptModel: "Modell dynamisch (Prompt)",
    grokModel: "Modell wird geladen…",
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultAppKillState(): AppKillDTO {
  return {
    enabled: false,
    updatedAt: null,
    updatedBy: null,
  };
}

interface MessageListProps {
  messages: MessageDTO[];
  currentUserId?: string;
  currentUsername: string;
  isDeveloperMode: boolean;
  pendingDeliveries: Record<string, true>;
  answerDrafts: Record<string, string>;
  onAnswerDraftChange: (messageId: string, value: string) => void;
  onSubmitAnswer: (messageId: string) => void;
  onVote: (messageId: string, optionIds: string[]) => void;
  onReact: (messageId: string, reaction: ReactionType) => void;
  onExtendPoll: (message: MessageDTO) => void;
  onDeleteMessage: (messageId: string) => void;
  onStartReply: (message: MessageDTO) => void;
  onOpenLightbox: (url: string, alt?: string) => void;
  onRemixImage: (url: string, alt?: string) => void;
  onOpenAuthorProfile: (message: MessageDTO) => void;
}

const MessageList = memo(function MessageList({
  messages,
  currentUserId,
  currentUsername,
  isDeveloperMode,
  pendingDeliveries,
  answerDrafts,
  onAnswerDraftChange,
  onSubmitAnswer,
  onVote,
  onReact,
  onExtendPoll,
  onDeleteMessage,
  onStartReply,
  onOpenLightbox,
  onRemixImage,
  onOpenAuthorProfile,
}: MessageListProps) {
  const orderedMessages = useMemo(
    () =>
      [...messages].sort((a, b) => {
        const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      }),
    [messages],
  );

  const threadedEntries = useMemo(() => {
    const messageById = new Map(orderedMessages.map((message) => [message.id, message] as const));

    const resolveThreadRootId = (message: MessageDTO): string | null => {
      if (!message.questionId) return null;

      const visited = new Set<string>([message.id]);
      let currentParentId: string | undefined = message.questionId;

      while (currentParentId) {
        if (visited.has(currentParentId)) return null;
        visited.add(currentParentId);

        const parent = messageById.get(currentParentId);
        if (!parent) return null;
        if (!parent.questionId) return parent.id;
        currentParentId = parent.questionId;
      }

      return null;
    };

    return orderedMessages.map((message) => {
      const threadRootId = resolveThreadRootId(message);
      const isThreadChild = Boolean(threadRootId && threadRootId !== message.id);
      return {
        message,
        threadKey: isThreadChild ? threadRootId : message.id,
        isThreadChild,
      };
    });
  }, [orderedMessages]);

  const renderMessage = (message: MessageDTO) => {
    return (
      <ChatMessage
        message={message}
        currentUserId={currentUserId}
        currentUsername={currentUsername}
        isDeveloperMode={isDeveloperMode}
        delivery={
          pendingDeliveries[message.id] !== undefined
            ? { status: "sending" }
            : undefined
        }
        answerDraft={answerDrafts[message.id] || ""}
        onAnswerDraftChange={onAnswerDraftChange}
        onSubmitAnswer={onSubmitAnswer}
        onVote={onVote}
        onReact={onReact}
        onExtendPoll={onExtendPoll}
        onDeleteMessage={onDeleteMessage}
        onStartReply={onStartReply}
        onOpenLightbox={onOpenLightbox}
        onRemixImage={onRemixImage}
        onOpenAuthorProfile={onOpenAuthorProfile}
      />
    );
  };

  return (
    <>
      {threadedEntries.map((entry, index) => {
        const previous = threadedEntries[index - 1];
        const next = threadedEntries[index + 1];
        const connectsToPrevious = entry.isThreadChild && previous?.threadKey === entry.threadKey;
        const connectsToNext = entry.isThreadChild && next?.isThreadChild && next.threadKey === entry.threadKey;
        const showThreadRail = connectsToPrevious || connectsToNext;
        const railClassName = isRightAlignedMessage(entry.message, currentUsername, currentUserId)
          ? "mr-2 border-r border-slate-200 pr-2 sm:mr-6 sm:pr-3"
          : "ml-2 border-l border-slate-200 pl-2 sm:ml-6 sm:pl-3";

        return (
          <div
            key={`message-row-${entry.message.id}`}
            className={showThreadRail ? `min-w-0 space-y-2 ${railClassName}` : "min-w-0 space-y-2"}
          >
            {renderMessage(entry.message)}
          </div>
        );
      })}
    </>
  );
});

interface OnlineUsersListProps {
  users: UserPresenceDTO[];
  avatarSizeClassName: string;
  currentUserId?: string | null;
  currentUsername?: string | null;
  botSlots?: { limit: number; used: number; remaining: number };
  onOpenBotCreator?: () => void;
  onOpenMemberProfile: (user: UserPresenceDTO) => void;
}

const OnlineUsersList = memo(function OnlineUsersList({
  users,
  avatarSizeClassName,
  currentUserId,
  currentUsername,
  botSlots,
  onOpenBotCreator,
  onOpenMemberProfile,
}: OnlineUsersListProps) {
  const normalizedCurrentUsername = currentUsername?.trim().toLowerCase() || null;
  const ownBots = users.filter((user) => {
    if (!user.bot) return false;
    if (currentUserId && user.bot.createdByUserId === currentUserId) return true;
    if (!currentUserId && normalizedCurrentUsername) {
      return user.bot.createdByUsername.trim().toLowerCase() === normalizedCurrentUsername;
    }
    return false;
  });
  const ownBotIds = new Set(ownBots.map((user) => user.clientId));
  const restUsers = users.filter((user) => !ownBotIds.has(user.clientId));
  const remainingBotSlots = Math.max(0, botSlots?.remaining ?? 0);
  const canCreateBot = remainingBotSlots > 0;
  const createBotSubtitle =
    ownBots.length === 0
      ? "Eigenen Charakter anlegen"
      : !canCreateBot
        ? "Bot-Limit erreicht"
        : (botSlots?.limit ?? 1) <= 1
          ? "Zweiter Bot erst ab Rank Platin"
          : remainingBotSlots === 1
            ? "1 weiterer Bot-Slot frei"
            : `${remainingBotSlots} weitere Bot-Slots frei`;

  const renderUserRow = (user: UserPresenceDTO) => {
    const avatarUrl = normalizeProfilePictureUrl(user.profilePicture);
    const status = formatPresenceStatus(user);
    return (
      <button
        key={user.clientId}
        type="button"
        onClick={() => onOpenMemberProfile(user)}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-2 text-left transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        aria-label={`Profil von ${user.username} öffnen`}
      >
        <div className={`${avatarSizeClassName} shrink-0 overflow-hidden rounded-full border border-slate-200`}>
          <img
            src={avatarUrl}
            alt={`${user.username} Profilbild`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            width={44}
            height={44}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{user.username}</p>
          <div className="mt-1 space-y-1">
            <p className="truncate text-xs text-slate-600">{status}</p>
            <div>
              <MemberProgressInline member={user.member} bot={user.bot} variant="list" />
            </div>
          </div>
          {shouldShowAiProgress(user) ? (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out animate-pulse"
                style={{ width: `${aiProgressForStatus(user.status)}%` }}
              />
            </div>
          ) : null}
        </div>
      </button>
    );
  };

  return (
    <>
      {onOpenBotCreator ? (
        <button
          type="button"
          onClick={onOpenBotCreator}
          className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 ${
            canCreateBot
              ? "border-slate-200 bg-white hover:bg-slate-50 focus-visible:ring-sky-300"
              : "border-slate-200 bg-slate-50 opacity-80 hover:bg-slate-100 hover:opacity-100 focus-visible:ring-slate-300"
          }`}
          aria-label="Bot-Editor öffnen"
        >
          <div
            className={`${avatarSizeClassName} flex shrink-0 items-center justify-center rounded-full border ${
              canCreateBot
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-slate-300 bg-slate-200 text-slate-600"
            }`}
          >
            <PlusIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${canCreateBot ? "text-slate-900" : "text-slate-700"}`}>
              Bot erstellen
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">
              {createBotSubtitle}
            </p>
          </div>
        </button>
      ) : null}
      {ownBots.map((user) => renderUserRow(user))}
      {restUsers.map((user) => {
        return renderUserRow(user);
      })}
    </>
  );
});

function seededUnit(seed: number): number {
  const value = Math.sin(seed) * 10_000;
  return value - Math.floor(value);
}

function RankUpConfettiOverlay({
  confettiKey,
  username,
  rankLabel,
}: {
  confettiKey: number;
  username: string;
  rankLabel: string;
}) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 34 }, (_, index) => {
        const seed = confettiKey + index * 17;
        const left = 4 + Math.floor(seededUnit(seed) * 92);
        const drift = -20 + Math.floor(seededUnit(seed + 1) * 40);
        const delay = Math.floor(seededUnit(seed + 2) * 360);
        const duration = 1_350 + Math.floor(seededUnit(seed + 3) * 750);
        const rotate = Math.floor(seededUnit(seed + 4) * 360);
        const hue = 20 + Math.floor(seededUnit(seed + 5) * 320);
        return {
          id: `${confettiKey}-${index}`,
          left,
          drift,
          delay,
          duration,
          rotate,
          color: `hsl(${hue} 88% 58%)`,
        };
      }),
    [confettiKey],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-[95] overflow-hidden" aria-hidden="true">
      <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-slate-900/88 px-4 py-2 text-xs font-semibold text-white shadow-lg">
        {username} erreicht {rankLabel}
      </div>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="ppc-rank-confetti-piece"
          style={{
            left: `${piece.left}%`,
            backgroundColor: piece.color,
            transform: `translate3d(0, -16px, 0) rotate(${piece.rotate}deg)`,
            animationDelay: `${piece.delay}ms`,
            animationDuration: `${piece.duration}ms`,
            "--ppc-confetti-drift": `${piece.drift}px`,
          } as CSSProperties & { "--ppc-confetti-drift": string }}
        />
      ))}
    </div>
  );
}

interface ScoreGainOverlayItem {
  id: number;
  username: string;
  delta: number;
}

function ScoreGainOverlay({ items }: { items: ScoreGainOverlayItem[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[1200] overflow-hidden" aria-hidden="true">
      <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] flex w-[min(92vw,22rem)] flex-col items-end gap-2 sm:right-4">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="ppc-score-gain-overlay-chip"
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <span className="font-semibold text-slate-800">{item.username}</span>
            <span className="ml-1 text-emerald-700">+{item.delta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatApp() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const profileUploadRef = useRef<HTMLInputElement>(null);
  const botProfileUploadRef = useRef<HTMLInputElement>(null);
  const chatUploadRef = useRef<HTMLInputElement>(null);
  const backgroundUploadRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const mediaScrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<EventSource | null>(null);
  const streamReconnectTimeoutRef = useRef<number | null>(null);
  const streamReconnectAttemptRef = useRef(0);
  const lastStreamActivityAtRef = useRef(Date.now());
  const isAtBottomRef = useRef(true);
  const latestMessageAtRef = useRef<string | null>(null);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const mediaItemsRef = useRef<MediaItemDTO[]>([]);
  const mediaNextCursorRef = useRef<string | null>(null);
  const isLeavingRef = useRef(false);
  const isWindowFocusedRef = useRef(typeof document === "undefined" ? true : !document.hidden);
  const lastSentStatusRef = useRef<string>("");
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const optimisticVoteRollbackRef = useRef<MessageDTO[] | null>(null);
  const optimisticReactionRollbackRef = useRef<MessageDTO[] | null>(null);
  const draftBeforeHistoryRef = useRef("");
  const dragDepthRef = useRef(0);
  const lightboxCopyResetTimeoutRef = useRef<number | null>(null);
  const validationToastResetTimeoutRef = useRef<number | null>(null);
  const bottomStickFrameRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);
  const lastKnownScrollHeightRef = useRef(0);
  const lastKnownBottomOffsetRef = useRef(0);
  const topLoadCooldownUntilRef = useRef(0);
  const topLoadInFlightRef = useRef(false);
  const userDetachedFromBottomRef = useRef(false);
  const tasteModalRefetchTimeoutRef = useRef<number | null>(null);
  const tasteModalOpenRef = useRef(false);
  const memberHighlightResetTimeoutRef = useRef<number | null>(null);
  const rankCelebrationResetTimeoutRef = useRef<number | null>(null);
  const scoreGainOverlayTimeoutsRef = useRef<Map<number, number>>(new Map());
  const knownMemberScoresRef = useRef<Map<string, number>>(new Map());
  const memberScoresBootstrappedRef = useRef(false);
  const previousOwnMemberScoreRef = useRef<number | null>(null);
  const publicProfileCacheRef = useRef<Record<string, PublicUserProfileDTO>>({});

  const [session, setSession] = useState<SessionState | null>(() => loadSession());
  const [users, setUsers] = useState<UserPresenceDTO[]>([]);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [messageWindowSize, setMessageWindowSize] = useState(MESSAGE_RENDER_WINDOW);
  const [error, setError] = useState<string | null>(null);
  const [validationNotice, setValidationNotice] = useState<{ title: string; message: string } | null>(null);
  const [highlightOwnMember, setHighlightOwnMember] = useState(false);
  const [scoreGainOverlays, setScoreGainOverlays] = useState<ScoreGainOverlayItem[]>([]);
  const [rankCelebration, setRankCelebration] = useState<{ key: number; username: string; rankLabel: string } | null>(null);
  const [appKillState, setAppKillState] = useState<AppKillDTO>(() => createDefaultAppKillState());
  const [aiStatus, setAiStatus] = useState<AiStatusDTO>(() => createDefaultAiStatus());
  const [uploadingChat, setUploadingChat] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [chatBackgroundUrl, setChatBackgroundUrl] = useState<string | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItemDTO[]>([]);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [mediaTotalCount, setMediaTotalCount] = useState(0);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingMediaMore, setLoadingMediaMore] = useState(false);
  const [mediaVisibleCount, setMediaVisibleCount] = useState(60);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [showPointsInfo, setShowPointsInfo] = useState(false);
  const [showBackgroundModal, setShowBackgroundModal] = useState(false);
  const [backgroundDraftUrl, setBackgroundDraftUrl] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("message");
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    if (typeof document === "undefined") return true;
    return !document.hidden;
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialMessagesLoaded, setInitialMessagesLoaded] = useState(false);
  const [showTasteProfileModal, setShowTasteProfileModal] = useState(false);
  const [tasteWindow, setTasteWindow] = useState<TasteWindowKey>("30d");
  const [tasteProfileDetailed, setTasteProfileDetailed] = useState<TasteProfileDetailedDTO | null>(null);
  const [tasteProfileEvents, setTasteProfileEvents] = useState<TasteProfileEventDTO[]>([]);
  const [tasteEventsCursor, setTasteEventsCursor] = useState<string | null>(null);
  const [tasteEventsHasMore, setTasteEventsHasMore] = useState(false);
  const [tasteProfileLoading, setTasteProfileLoading] = useState(false);
  const [tasteEventsLoading, setTasteEventsLoading] = useState(false);
  const [tasteEventsLoadingMore, setTasteEventsLoadingMore] = useState(false);
  const [tasteProfileError, setTasteProfileError] = useState<string | null>(null);
  const [pendingDeliveries, setPendingDeliveries] = useState<Record<string, true>>({});
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [lightboxCopyState, setLightboxCopyState] = useState<LightboxCopyState>("idle");
  const [lightboxControlsVisible, setLightboxControlsVisible] = useState(true);
  const [lightboxSupportsHover, setLightboxSupportsHover] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTargetState | null>(null);

  const [messageDraft, setMessageDraft] = useState("");
  const [uploadedDraftImages, setUploadedDraftImages] = useState<UploadedDraftImage[]>([]);
  const [questionDraft, setQuestionDraft] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMultiSelect, setPollMultiSelect] = useState(false);
  const [pollExtendDraft, setPollExtendDraft] = useState<PollExtendDraftState | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);
  const [editingBots, setEditingBots] = useState(false);
  const [memberDrawerOpen, setMemberDrawerOpen] = useState(false);
  const [memberDrawerProfile, setMemberDrawerProfile] = useState<PublicUserProfileDTO | null>(null);
  const [memberDrawerOwnStats, setMemberDrawerOwnStats] = useState<PublicUserProfileStatsDTO | null>(null);
  const [memberDrawerLoading, setMemberDrawerLoading] = useState(false);
  const [memberDrawerError, setMemberDrawerError] = useState<string | null>(null);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [profileCropFile, setProfileCropFile] = useState<File | null>(null);
  const [profileCropTarget, setProfileCropTarget] = useState<"profile" | "bot" | null>(null);
  const [usernameDraft, setUsernameDraft] = useState(() => loadSession()?.username || "");
  const [loginNameDraft, setLoginNameDraft] = useState(() => loadSession()?.loginName || "");
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState("");
  const [newPasswordDraft, setNewPasswordDraft] = useState("");
  const [confirmNewPasswordDraft, setConfirmNewPasswordDraft] = useState("");
  const [profilePictureDraft, setProfilePictureDraft] = useState(
    () => loadSession()?.profilePicture || getDefaultProfilePicture(),
  );
  const [managedBots, setManagedBots] = useState<ManagedBotDTO[]>([]);
  const [botSlots, setBotSlots] = useState<{ limit: number; used: number; remaining: number }>({
    limit: 1,
    used: 0,
    remaining: 1,
  });
  const [loadingBots, setLoadingBots] = useState(false);
  const [savingBot, setSavingBot] = useState(false);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [botComposerOpen, setBotComposerOpen] = useState(false);
  const [botAutomationExpanded, setBotAutomationExpanded] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [botNameDraft, setBotNameDraft] = useState("");
  const [botProfilePictureDraft, setBotProfilePictureDraft] = useState(getDefaultProfilePicture());
  const [botHandleDraft, setBotHandleDraft] = useState("");
  const [botLanguagePreferenceDraft, setBotLanguagePreferenceDraft] = useState<BotLanguagePreference>("all");
  const [botInstructionsDraft, setBotInstructionsDraft] = useState("");
  const [botCatchphrasesDraft, setBotCatchphrasesDraft] = useState("");
  const [botAutonomousEnabledDraft, setBotAutonomousEnabledDraft] = useState(false);
  const [botAutonomousMinMinutesDraft, setBotAutonomousMinMinutesDraft] = useState("60");
  const [botAutonomousMaxMinutesDraft, setBotAutonomousMaxMinutesDraft] = useState("240");
  const [botAutonomousPromptDraft, setBotAutonomousPromptDraft] = useState("");
  const [uploadingBotProfile, setUploadingBotProfile] = useState(false);

  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [composerHistoryIndex, setComposerHistoryIndex] = useState(-1);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [profileDropActive, setProfileDropActive] = useState(false);
  const [botProfileDropActive, setBotProfileDropActive] = useState(false);
  const [composerHeightPx, setComposerHeightPx] = useState(DEFAULT_COMPOSER_HEIGHT_PX);
  const [, startUiTransition] = useTransition();
  const isDeveloperMode = Boolean(session?.devMode && session.devAuthToken);
  const profileEditorCloseBlocked = profileCropFile !== null;
  const maxBotCatchphraseLength = 240;
  const minBotAutonomousIntervalMinutes = 5;
  const maxBotAutonomousIntervalMinutes = 1440;

  const sessionProfilePicture = useMemo(
    () => normalizeProfilePictureUrl(session?.profilePicture),
    [session?.profilePicture],
  );
  const ownPresence = useMemo(
    () => (session ? users.find((user) => user.clientId === session.clientId) : undefined),
    [session, users],
  );
  const ownMember = ownPresence?.member;
  const ownWindowStats = tasteProfileDetailed?.windows.all;
  const mediaVisibleCountRef = useRef(mediaVisibleCount);
  const mediaItemsWithDateLabel = useMemo(
    () =>
      mediaItems.map((item) => ({
        ...item,
        createdAtLabel: new Date(item.createdAt).toLocaleString("de-DE"),
      })),
    [mediaItems],
  );
  const visibleMediaItems = useMemo(
    () => mediaItemsWithDateLabel.slice(0, mediaVisibleCount),
    [mediaItemsWithDateLabel, mediaVisibleCount],
  );
  const mediaHasHiddenLocalItems = mediaVisibleCount < mediaItemsWithDateLabel.length;
  const ownProfileStats = useMemo(
    () => ({
      postsTotal: ownWindowStats?.activity.postsTotal ?? 0,
      reactionsGiven: ownWindowStats?.reactions.givenTotal ?? 0,
      reactionsReceived: ownWindowStats?.reactions.receivedTotal ?? 0,
      pollsCreated: ownWindowStats?.activity.pollsCreated ?? 0,
      pollVotes: ownWindowStats?.activity.pollVotesGiven ?? 0,
      activeDays: ownWindowStats?.activity.activeDays ?? 0,
    }),
    [ownWindowStats],
  );
  const botPreviewProfilePicture = normalizeProfilePictureUrl(botProfilePictureDraft);
  const botCreationLimitReached = managedBots.length >= botSlots.limit;
  const botLimitReached = !editingBotId && botCreationLimitReached;
  const botDisplayNameValue = botNameDraft.trim();
  const botHandlePreview = botHandleDraft.trim().replace(/^@+/, "").toLowerCase();
  const botHandlePatternValid = botHandlePreview.length === 0 || /^[a-z0-9-]+$/.test(botHandlePreview);
  const botHandleLengthValid =
    botHandlePreview.length === 0 || (botHandlePreview.length >= 3 && botHandlePreview.length <= 24);
  const botNameLengthValid =
    botDisplayNameValue.length === 0 || (botDisplayNameValue.length >= 2 && botDisplayNameValue.length <= 40);
  const botInstructionsLength = botInstructionsDraft.trim().length;
  const botInstructionsValid = botInstructionsLength > 0 && botInstructionsLength <= 1000;
  const botCatchphraseCount = botCatchphrasesDraft
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean).length;
  const botCatchphraseLineLengthValid = botCatchphrasesDraft
    .split("\n")
    .map((entry) => entry.trim())
    .every((entry) => entry.length === 0 || entry.length <= maxBotCatchphraseLength);
  const botCatchphraseLimitValid = botCatchphraseCount <= 8;
  const parsedBotAutonomousMinMinutes = Number.parseInt(botAutonomousMinMinutesDraft, 10);
  const parsedBotAutonomousMaxMinutes = Number.parseInt(botAutonomousMaxMinutesDraft, 10);
  const botAutonomousMinValid =
    Number.isFinite(parsedBotAutonomousMinMinutes)
    && parsedBotAutonomousMinMinutes >= minBotAutonomousIntervalMinutes
    && parsedBotAutonomousMinMinutes <= maxBotAutonomousIntervalMinutes;
  const botAutonomousMaxValid =
    Number.isFinite(parsedBotAutonomousMaxMinutes)
    && parsedBotAutonomousMaxMinutes >= minBotAutonomousIntervalMinutes
    && parsedBotAutonomousMaxMinutes <= maxBotAutonomousIntervalMinutes;
  const botAutonomousRangeValid =
    !botAutonomousEnabledDraft
    || (botAutonomousMinValid && botAutonomousMaxValid && parsedBotAutonomousMaxMinutes >= parsedBotAutonomousMinMinutes);
  const botAutonomousPromptValid = botAutonomousPromptDraft.trim().length <= 280;
  const botFormReady = Boolean(
    botDisplayNameValue
    && botHandlePreview
    && botNameLengthValid
    && botHandlePatternValid
    && botHandleLengthValid
    && botInstructionsValid
    && botAutonomousRangeValid
    && botAutonomousPromptValid
    && botCatchphraseLineLengthValid
    && botCatchphraseLimitValid,
  );
  const botSaveDisabled = savingBot || botLimitReached || isLeaving || !botFormReady;
  const botHelperText = botLimitReached
    ? "Dein aktueller Rang ist voll belegt. Bearbeite einen bestehenden Bot oder steig auf."
    : !botNameLengthValid
      ? "Name: 2 bis 40 Zeichen."
      : !botHandlePatternValid
        ? "Handle: nur a-z, 0-9 und Bindestriche."
        : !botHandleLengthValid
          ? "Handle: 3 bis 24 Zeichen."
            : !botInstructionsValid
              ? "Anweisungen: 1 bis 1000 Zeichen."
              : !botAutonomousRangeValid
                ? `Autopost-Intervall: ${minBotAutonomousIntervalMinutes} bis ${maxBotAutonomousIntervalMinutes} Minuten, Max >= Min.`
                : !botAutonomousPromptValid
                  ? "Autopost-Fokus: höchstens 280 Zeichen."
            : !botCatchphraseLineLengthValid
              ? `Jede Catchphrase darf höchstens ${maxBotCatchphraseLength} Zeichen lang sein.`
            : !botCatchphraseLimitValid
              ? "Maximal 8 Catchphrases, jeweils eine pro Zeile."
              : "Handle wird automatisch kleingeschrieben und kann von allen im Chat gepingt werden.";
  const botComposerTitle = editingBotId ? "Bot bearbeiten" : "Neuen Bot erstellen";
  const botInstructionsRemaining = Math.max(0, 1000 - botInstructionsLength);
  const ownScore = ownMember?.score ?? 0;
  const ownProgressPercent = useMemo(() => {
    if (!ownMember) return 0;
    if (!ownMember.nextRank) return 100;
    const currentThreshold = MEMBER_RANK_STEPS.find((step) => step.rank === ownMember.rank)?.minScore ?? 0;
    const nextThreshold = MEMBER_RANK_STEPS.find((step) => step.rank === ownMember.nextRank)?.minScore ?? ownMember.score;
    const range = Math.max(1, nextThreshold - currentThreshold);
    return Math.max(0, Math.min(100, ((ownMember.score - currentThreshold) / range) * 100));
  }, [ownMember]);
  const ownRankMilestones = useMemo(
    () => MEMBER_RANK_STEPS.map((step) => ({
      ...step,
      reached: ownScore >= step.minScore,
      remaining: Math.max(0, step.minScore - ownScore),
    })),
    [ownScore],
  );

  const onlineUsers = useMemo(
    () => [
      {
        id: "chatgpt",
        clientId: "chatgpt",
        username: "ChatGPT",
        profilePicture: normalizeProfilePictureUrl(chatgptAvatar.src),
        status: aiStatus.chatgpt,
        isOnline: true,
        lastSeenAt: aiStatus.updatedAt,
      },
      {
        id: "grok",
        clientId: "grok",
        username: "Grok",
        profilePicture: normalizeProfilePictureUrl(grokAvatar.src),
        status: aiStatus.grok,
        isOnline: true,
        lastSeenAt: aiStatus.updatedAt,
      },
      ...users
        .filter((user) => user.isOnline)
        .sort((a, b) => a.username.localeCompare(b.username))
        .map((user) => ({
          ...user,
          profilePicture: normalizeProfilePictureUrl(user.profilePicture),
        })),
    ],
    [users, aiStatus],
  );

  const sidebarOnlineUsers = useMemo(
    () =>
      onlineUsers.filter((user) => {
        const normalized = user.username.trim().toLowerCase();
        return !(normalized === "developer" || normalized.startsWith("developer-"));
      }),
    [onlineUsers],
  );

  const filteredMentionUsers = useMemo(() => {
    if (!mentionFilter) return onlineUsers;
    const normalizedFilter = mentionFilter.toLowerCase();
    return onlineUsers.filter((user) =>
      user.username.toLowerCase().includes(normalizedFilter)
      || user.bot?.mentionHandle.toLowerCase().includes(normalizedFilter),
    );
  }, [onlineUsers, mentionFilter]);

  const ownMessageHistory = useMemo(() => {
    if (!session) return [];
    const self = session.username.trim().toLowerCase();
    return messages
      .filter((message) => message.type === "message" && message.username.trim().toLowerCase() === self)
      .map((message) => message.message)
      .filter((value) => value.trim().length > 0);
  }, [messages, session]);

  const visibleMessages = useMemo(() => {
    if (messages.length <= messageWindowSize) return messages;
    return messages.slice(-messageWindowSize);
  }, [messageWindowSize, messages]);

  const derivedStatus = useMemo(
    () =>
      statusForComposer({
        mode: composerMode,
        messageDraft,
        hasUploadedImages: uploadedDraftImages.length > 0,
        questionDraft,
        pollQuestion,
        pollOptions,
      }),
    [composerMode, messageDraft, pollOptions, pollQuestion, questionDraft, uploadedDraftImages.length],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (!scrollRef.current) return;
    prependAnchorRef.current = null;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior,
    });
    lastKnownBottomOffsetRef.current = 0;
  }, []);

  const getDistanceFromBottom = useCallback((): number => {
    const element = scrollRef.current;
    if (!element) return 0;
    return Math.max(0, element.scrollHeight - (element.scrollTop + element.clientHeight));
  }, []);

  const isWithinAutoFollowRange = useCallback((): boolean => {
    return getDistanceFromBottom() <= AUTO_SCROLL_NEAR_BOTTOM_PX;
  }, [getDistanceFromBottom]);

  const captureScrollAnchor = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    prependAnchorRef.current = {
      height: element.scrollHeight,
      top: element.scrollTop,
    };
  }, []);

  const scheduleBottomStick = useCallback(() => {
    if (!isAtBottomRef.current || userDetachedFromBottomRef.current) return;
    if (bottomStickFrameRef.current !== null) return;

    bottomStickFrameRef.current = window.requestAnimationFrame(() => {
      bottomStickFrameRef.current = null;
      if (!isAtBottomRef.current || userDetachedFromBottomRef.current) return;
      scrollToBottom("auto");
    });
  }, [scrollToBottom]);

  const clearPendingDelivery = useCallback((messageId: string) => {
    setPendingDeliveries((current) => {
      if (!(messageId in current)) return current;
      const next = { ...current };
      delete next[messageId];
      return next;
    });
  }, []);

  const startPendingDelivery = useCallback(
    (messageId: string) => {
      setPendingDeliveries((current) => ({ ...current, [messageId]: true }));
    },
    [],
  );

  const createTempMessageId = useCallback((): string => {
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  const appendOptimisticMessage = useCallback(
    (message: MessageDTO) => {
      const shouldAutoScroll = isWithinAutoFollowRange();

      setMessages((current) => limitVisibleMessages(mergeMessage(current, message)));
      if (!shouldAutoScroll) {
        return;
      }

      prependAnchorRef.current = null;
      userDetachedFromBottomRef.current = false;
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      requestAnimationFrame(() => {
        scrollToBottom("smooth");
        requestAnimationFrame(() => scrollToBottom("auto"));
      });
    },
    [isWithinAutoFollowRange, scrollToBottom],
  );

  const removeOptimisticMessage = useCallback((messageId: string) => {
    knownMessageIdsRef.current.delete(messageId);
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  const handleMessageDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setMessageDraft(value);
      setComposerHistoryIndex((current) => (current === -1 ? current : -1));
      draftBeforeHistoryRef.current = "";

      const cursor = event.target.selectionStart ?? value.length;
      const textBefore = value.slice(Math.max(0, cursor - 80), cursor);
      const match = textBefore.match(/(?:^|\s)@([\w-]*)$/);
      if (match) {
        const nextFilter = match[1];
        startUiTransition(() => {
          setShowMentionSuggestions((current) => (current ? current : true));
          setMentionFilter((current) => (current === nextFilter ? current : nextFilter));
          setMentionIndex((current) => (current === 0 ? current : 0));
        });
      } else {
        startUiTransition(() => {
          setShowMentionSuggestions((current) => (current ? false : current));
        });
      }
    },
    [startUiTransition],
  );

  const activateAskChatGpt = useCallback(() => {
    setComposerMode("message");
    setMessageDraft((current) => toggleLeadingAiTag(current, "chatgpt"));

    requestAnimationFrame(() => {
      const textarea = messageInputRef.current;
      if (!textarea) return;
      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }, []);

  const activateAskGrok = useCallback(() => {
    setComposerMode("message");
    setMessageDraft((current) => toggleLeadingAiTag(current, "grok"));

    requestAnimationFrame(() => {
      const textarea = messageInputRef.current;
      if (!textarea) return;
      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }, []);

  const updateLatestMessageCursor = useCallback((incoming: MessageDTO[]) => {
    for (const message of incoming) {
      latestMessageAtRef.current = toNewestTimestamp(latestMessageAtRef.current, message.createdAt);
    }
  }, []);

  const fetchMessagePage = useCallback(async (params: {
    limit?: number;
    before?: string;
    after?: string;
  }): Promise<MessagePageDTO> => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.limit ?? MESSAGE_PAGE_SIZE));
    if (session?.clientId) {
      searchParams.set("clientId", session.clientId);
    }
    if (params.before) searchParams.set("before", params.before);
    if (params.after) searchParams.set("after", params.after);
    return apiJson<MessagePageDTO>(`/api/messages?${searchParams.toString()}`);
  }, [session?.clientId]);

  const fetchPresence = useCallback(async (): Promise<UserPresenceDTO[]> => {
    return apiJson<UserPresenceDTO[]>("/api/presence");
  }, []);

  const fetchAiStatus = useCallback(async (): Promise<AiStatusDTO> => {
    return apiJson<AiStatusDTO>("/api/ai/status");
  }, []);

  const fetchChatBackground = useCallback(async (): Promise<ChatBackgroundDTO> => {
    return apiJson<ChatBackgroundDTO>("/api/chat/background");
  }, []);

  const fetchAppKillState = useCallback(async (): Promise<AppKillDTO> => {
    return apiJson<AppKillDTO>("/api/app/kill");
  }, []);

  const fetchPublicUserProfile = useCallback(async (targetClientId: string): Promise<PublicUserProfileDTO> => {
    if (!session?.clientId) {
      throw new Error("Sitzung nicht verfügbar.");
    }
    const searchParams = new URLSearchParams({
      viewerClientId: session.clientId,
      targetClientId,
    });
    return apiJson<PublicUserProfileDTO>(`/api/users/profile?${searchParams.toString()}`, {
      cache: "no-store",
    });
  }, [session?.clientId]);

  const fetchManagedBots = useCallback(async (): Promise<BotManagerDTO> => {
    if (!session?.clientId) {
      return {
        items: [],
        limit: 1,
        used: 0,
        remaining: 1,
      };
    }
    return apiJson<BotManagerDTO>(`/api/bots?clientId=${encodeURIComponent(session.clientId)}`, {
      cache: "no-store",
    });
  }, [session?.clientId]);

  const fetchTasteProfileDetailed = useCallback(async (): Promise<TasteProfileDetailedDTO | null> => {
    if (!session?.clientId) return null;
    return apiJson<TasteProfileDetailedDTO>(
      `/api/me/taste/profile?clientId=${encodeURIComponent(session.clientId)}`,
      { cache: "no-store" },
    );
  }, [session?.clientId]);

  const fetchTasteEventsPage = useCallback(async (input: {
    limit?: number;
    before?: string | null;
  } = {}): Promise<TasteProfileEventPageDTO> => {
    if (!session?.clientId) {
      return { items: [], hasMore: false, nextCursor: null };
    }
    const searchParams = new URLSearchParams({
      clientId: session.clientId,
      limit: String(Math.max(1, Math.min(200, input.limit ?? 50))),
    });
    if (input.before) {
      searchParams.set("before", input.before);
    }
    return apiJson<TasteProfileEventPageDTO>(`/api/me/taste/events?${searchParams.toString()}`, {
      cache: "no-store",
    });
  }, [session?.clientId]);

  const hydrateMediaCache = useCallback(() => {
    if (typeof window === "undefined") return false;

    try {
      const raw = window.localStorage.getItem(MEDIA_CACHE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        cachedAt: number;
        items: MediaItemDTO[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
      };

      if (!parsed || !Array.isArray(parsed.items) || typeof parsed.cachedAt !== "number") {
        return false;
      }
      if (Date.now() - parsed.cachedAt > MEDIA_CACHE_TTL_MS) {
        return false;
      }

      setMediaItems(parsed.items);
      mediaNextCursorRef.current = parsed.nextCursor ?? null;
      setMediaHasMore(Boolean(parsed.hasMore));
      setMediaTotalCount(Number.isFinite(parsed.total) ? parsed.total : parsed.items.length);
      return true;
    } catch {
      return false;
    }
  }, []);

  const persistMediaCache = useCallback((payload: {
    items: MediaItemDTO[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  }) => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(
        MEDIA_CACHE_KEY,
        JSON.stringify({
          cachedAt: Date.now(),
          items: payload.items.slice(0, 180),
          nextCursor: payload.nextCursor,
          hasMore: payload.hasMore,
          total: payload.total,
        }),
      );
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const fetchMediaItems = useCallback(
    async (options?: {
      silent?: boolean;
      append?: boolean;
      cursor?: string | null;
    }): Promise<void> => {
      const append = Boolean(options?.append);
      const cursor = append ? options?.cursor ?? mediaNextCursorRef.current : options?.cursor ?? null;

      if (append) {
        setLoadingMediaMore(true);
      } else if (!options?.silent && mediaItemsRef.current.length === 0) {
        setLoadingMedia(true);
      }

      try {
        const searchParams = new URLSearchParams({
          limit: String(MEDIA_PAGE_SIZE),
        });
        if (cursor) {
          searchParams.set("cursor", cursor);
        }

        const page = await apiJson<MediaPageDTO>(`/api/media?${searchParams.toString()}`, {
          cache: "no-store",
        });
        const nextItems = append ? mergeMediaItems(mediaItemsRef.current, page.items) : page.items;
        setMediaItems(nextItems);
        mediaNextCursorRef.current = page.nextCursor;
        setMediaHasMore(page.hasMore);
        setMediaTotalCount(page.total);
        persistMediaCache({
          items: nextItems,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          total: page.total,
        });
      } catch (mediaError) {
        if (!options?.silent || append || mediaItemsRef.current.length === 0) {
          setError(mediaError instanceof Error ? mediaError.message : "Medien konnten nicht geladen werden.");
        }
      } finally {
        if (append) {
          setLoadingMediaMore(false);
        } else {
          setLoadingMedia(false);
        }
      }
    },
    [persistMediaCache],
  );

  const applyIncomingMessages = useCallback(
    (incoming: MessageDTO[], options: { notify: boolean; preserveViewerReaction?: boolean }) => {
      if (incoming.length === 0) return;

      const shouldStickToBottom = isWithinAutoFollowRange();
      const fresh = incoming.filter((message) => !knownMessageIdsRef.current.has(message.id));

      if (!shouldStickToBottom && fresh.length > 0) {
        captureScrollAnchor();
        setMessageWindowSize((current) => Math.min(MAX_VISIBLE_MESSAGES, current + fresh.length));
      }

      setMessages((current) =>
        limitVisibleMessages(mergeMessages(current, incoming, { preserveViewerReaction: options.preserveViewerReaction })),
      );
      updateLatestMessageCursor(incoming);

      for (const message of fresh) {
        knownMessageIdsRef.current.add(message.id);
      }

      if (showMedia && fresh.length > 0) {
        void fetchMediaItems({ silent: true });
      }

      if (shouldStickToBottom) {
        userDetachedFromBottomRef.current = false;
        isAtBottomRef.current = true;
        setIsAtBottom(true);
        scheduleBottomStick();
      }
    },
    [captureScrollAnchor, fetchMediaItems, isWithinAutoFollowRange, scheduleBottomStick, showMedia, updateLatestMessageCursor],
  );

  const applySnapshot = useCallback(
    (snapshot: SnapshotDTO) => {
      if (isLeavingRef.current) return;

      setUsers(snapshot.users);
      setAiStatus(snapshot.aiStatus || createDefaultAiStatus());
      setChatBackgroundUrl(snapshot.background.url);
      setAppKillState(snapshot.appKill || createDefaultAppKillState());

      const latestSnapshotMessages = limitVisibleMessages(snapshot.messages);
      const preserveReadingPosition = userDetachedFromBottomRef.current || !isAtBottomRef.current;

      if (preserveReadingPosition) {
        setMessages((current) => limitVisibleMessages(mergeMessages(current, latestSnapshotMessages)));
        setMessageWindowSize((current) => {
          const minWindow = Math.min(latestSnapshotMessages.length, MESSAGE_RENDER_WINDOW);
          return Math.min(MAX_VISIBLE_MESSAGES, Math.max(current, minWindow));
        });
        setHasMoreOlder((current) => {
          const snapshotSuggestsMore =
            latestSnapshotMessages.length >= SNAPSHOT_LIMIT && latestSnapshotMessages.length < MAX_VISIBLE_MESSAGES;
          return current || snapshotSuggestsMore;
        });
        knownMessageIdsRef.current = new Set([
          ...knownMessageIdsRef.current,
          ...latestSnapshotMessages.map((message) => message.id),
        ]);
      } else {
        setMessages(latestSnapshotMessages);
        setMessageWindowSize(Math.min(latestSnapshotMessages.length, MESSAGE_RENDER_WINDOW));
        setHasMoreOlder(latestSnapshotMessages.length >= SNAPSHOT_LIMIT && latestSnapshotMessages.length < MAX_VISIBLE_MESSAGES);
        knownMessageIdsRef.current = new Set(latestSnapshotMessages.map((message) => message.id));
      }

      latestMessageAtRef.current = null;
      updateLatestMessageCursor(latestSnapshotMessages);

      if (showMedia) {
        void fetchMediaItems({ silent: true });
      }
    },
    [fetchMediaItems, showMedia, updateLatestMessageCursor],
  );

  const syncChatState = useCallback(async (): Promise<UserPresenceDTO[]> => {
    const [presence, page, ai, background, killState] = await Promise.all([
      fetchPresence(),
      fetchMessagePage({ limit: SNAPSHOT_LIMIT }),
      fetchAiStatus().catch(() => createDefaultAiStatus()),
      fetchChatBackground().catch(() => ({ url: null, updatedAt: null, updatedBy: null })),
      fetchAppKillState().catch(() => createDefaultAppKillState()),
    ]);

    setUsers(presence);
    setAiStatus(ai);
    setChatBackgroundUrl(background.url);
    setAppKillState(killState);
    const latestPageMessages = limitVisibleMessages(page.messages);
    const preserveReadingPosition = userDetachedFromBottomRef.current || !isAtBottomRef.current;

    if (preserveReadingPosition) {
      setMessages((current) => limitVisibleMessages(mergeMessages(current, latestPageMessages)));
      setMessageWindowSize((current) => {
        const minWindow = Math.min(latestPageMessages.length, MESSAGE_RENDER_WINDOW);
        return Math.min(MAX_VISIBLE_MESSAGES, Math.max(current, minWindow));
      });
      setHasMoreOlder((current) => current || page.hasMore);
      knownMessageIdsRef.current = new Set([
        ...knownMessageIdsRef.current,
        ...latestPageMessages.map((message) => message.id),
      ]);
    } else {
      setMessages(latestPageMessages);
      setMessageWindowSize(Math.min(latestPageMessages.length, MESSAGE_RENDER_WINDOW));
      setHasMoreOlder(page.hasMore && latestPageMessages.length < MAX_VISIBLE_MESSAGES);
      knownMessageIdsRef.current = new Set(latestPageMessages.map((message) => message.id));
    }

    latestMessageAtRef.current = null;
    updateLatestMessageCursor(latestPageMessages);

    return presence;
  }, [fetchAiStatus, fetchAppKillState, fetchChatBackground, fetchMessagePage, fetchPresence, updateLatestMessageCursor]);

  const restoreSessionPresence = useCallback(async (): Promise<void> => {
    if (!session || isLeavingRef.current) return;

    const restored = await apiJson<LoginResponseDTO>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        clientId: session.clientId,
        sessionToken: session.sessionToken,
      }),
    });

    const nextSession: SessionState = {
      id: restored.id,
      clientId: restored.clientId,
      loginName: restored.loginName,
      username: restored.username,
      profilePicture: restored.profilePicture || getDefaultProfilePicture(),
      sessionToken: restored.sessionToken,
      sessionExpiresAt: restored.sessionExpiresAt,
      devMode: restored.devMode || Boolean(session.devMode && session.devAuthToken),
      devAuthToken: restored.devAuthToken || session.devAuthToken,
    };

    saveSession(nextSession);
    setSession((current) => {
      if (
        current &&
        current.clientId === nextSession.clientId &&
        current.username === nextSession.username &&
        current.profilePicture === nextSession.profilePicture &&
        (current.sessionToken || "") === (nextSession.sessionToken || "") &&
        (current.sessionExpiresAt || "") === (nextSession.sessionExpiresAt || "") &&
        Boolean(current.devMode) === Boolean(nextSession.devMode) &&
        (current.devAuthToken || "") === (nextSession.devAuthToken || "")
      ) {
        return current;
      }

      return nextSession;
    });
  }, [session]);

  const syncSessionIdentityFromPresence = useCallback(
    (presenceUser: UserPresenceDTO | undefined): void => {
      if (!session || !presenceUser) return;
      if (presenceUser.clientId !== session.clientId) return;

      const nextProfilePicture = presenceUser.profilePicture || getDefaultProfilePicture();
      const nextId = session.id || presenceUser.id;
      const identityUnchanged = session.username === presenceUser.username
        && session.profilePicture === nextProfilePicture
        && (session.id || "") === (nextId || "");
      if (identityUnchanged) return;

      const nextSession: SessionState = {
        ...session,
        id: nextId,
        username: presenceUser.username,
        profilePicture: nextProfilePicture,
      };

      saveSession(nextSession);
      setSession((current) => {
        if (!current || current.clientId !== nextSession.clientId) return current;
        return {
          ...current,
          id: current.id || nextSession.id,
          username: nextSession.username,
          profilePicture: nextSession.profilePicture,
        };
      });
    },
    [session],
  );

  const ensureSessionInPresence = useCallback(
    async (presence: UserPresenceDTO[]): Promise<void> => {
      if (!session || isLeavingRef.current) return;

      const currentUser = presence.find((user) => user.clientId === session.clientId);
      if (currentUser) {
        syncSessionIdentityFromPresence(currentUser);
        return;
      }

      try {
        await restoreSessionPresence();
        await syncChatState();
      } catch {
        clearSession();
        setSession(null);
        router.replace("/login");
        throw new Error("Sitzung konnte nicht wiederhergestellt werden. Bitte erneut anmelden.");
      }
    },
    [restoreSessionPresence, router, session, syncChatState, syncSessionIdentityFromPresence],
  );

  const loadTasteProfileModalData = useCallback(async (): Promise<void> => {
    if (!session?.clientId) return;
    setTasteProfileError(null);
    setTasteProfileLoading(true);
    setTasteEventsLoading(true);
    try {
      const [profile, eventsPage] = await Promise.all([
        fetchTasteProfileDetailed(),
        fetchTasteEventsPage({ limit: 50 }),
      ]);
      setTasteProfileDetailed(profile);
      setTasteProfileEvents(eventsPage.items);
      setTasteEventsCursor(eventsPage.nextCursor);
      setTasteEventsHasMore(eventsPage.hasMore);
      setError(null);
    } catch (tasteError) {
      setTasteProfileError(
        tasteError instanceof Error ? tasteError.message : "Taste-Profil konnte nicht geladen werden.",
      );
    } finally {
      setTasteProfileLoading(false);
      setTasteEventsLoading(false);
    }
  }, [fetchTasteEventsPage, fetchTasteProfileDetailed, session?.clientId]);

  const loadMoreTasteProfileEvents = useCallback(async (): Promise<void> => {
    if (!session?.clientId || !tasteEventsHasMore || !tasteEventsCursor) return;
    setTasteEventsLoadingMore(true);
    try {
      const nextPage = await fetchTasteEventsPage({ limit: 50, before: tasteEventsCursor });
      setTasteProfileEvents((current) => {
        const known = new Set(current.map((item) => item.id));
        const merged = [...current];
        for (const item of nextPage.items) {
          if (known.has(item.id)) continue;
          known.add(item.id);
          merged.push(item);
        }
        return merged;
      });
      setTasteEventsCursor(nextPage.nextCursor);
      setTasteEventsHasMore(nextPage.hasMore);
    } catch {
      // Best effort.
    } finally {
      setTasteEventsLoadingMore(false);
    }
  }, [fetchTasteEventsPage, session?.clientId, tasteEventsCursor, tasteEventsHasMore]);

  const triggerRankCelebration = useCallback((input: { username: string; rankLabel: string }): void => {
    const nextKey = Date.now() + Math.floor(Math.random() * 1_000);
    setRankCelebration({
      key: nextKey,
      username: input.username,
      rankLabel: input.rankLabel,
    });

    if (rankCelebrationResetTimeoutRef.current !== null) {
      window.clearTimeout(rankCelebrationResetTimeoutRef.current);
    }
    rankCelebrationResetTimeoutRef.current = window.setTimeout(() => {
      setRankCelebration(null);
      rankCelebrationResetTimeoutRef.current = null;
    }, 2_800);
  }, []);

  const triggerScoreGainOverlay = useCallback((input: { username: string; delta: number }): void => {
    if (input.delta <= 0) return;
    const id = Date.now() + Math.floor(Math.random() * 10_000);
    setScoreGainOverlays((current) => [...current, { id, username: input.username, delta: input.delta }].slice(-6));
    const timeoutId = window.setTimeout(() => {
      setScoreGainOverlays((current) => current.filter((item) => item.id !== id));
      scoreGainOverlayTimeoutsRef.current.delete(id);
    }, 1_950);
    scoreGainOverlayTimeoutsRef.current.set(id, timeoutId);
  }, []);

  const runAdminAction = useCallback(
    async (
      action: AdminActionRequest["action"],
      options?: {
        targetUserId?: string;
        targetUsername?: string;
        targetMessageId?: string;
        targetScore?: number;
        targetRank?: MemberRank;
        killEnabled?: boolean;
      },
    ) => {
      if (!session?.clientId || !session.devAuthToken) {
        setError("Entwicklermodus ist nicht aktiv.");
        return;
      }

      try {
        const payload: AdminActionRequest = {
          clientId: session.clientId,
          devAuthToken: session.devAuthToken,
          action,
          targetUserId: options?.targetUserId,
          targetUsername: options?.targetUsername,
          targetMessageId: options?.targetMessageId,
          targetScore: options?.targetScore,
          targetRank: options?.targetRank,
          killEnabled: options?.killEnabled,
        };

        const result = await apiJson<{ message: string }>("/api/admin", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        setValidationNotice({
          title: "Admin",
          message: result.message,
        });
        setError(null);
        await syncChatState();
        requestAnimationFrame(() => scrollToBottom("auto"));
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Admin-Aktion fehlgeschlagen.");
      }
    },
    [scrollToBottom, session?.clientId, session?.devAuthToken, syncChatState],
  );

  const chatBackgroundStyle = useMemo(() => {
    if (!chatBackgroundUrl) return undefined;
    const escapedUrl = chatBackgroundUrl.replace(/"/g, '\\"');
    return {
      backgroundImage:
        `linear-gradient(rgba(248,250,252,0.15), rgba(248,250,252,0.15)), url("${escapedUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundAttachment: "scroll",
    } as const;
  }, [chatBackgroundUrl]);

  const jumpToNewestStyle = useMemo(() => {
    return {
      bottom: `calc(env(safe-area-inset-bottom) + ${Math.round(composerHeightPx + COMPOSER_BOTTOM_GAP_PX + 8)}px)`,
    };
  }, [composerHeightPx]);

  const scrollContainerStyle = useMemo(() => {
    const dynamicPadding = Math.round(composerHeightPx * 0.78) + LAST_MESSAGE_EXTRA_CLEARANCE_PX + 40;
    return {
      paddingBottom: `${dynamicPadding}px`,
    };
  }, [composerHeightPx]);

  const pushPresenceStatus = useCallback(
    async (status: string): Promise<void> => {
      if (!session || isLeavingRef.current) return;

      const nowIso = new Date().toISOString();
      setUsers((current) => {
        const existing = current.find((user) => user.clientId === session.clientId);
        if (!existing) return current;
        return mergeUser(current, {
          ...existing,
          status,
          isOnline: true,
          lastSeenAt: nowIso,
        });
      });

      await fetch("/api/presence/typing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: session.clientId,
          status,
        }),
      }).catch(() => {
        // Ignore status failures.
      });

      lastSentStatusRef.current = status;
    },
    [session],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!session || loadingOlder || !hasMoreOlder || messages.length === 0) return;
    if (messages.length >= MAX_VISIBLE_MESSAGES) return;
    if (!scrollRef.current) return;

    setLoadingOlder(true);
    captureScrollAnchor();

    try {
      const oldest = messages[0]?.createdAt;
      if (!oldest) return;

      const page = await fetchMessagePage({ before: oldest, limit: MESSAGE_PAGE_SIZE });
      applyIncomingMessages(page.messages, { notify: false });
      setHasMoreOlder(page.hasMore && messages.length < MAX_VISIBLE_MESSAGES);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Ältere Nachrichten konnten nicht geladen werden.");
    } finally {
      setLoadingOlder(false);
    }
  }, [applyIncomingMessages, captureScrollAnchor, fetchMessagePage, hasMoreOlder, loadingOlder, messages, session]);

  useEffect(() => {
    isLeavingRef.current = isLeaving;
  }, [isLeaving]);

  useEffect(() => {
    isWindowFocusedRef.current = isWindowFocused;
  }, [isWindowFocused]);

  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);

  useEffect(() => {
    mediaVisibleCountRef.current = mediaVisibleCount;
  }, [mediaVisibleCount]);

  useEffect(() => {
    setMessageWindowSize((current) => {
      if (messages.length <= MESSAGE_RENDER_WINDOW) {
        return messages.length;
      }
      return Math.min(current, messages.length);
    });
  }, [messages.length]);

  useEffect(() => {
    const element = composerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().height);
      if (!Number.isFinite(next) || next <= 0) return;
      setComposerHeightPx((current) => (current === next ? current : next));
    };

    measure();
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!session) router.replace("/login");
  }, [router, session]);

  useEffect(() => {
    setInitialMessagesLoaded(false);
  }, [session?.clientId]);

  useEffect(() => {
    if (!initialMessagesLoaded) return;

    let cancelled = false;
    const stickToBottomOnce = () => {
      if (cancelled) return;
      userDetachedFromBottomRef.current = false;
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      scrollToBottom("auto");
      requestAnimationFrame(() => scrollToBottom("auto"));
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(stickToBottomOnce);
    });
    const settleTimer = window.setTimeout(stickToBottomOnce, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(settleTimer);
    };
  }, [initialMessagesLoaded, scrollToBottom]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame: number | null = null;
    const updateViewportMetrics = () => {
      const element = scrollRef.current;
      if (!element) return;
      if (!isAtBottomRef.current || userDetachedFromBottomRef.current) return;
      const distanceFromBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
      if (distanceFromBottom > AUTO_SCROLL_NEAR_BOTTOM_PX * 2) return;
      if (distanceFromBottom <= HARD_BOTTOM_ATTACH_PX) {
        userDetachedFromBottomRef.current = false;
        isAtBottomRef.current = true;
        setIsAtBottom(true);
      }
      scheduleBottomStick();
    };

    const scheduleViewportUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateViewportMetrics();
      });
    };

    updateViewportMetrics();
    window.addEventListener("resize", scheduleViewportUpdate);
    window.addEventListener("orientationchange", scheduleViewportUpdate);
    window.visualViewport?.addEventListener("resize", scheduleViewportUpdate);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", scheduleViewportUpdate);
      window.removeEventListener("orientationchange", scheduleViewportUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleViewportUpdate);
    };
  }, [scheduleBottomStick]);

  useEffect(() => {
    return () => {
      if (bottomStickFrameRef.current !== null) {
        window.cancelAnimationFrame(bottomStickFrameRef.current);
        bottomStickFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const idleWindow = window as IdleWindow;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const warmUpOverlays = () => {
      void Promise.allSettled([
        import("@/components/app-overlay-dialog"),
        import("@/components/member-profile-drawer"),
        import("@/components/profile-image-crop-modal"),
      ]);
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleHandle = idleWindow.requestIdleCallback(() => {
        warmUpOverlays();
      }, { timeout: 1_500 });
    } else {
      timeoutHandle = window.setTimeout(() => {
        warmUpOverlays();
      }, 700);
    }

    return () => {
      if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    const applyFocusState = (focused: boolean) => {
      if (isWindowFocusedRef.current === focused) return;

      isWindowFocusedRef.current = focused;
      setIsWindowFocused(focused);
      if (focused) {
        void pushPresenceStatus("");
        return;
      }
      void pushPresenceStatus(formatLastSeenStatus(new Date()));
    };

    applyFocusState(!document.hidden);

    const onFocus = () => applyFocusState(true);
    const onBlur = () => applyFocusState(false);
    const onVisibilityChange = () => applyFocusState(!document.hidden);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pushPresenceStatus, session]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    async function loadInitial(): Promise<void> {
      try {
        const presence = await syncChatState();
        await ensureSessionInPresence(presence);
        hydrateMediaCache();
        if (cancelled) return;
        setError(null);
        setInitialMessagesLoaded(true);
        const onboardingDone = window.localStorage.getItem(ONBOARDING_KEY) === "done";
        setShowOnboarding(!onboardingDone);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Chat konnte nicht geladen werden.");
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [
    ensureSessionInPresence,
    hydrateMediaCache,
    scrollToBottom,
    session,
    syncChatState,
  ]);

  useEffect(() => {
    if (!showMedia) return;

    setMediaVisibleCount(60);
    const hasCache = hydrateMediaCache();
    void fetchMediaItems({ silent: hasCache });
  }, [fetchMediaItems, hydrateMediaCache, showMedia]);

  useEffect(() => {
    if (!showMedia || loadingMedia || loadingMediaMore) return;
    if (!mediaHasMore && !mediaHasHiddenLocalItems) return;
    const container = mediaScrollRef.current;
    if (!container) return;
    let requesting = false;

    const onScroll = () => {
      if (requesting) return;
      const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 80;
      if (!nearBottom) return;
      const hiddenLocalItems = mediaVisibleCountRef.current < mediaItemsRef.current.length;
      if (hiddenLocalItems) {
        setMediaVisibleCount((current) => Math.min(current + 40, mediaItemsRef.current.length));
        return;
      }
      if (!mediaHasMore) return;
      requesting = true;
      void fetchMediaItems({ append: true, silent: true }).finally(() => {
        requesting = false;
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [fetchMediaItems, loadingMedia, loadingMediaMore, mediaHasHiddenLocalItems, mediaHasMore, showMedia]);

  useEffect(() => {
    if (!showMedia || loadingMedia || loadingMediaMore) return;
    if (!mediaHasMore && !mediaHasHiddenLocalItems) return;
    const container = mediaScrollRef.current;
    if (!container) return;

    const canScroll = container.scrollHeight > container.clientHeight + 8;
    if (canScroll) return;
    if (mediaHasHiddenLocalItems) {
      setMediaVisibleCount((current) => Math.min(current + 40, mediaItemsRef.current.length));
      return;
    }

    void fetchMediaItems({ append: true, silent: true });
  }, [fetchMediaItems, loadingMedia, loadingMediaMore, mediaHasHiddenLocalItems, mediaHasMore, mediaItems.length, showMedia]);

  useEffect(() => {
    if (!session?.clientId) {
      setShowTasteProfileModal(false);
      setTasteProfileDetailed(null);
      setTasteProfileEvents([]);
      setTasteEventsCursor(null);
      setTasteEventsHasMore(false);
      setTasteProfileError(null);
    }
  }, [session?.clientId]);

  useEffect(() => {
    tasteModalOpenRef.current = showTasteProfileModal;
  }, [showTasteProfileModal]);

  useEffect(() => {
    if (!showTasteProfileModal || !session?.clientId) return;
    void loadTasteProfileModalData();
  }, [loadTasteProfileModalData, session?.clientId, showTasteProfileModal]);

  useEffect(() => {
    return () => {
      if (tasteModalRefetchTimeoutRef.current !== null) {
        window.clearTimeout(tasteModalRefetchTimeoutRef.current);
        tasteModalRefetchTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const currentScore = ownMember?.score;
    const previousScore = previousOwnMemberScoreRef.current;
    if (typeof currentScore === "number" && typeof previousScore === "number" && currentScore > previousScore) {
      setHighlightOwnMember(true);
      if (memberHighlightResetTimeoutRef.current !== null) {
        window.clearTimeout(memberHighlightResetTimeoutRef.current);
      }
      memberHighlightResetTimeoutRef.current = window.setTimeout(() => {
        setHighlightOwnMember(false);
        memberHighlightResetTimeoutRef.current = null;
      }, 1_650);
    }
    previousOwnMemberScoreRef.current = typeof currentScore === "number" ? currentScore : null;
  }, [ownMember?.score]);

  useEffect(() => {
    const nextScores = new Map<string, number>();
    const gains: Array<{ username: string; delta: number }> = [];

    for (const user of users) {
      const nextScore = user.member?.score;
      if (typeof nextScore !== "number") continue;
      nextScores.set(user.clientId, nextScore);
      if (!memberScoresBootstrappedRef.current) continue;
      const previousScore = knownMemberScoresRef.current.get(user.clientId);
      if (typeof previousScore !== "number" || nextScore <= previousScore) continue;
      gains.push({
        username: user.username,
        delta: nextScore - previousScore,
      });
    }

    if (!memberScoresBootstrappedRef.current) {
      memberScoresBootstrappedRef.current = true;
      knownMemberScoresRef.current = nextScores;
      return;
    }

    knownMemberScoresRef.current = nextScores;
    if (gains.length === 0) return;
    gains
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .forEach((gain) => triggerScoreGainOverlay(gain));
  }, [triggerScoreGainOverlay, users]);

  useEffect(() => {
    const scoreGainTimeouts = scoreGainOverlayTimeoutsRef.current;
    return () => {
      if (memberHighlightResetTimeoutRef.current !== null) {
        window.clearTimeout(memberHighlightResetTimeoutRef.current);
        memberHighlightResetTimeoutRef.current = null;
      }
      if (rankCelebrationResetTimeoutRef.current !== null) {
        window.clearTimeout(rankCelebrationResetTimeoutRef.current);
        rankCelebrationResetTimeoutRef.current = null;
      }
      scoreGainTimeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      scoreGainTimeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    const parseEvent = <TValue,>(event: MessageEvent<string>): TValue | null => {
      try {
        return JSON.parse(event.data) as TValue;
      } catch {
        return null;
      }
    };

    const touchStreamActivity = () => {
      lastStreamActivityAtRef.current = Date.now();
    };

    const closeStream = () => {
      if (!streamRef.current) return;
      streamRef.current.close();
      streamRef.current = null;
    };

    const clearReconnectTimer = () => {
      if (streamReconnectTimeoutRef.current === null) return;
      window.clearTimeout(streamReconnectTimeoutRef.current);
      streamReconnectTimeoutRef.current = null;
    };

    const scheduleReconnect = () => {
      if (cancelled || isLeavingRef.current) return;
      if (streamReconnectTimeoutRef.current !== null) return;
      const attempt = streamReconnectAttemptRef.current;
      const delay = Math.min(
        STREAM_RECONNECT_MAX_MS,
        STREAM_RECONNECT_BASE_MS * (2 ** Math.min(attempt, 4)),
      );
      streamReconnectAttemptRef.current += 1;
      streamReconnectTimeoutRef.current = window.setTimeout(() => {
        streamReconnectTimeoutRef.current = null;
        if (cancelled || isLeavingRef.current) return;
        void syncChatState().catch(() => {
          // Best effort fallback while realtime reconnects.
        });
        openStream();
      }, delay);
    };

    const openStream = () => {
      closeStream();
      const stream = new EventSource(
        `/api/stream?limit=${SNAPSHOT_LIMIT}&clientId=${encodeURIComponent(session.clientId)}`,
      );
      streamRef.current = stream;

      const onSnapshot = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<SnapshotDTO>(event as MessageEvent<string>);
        if (!parsed) return;
        applySnapshot(parsed);
        setError((current) => (current === "Echtzeitverbindung getrennt. Verbinde neu…" ? null : current));
      };

      const onPresenceUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<UserPresenceDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        setUsers((current) => mergeUser(current, parsed));
        syncSessionIdentityFromPresence(parsed);
      };

      const onUserUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<UserPresenceDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        setUsers((current) => mergeUser(current, parsed));
        syncSessionIdentityFromPresence(parsed);
      };

      const onBotUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<UserPresenceDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        setUsers((current) => mergeUser(current, parsed));
      };

      const onBotDeleted = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<{ clientId: string; botId: string }>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        setUsers((current) => current.filter((user) => user.clientId !== parsed.clientId));
      };

      const onMessageCreated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<MessageDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        applyIncomingMessages([parsed], { notify: true });
      };

      const onMessageUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<MessageDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        applyIncomingMessages([parsed], { notify: false, preserveViewerReaction: true });
      };

      const onRankUp = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<{
          userId: string;
          clientId: string;
          username: string;
          previousRank: MemberRank;
          rank: MemberRank;
          score: number;
          createdAt: string;
        }>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        triggerRankCelebration({
          username: parsed.username,
          rankLabel: memberRankLabel(parsed.rank),
        });
      };

      const onReactionReceived = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<{
          targetUserId?: string;
          targetUsername: string;
          fromUsername: string;
          messageId: string;
          reaction: ReactionType;
          messagePreview: string;
          createdAt: string;
        }>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;

        const currentUsername = session.username.trim().toLowerCase();
        if (!currentUsername) return;
        if (parsed.targetUserId && session.id && parsed.targetUserId !== session.id) return;
        if (parsed.targetUsername.trim().toLowerCase() !== currentUsername) return;

        const reactionMeta = REACTION_OPTIONS.find((entry) => entry.reaction === parsed.reaction);
        const reactionLabel = reactionMeta ? `${reactionMeta.emoji} ${reactionMeta.label}` : parsed.reaction;
        const message = `${parsed.fromUsername} hat mit ${reactionLabel} reagiert`;

        setValidationNotice({
          title: "Neue Reaktion",
          message,
        });

        if (validationToastResetTimeoutRef.current !== null) {
          window.clearTimeout(validationToastResetTimeoutRef.current);
        }
        validationToastResetTimeoutRef.current = window.setTimeout(() => {
          setValidationNotice(null);
          validationToastResetTimeoutRef.current = null;
        }, 4_000);
      };

      const onTasteUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<{ userId: string; updatedAt: string; reason: "message" | "reaction" | "poll" | "tagging" }>(
          event as MessageEvent<string>,
        );
        if (!parsed || !session.id) return;
        if (parsed.userId !== session.id) return;

        if (!tasteModalOpenRef.current) return;
        if (tasteModalRefetchTimeoutRef.current !== null) {
          window.clearTimeout(tasteModalRefetchTimeoutRef.current);
        }
        tasteModalRefetchTimeoutRef.current = window.setTimeout(() => {
          void loadTasteProfileModalData();
          tasteModalRefetchTimeoutRef.current = null;
        }, 350);
      };

      const onPollUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<MessageDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        applyIncomingMessages([parsed], { notify: false, preserveViewerReaction: true });
      };

      const onAiStatus = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<{ status: string; provider?: "chatgpt" | "grok"; model?: string }>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        const status = parsed.status || "online";
        setAiStatus((current) => {
          const nextProvider = parsed.provider || "chatgpt";
          const model = parsed.model?.trim();
          return {
            ...current,
            [nextProvider]: status,
            ...(nextProvider === "chatgpt" && model ? { chatgptModel: model } : {}),
            ...(nextProvider === "grok" && model ? { grokModel: model } : {}),
            updatedAt: new Date().toISOString(),
          };
        });
      };

      const onBackgroundUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<ChatBackgroundDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        setChatBackgroundUrl(parsed.url);
      };

      const onAppKillUpdated = (event: Event) => {
        touchStreamActivity();
        const parsed = parseEvent<AppKillDTO>(event as MessageEvent<string>);
        if (!parsed || isLeavingRef.current) return;
        setAppKillState(parsed);
      };

      const onPing = () => {
        touchStreamActivity();
      };

      stream.onopen = () => {
        touchStreamActivity();
        streamReconnectAttemptRef.current = 0;
        setError((current) => (current === "Echtzeitverbindung getrennt. Verbinde neu…" ? null : current));
        void syncChatState().catch(() => {
          // Best effort.
        });
      };
      stream.addEventListener("snapshot", onSnapshot);
      stream.addEventListener("presence.updated", onPresenceUpdated);
      stream.addEventListener("user.updated", onUserUpdated);
      stream.addEventListener("bot.updated", onBotUpdated);
      stream.addEventListener("bot.deleted", onBotDeleted);
      stream.addEventListener("message.created", onMessageCreated);
      stream.addEventListener("message.updated", onMessageUpdated);
      stream.addEventListener("rank.up", onRankUp);
      stream.addEventListener("reaction.received", onReactionReceived);
      stream.addEventListener("taste.updated", onTasteUpdated);
      stream.addEventListener("poll.updated", onPollUpdated);
      stream.addEventListener("ai.status", onAiStatus);
      stream.addEventListener("chat.background.updated", onBackgroundUpdated);
      stream.addEventListener("app.kill.updated", onAppKillUpdated);
      stream.addEventListener("ping", onPing);
      stream.onerror = () => {
        if (isLeavingRef.current) return;
        setError((current) => current || "Echtzeitverbindung getrennt. Verbinde neu…");
        closeStream();
        scheduleReconnect();
      };
    };

    touchStreamActivity();
    openStream();

    const watchdogInterval = window.setInterval(() => {
      if (!streamRef.current || isLeavingRef.current) return;
      const inactiveMs = Date.now() - lastStreamActivityAtRef.current;
      if (inactiveMs <= STREAM_STALE_MS) return;
      closeStream();
      setError((current) => current || "Echtzeitverbindung instabil. Verbinde neu…");
      scheduleReconnect();
    }, STREAM_WATCHDOG_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(watchdogInterval);
      clearReconnectTimer();
      if (tasteModalRefetchTimeoutRef.current !== null) {
        window.clearTimeout(tasteModalRefetchTimeoutRef.current);
        tasteModalRefetchTimeoutRef.current = null;
      }
      closeStream();
    };
  }, [
    applyIncomingMessages,
    applySnapshot,
    loadTasteProfileModalData,
    session,
    syncChatState,
    syncSessionIdentityFromPresence,
    triggerRankCelebration,
  ]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    const reconcile = async () => {
      try {
        const presence = await syncChatState();
        await ensureSessionInPresence(presence);
        if (!cancelled) {
          setError((current) => (current === "Echtzeitverbindung getrennt. Verbinde neu…" ? null : current));
        }
      } catch {
        if (!cancelled) setError("Status-Abgleich fehlgeschlagen. Neuer Versuch…");
      }
    };

    void reconcile();
    const interval = window.setInterval(() => {
      void reconcile();
    }, RECONCILE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [ensureSessionInPresence, session, syncChatState]);

  useEffect(() => {
    if (!session) return;

    const pingPresence = async () => {
      if (isLeavingRef.current || !isWindowFocusedRef.current) return;
      await fetch("/api/presence/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: session.clientId }),
      }).catch(() => {
        setError("Präsenz-Heartbeat fehlgeschlagen. Neuer Versuch…");
      });
    };

    void pingPresence();
    const interval = window.setInterval(() => {
      void pingPresence();
    }, PRESENCE_PING_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [session]);

  useEffect(() => {
    if (!session || isLeaving || !isWindowFocused) return;

    const timeout = window.setTimeout(() => {
      if (lastSentStatusRef.current === derivedStatus) return;
      void pushPresenceStatus(derivedStatus);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [derivedStatus, isLeaving, isWindowFocused, pushPresenceStatus, session]);

  useEffect(() => {
    scheduleBottomStick();
  }, [scheduleBottomStick, visibleMessages.length]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    lastKnownScrollHeightRef.current = element.scrollHeight;

    const onLoadCapture = () => {
      lastKnownScrollHeightRef.current = element.scrollHeight;
      if (isAtBottomRef.current && !userDetachedFromBottomRef.current) {
        scheduleBottomStick();
      }
    };

    const observer = new MutationObserver(() => {
      lastKnownScrollHeightRef.current = element.scrollHeight;
      if (isAtBottomRef.current && !userDetachedFromBottomRef.current) {
        scheduleBottomStick();
      }
    });

    element.addEventListener("load", onLoadCapture, true);
    observer.observe(element, { childList: true, subtree: true });

    return () => {
      element.removeEventListener("load", onLoadCapture, true);
      observer.disconnect();
    };
  }, [scheduleBottomStick]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    lastKnownScrollHeightRef.current = element.scrollHeight;
    previousScrollTopRef.current = element.scrollTop;
    lastKnownBottomOffsetRef.current = Math.max(
      0,
      element.scrollHeight - (element.scrollTop + element.clientHeight),
    );

    const onScroll = () => {
      const currentScrollTop = Math.max(0, element.scrollTop);
      const previousScrollTop = previousScrollTopRef.current;
      const previousBottomOffset = lastKnownBottomOffsetRef.current;
      previousScrollTopRef.current = currentScrollTop;
      lastKnownScrollHeightRef.current = element.scrollHeight;

      const distanceFromBottom = element.scrollHeight - (currentScrollTop + element.clientHeight);
      lastKnownBottomOffsetRef.current = Math.max(0, distanceFromBottom);
      const movingUp = currentScrollTop < previousScrollTop;
      if (distanceFromBottom <= HARD_BOTTOM_ATTACH_PX) {
        userDetachedFromBottomRef.current = false;
      } else if (
        movingUp
        && distanceFromBottom > AUTO_SCROLL_NEAR_BOTTOM_PX
        && distanceFromBottom > previousBottomOffset + MANUAL_DETACH_DELTA_PX
      ) {
        userDetachedFromBottomRef.current = true;
      } else if (distanceFromBottom <= AUTO_SCROLL_NEAR_BOTTOM_PX) {
        userDetachedFromBottomRef.current = false;
      }

      const atBottom = !userDetachedFromBottomRef.current && distanceFromBottom <= AUTO_SCROLL_NEAR_BOTTOM_PX;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        prependAnchorRef.current = null;
      }
      setIsAtBottom((current) => (current === atBottom ? current : atBottom));

      const reachedTopTrigger = currentScrollTop <= TOP_LOAD_TRIGGER_PX;
      const closeToAbsoluteTop = currentScrollTop <= 4;
      const shouldAttemptTopLoad = reachedTopTrigger && (movingUp || closeToAbsoluteTop);
      const now = Date.now();
      const cooldownElapsed = now >= topLoadCooldownUntilRef.current;
      const canTopLoad = !loadingOlder && !topLoadInFlightRef.current;

      if (shouldAttemptTopLoad && cooldownElapsed && canTopLoad) {
        topLoadCooldownUntilRef.current = now + TOP_LOAD_COOLDOWN_MS;
        if (messageWindowSize < messages.length) {
          captureScrollAnchor();
          setMessageWindowSize((current) => Math.min(messages.length, current + MESSAGE_RENDER_CHUNK));
          return;
        }

        if (hasMoreOlder) {
          topLoadInFlightRef.current = true;
          void loadOlderMessages().finally(() => {
            topLoadInFlightRef.current = false;
          });
        }
      }
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      element.removeEventListener("scroll", onScroll);
    };
  }, [captureScrollAnchor, hasMoreOlder, loadOlderMessages, loadingOlder, messageWindowSize, messages.length]);

  useEffect(() => {
    const anchor = prependAnchorRef.current;
    const element = scrollRef.current;
    if (!anchor || !element) return;

    const delta = element.scrollHeight - anchor.height;
    if (isAtBottomRef.current && !userDetachedFromBottomRef.current) {
      prependAnchorRef.current = null;
      return;
    }
    if (delta <= 0) {
      prependAnchorRef.current = null;
      return;
    }
    element.scrollTop = anchor.top + delta;
    prependAnchorRef.current = null;
  }, [messages.length, messageWindowSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setComposerMode("message");
        messageInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setShowMedia(false);
        setLightbox(null);
        setMobileSidebarOpen(false);
        if (!profileEditorCloseBlocked) {
          setEditingProfile(false);
          setEditingBots(false);
        }
        setMemberDrawerOpen(false);
        setShowBackgroundModal(false);
        setShowPointsInfo(false);
      }
      if (
        event.key === "?" &&
        !["input", "textarea"].includes((event.target as HTMLElement)?.tagName?.toLowerCase())
      ) {
        event.preventDefault();
        setShowMedia((value) => !value);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [profileEditorCloseBlocked]);

  const updateUser = useCallback(
    async (payload: Omit<RenameUserRequest, "clientId">) => {
      if (!session) return;
      const user = await apiJson<UserPresenceDTO>("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ clientId: session.clientId, ...payload } satisfies RenameUserRequest),
      });

      setUsers((current) => mergeUser(current, user));

      const nextSession = {
        ...session,
        username: user.username,
        profilePicture: user.profilePicture,
      };
      setSession(nextSession);
      saveSession(nextSession);
    },
    [session],
  );

  const updateOwnAccount = useCallback(
    async (payload: Omit<UpdateOwnAccountRequest, "clientId">) => {
      if (!session) return;
      const updatedSession = await apiJson<AuthSessionDTO>("/api/users/me/account", {
        method: "PATCH",
        body: JSON.stringify({ clientId: session.clientId, ...payload } satisfies UpdateOwnAccountRequest),
      });

      setUsers((current) => mergeUser(current, updatedSession));
      const nextSession = toSessionState(updatedSession);
      setSession(nextSession);
      saveSession(nextSession);
    },
    [session],
  );

  const sendMessage = useCallback(async (payload: CreateMessageRequest) => {
    return apiJson<MessageDTO>("/api/messages", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }, []);

  const sendReaction = useCallback(async (payload: ReactMessageRequest) => {
    return apiJson<MessageDTO>("/api/messages/react", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }, []);

  const kickOffAiWorker = useCallback(() => {
    void fetch("/api/ai/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxJobs: 2 }),
      cache: "no-store",
      keepalive: true,
    }).catch(() => {
      // AI worker trigger is best-effort.
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    kickOffAiWorker();
  }, [kickOffAiWorker, session]);

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => {
      kickOffAiWorker();
    }, AI_WORKER_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [kickOffAiWorker, session]);

  const updatePollOptionValue = useCallback((index: number, value: string) => {
    setPollOptions((current) => {
      const lockedCount = pollExtendDraft?.existingOptions.length ?? 0;
      if (index < lockedCount) {
        return current;
      }

      const next = current.map((option, optionIndex) => (optionIndex === index ? value : option));
      const allFieldsFilled = next.length > 0 && next.every((option) => option.trim().length > 0);

      if (allFieldsFilled && next.length < 15) {
        return [...next, ""];
      }

      return next;
    });
  }, [pollExtendDraft?.existingOptions.length]);

  const submitComposer = useCallback(async () => {
    if (!session) return;

    let tempMessageId: string | null = null;
    try {
      if (composerMode === "message") {
        const content = messageDraft.trim();
        const uploadedImageMarkdown = uploadedDraftImages
          .map((image) => `![${image.label}](${image.url})`)
          .join("\n");
        const combinedMessage = [content, uploadedImageMarkdown].filter(Boolean).join("\n\n");
        if (!combinedMessage) return;

        tempMessageId = createTempMessageId();
        appendOptimisticMessage({
          id: tempMessageId,
          authorId: session.id,
          type: "message",
          message: combinedMessage,
          username: session.username,
          profilePicture: sessionProfilePicture,
          createdAt: new Date().toISOString(),
          questionId: replyTarget?.id,
          oldusername: replyTarget?.username,
          oldmessage: replyTarget?.message,
        });
        startPendingDelivery(tempMessageId);

        setMessageDraft("");
        setComposerHistoryIndex(-1);
        draftBeforeHistoryRef.current = "";
        setUploadedDraftImages([]);

        const created = await sendMessage({
          clientId: session.clientId,
          type: "message",
          message: combinedMessage,
          questionId: replyTarget?.id,
        });
        clearPendingDelivery(tempMessageId);
        removeOptimisticMessage(tempMessageId);
        applyIncomingMessages([created], { notify: false });
        setReplyTarget(null);
      } else if (composerMode === "question") {
        const content = questionDraft.trim();
        if (!content) return;

        tempMessageId = createTempMessageId();
        appendOptimisticMessage({
          id: tempMessageId,
          authorId: session.id,
          type: "question",
          message: content,
          username: session.username,
          profilePicture: sessionProfilePicture,
          createdAt: new Date().toISOString(),
        });
        startPendingDelivery(tempMessageId);
        setQuestionDraft("");

        const created = await sendMessage({ clientId: session.clientId, type: "question", message: content });
        clearPendingDelivery(tempMessageId);
        removeOptimisticMessage(tempMessageId);
        applyIncomingMessages([created], { notify: false });
      } else if (composerMode === "poll") {
        const question = pollQuestion.trim();
        const options = pollOptions.map((option) => option.trim()).filter(Boolean);
        if (!question) {
          setError("Eine Umfragefrage ist erforderlich.");
          return;
        }
        if (options.length < 2) {
          setError("Mindestens zwei Umfrageoptionen sind erforderlich.");
          return;
        }
        if (options.length > 15) {
          setError("Umfragen unterstützen bis zu 15 Optionen.");
          return;
        }

        if (pollExtendDraft) {
          const normalizedExisting = pollExtendDraft.existingOptions.map((option) => option.trim()).filter(Boolean);
          const existingOptionSet = new Set(normalizedExisting.map((option) => option.toLowerCase()));
          const optionSet = new Set(options.map((option) => option.toLowerCase()));

          const missingExistingOption = normalizedExisting.some(
            (existingOption) => !optionSet.has(existingOption.toLowerCase()),
          );
          if (missingExistingOption) {
            setError("Bestehende Umfrageoptionen können beim Erweitern nicht entfernt werden.");
            return;
          }

          const newOptions = options.filter((option) => !existingOptionSet.has(option.toLowerCase()));
          if (newOptions.length === 0) {
            setError("Füge mindestens eine neue Umfrageoption hinzu.");
            return;
          }

          const updated = await apiJson<MessageDTO>("/api/polls/extend", {
            method: "POST",
            body: JSON.stringify({
              clientId: session.clientId,
              pollMessageId: pollExtendDraft.pollMessageId,
              pollOptions: newOptions,
            } satisfies ExtendPollRequest),
          });
          applyIncomingMessages([updated], { notify: false });
          setPollExtendDraft(null);
          setPollQuestion("");
          setPollOptions(["", ""]);
          setPollMultiSelect(false);
        } else {
          tempMessageId = createTempMessageId();
          appendOptimisticMessage({
            id: tempMessageId,
            authorId: session.id,
            type: "votingPoll",
            message: question,
            username: session.username,
            profilePicture: sessionProfilePicture,
            createdAt: new Date().toISOString(),
            questionId: replyTarget?.id,
            oldusername: replyTarget?.username,
            oldmessage: replyTarget?.message,
            poll: {
              options: options.map((option, index) => ({
                id: `${tempMessageId}-opt-${index}`,
                label: option,
                votes: 0,
                voters: [],
              })),
              settings: {
                multiSelect: pollMultiSelect,
                allowVoteChange: true,
              },
            },
            resultone: "0",
            resulttwo: "0",
          });
          startPendingDelivery(tempMessageId);

          const created = await sendMessage({
            clientId: session.clientId,
            type: "votingPoll",
            message: question,
            pollOptions: options,
            pollMultiSelect,
            questionId: replyTarget?.id,
          });
          clearPendingDelivery(tempMessageId);
          removeOptimisticMessage(tempMessageId);
          applyIncomingMessages([created], { notify: false });

          setPollQuestion("");
          setPollOptions(["", ""]);
          setPollMultiSelect(false);
          setReplyTarget(null);
        }
      }

      kickOffAiWorker();
      setError(null);
    } catch (submitError) {
      if (tempMessageId) {
        clearPendingDelivery(tempMessageId);
        removeOptimisticMessage(tempMessageId);
      }
      setError(submitError instanceof Error ? submitError.message : "Nachricht konnte nicht gesendet werden.");
    }
  }, [
    appendOptimisticMessage,
    applyIncomingMessages,
    clearPendingDelivery,
    composerMode,
    createTempMessageId,
    messageDraft,
    pollMultiSelect,
    pollExtendDraft,
    pollOptions,
    pollQuestion,
    questionDraft,
    removeOptimisticMessage,
    replyTarget,
    kickOffAiWorker,
    sendMessage,
    session,
    sessionProfilePicture,
    startPendingDelivery,
    uploadedDraftImages,
  ]);

  const submitAnswer = useCallback(
    async (questionMessageId: string) => {
      if (!session) return;
      const draft = answerDrafts[questionMessageId]?.trim() || "";
      if (!draft) return;

      const tempMessageId = createTempMessageId();
      const questionContext = messages.find((message) => message.id === questionMessageId);
      appendOptimisticMessage({
        id: tempMessageId,
        authorId: session.id,
        type: "answer",
        message: draft,
        username: session.username,
        profilePicture: sessionProfilePicture,
        createdAt: new Date().toISOString(),
        questionId: questionMessageId,
        oldusername: questionContext?.username,
        oldmessage: questionContext?.message,
      });
      startPendingDelivery(tempMessageId);
      setAnswerDrafts((current) => ({ ...current, [questionMessageId]: "" }));

      try {
        const created = await sendMessage({
          clientId: session.clientId,
          type: "answer",
          message: draft,
          questionId: questionMessageId,
        });
        clearPendingDelivery(tempMessageId);
        removeOptimisticMessage(tempMessageId);
        applyIncomingMessages([created], { notify: false });
      } catch (submitError) {
        clearPendingDelivery(tempMessageId);
        removeOptimisticMessage(tempMessageId);
        setAnswerDrafts((current) => ({ ...current, [questionMessageId]: draft }));
        setError(submitError instanceof Error ? submitError.message : "Antwort konnte nicht gesendet werden.");
      }
    },
    [
      answerDrafts,
      appendOptimisticMessage,
      applyIncomingMessages,
      clearPendingDelivery,
      createTempMessageId,
      messages,
      removeOptimisticMessage,
      sendMessage,
      session,
      sessionProfilePicture,
      startPendingDelivery,
    ],
  );

  const handleVote = useCallback(
    async (pollMessageId: string, optionIds: string[]) => {
      if (!session) return;
      optimisticVoteRollbackRef.current = null;
      setMessages((current) => {
        const optimistic = applyOptimisticPollVote(current, {
          pollMessageId,
          optionIds,
          voter: {
            id: session.clientId,
            username: session.username,
            profilePicture: sessionProfilePicture,
          },
        });
        if (optimistic !== current) {
          optimisticVoteRollbackRef.current = current;
        }
        return limitVisibleMessages(optimistic);
      });

      try {
        const payload: VotePollRequest = {
          clientId: session.clientId,
          pollMessageId,
          optionIds,
        };
        const updated = await apiJson<MessageDTO>("/api/polls/vote", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        optimisticVoteRollbackRef.current = null;
        applyIncomingMessages([updated], { notify: false });
      } catch (voteError) {
        const rollback = optimisticVoteRollbackRef.current;
        if (rollback) {
          setMessages(limitVisibleMessages(rollback));
        }
        optimisticVoteRollbackRef.current = null;
        setError(voteError instanceof Error ? voteError.message : "Stimme konnte nicht gespeichert werden.");
      }
    },
    [applyIncomingMessages, session, sessionProfilePicture],
  );

  const handleReact = useCallback(
    async (messageId: string, reaction: ReactionType) => {
      if (!session) return;
      optimisticReactionRollbackRef.current = null;

      setMessages((current) => {
        const optimistic = applyOptimisticReaction(current, { messageId, reaction });
        if (optimistic !== current) {
          optimisticReactionRollbackRef.current = current;
        }
        return limitVisibleMessages(optimistic);
      });

      try {
        const payload: ReactMessageRequest = {
          clientId: session.clientId,
          messageId,
          reaction,
        };
        const updated = await sendReaction(payload);
        optimisticReactionRollbackRef.current = null;
        setMessages((current) => limitVisibleMessages(mergeMessage(current, updated)));
      } catch (reactionError) {
        const rollback = optimisticReactionRollbackRef.current;
        if (rollback) {
          setMessages(limitVisibleMessages(rollback));
        }
        optimisticReactionRollbackRef.current = null;
        setError(reactionError instanceof Error ? reactionError.message : "Reaktion konnte nicht gespeichert werden.");
      }
    },
    [sendReaction, session],
  );

  const handleExtendPoll = useCallback(
    async (message: MessageDTO) => {
      if (message.type !== "votingPoll") return;

      const existingOptions = message.poll?.options.map((option) => option.label.trim()).filter(Boolean) ?? [];
      if (existingOptions.length < 2) {
        setError("Diese Umfrage kann nicht erweitert werden.");
        return;
      }

      const prefilledOptions = [...existingOptions];
      if (prefilledOptions.length < 15) {
        prefilledOptions.push("");
      }

      setComposerMode("poll");
      setPollExtendDraft({
        pollMessageId: message.id,
        existingOptions,
      });
      setPollQuestion(message.message);
      setPollOptions(prefilledOptions);
      setPollMultiSelect(Boolean(message.poll?.settings.multiSelect));
      setError(null);
    },
    [],
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!isDeveloperMode) return;
      if (!window.confirm("Diese Nachricht löschen?")) return;
      await runAdminAction("delete_message", { targetMessageId: messageId });
    },
    [isDeveloperMode, runAdminAction],
  );

  const handleAnswerDraftChange = useCallback((messageId: string, value: string) => {
    setAnswerDrafts((current) => ({ ...current, [messageId]: value }));
  }, []);

  const handleStartReply = useCallback((message: MessageDTO) => {
    setReplyTarget({
      id: message.id,
      username: message.username,
      message: message.message,
    });

    const aiProviderTag = aiTagForReplyMessage(message);
    const botMentionHandle = message.bot?.mentionHandle;
    if (aiProviderTag) {
      setMessageDraft((current) => ensureLeadingAiReplyTag(current, aiProviderTag));
    } else if (botMentionHandle) {
      setMessageDraft((current) => ensureLeadingMentionTag(current, botMentionHandle));
    }

    setComposerMode("message");
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }, []);

  const handleOpenLightbox = useCallback((url: string, alt?: string) => {
    window.requestAnimationFrame(() => {
      setLightboxControlsVisible(true);
      setLightbox({ url, alt: alt || "Bildvorschau" });
    });
  }, []);

  const revealLightboxControls = useCallback(() => {
    setLightboxControlsVisible(true);
  }, []);

  const hideLightboxControls = useCallback(() => {
    setLightboxControlsVisible(false);
  }, []);

  const toggleLightboxControls = useCallback(() => {
    setLightboxControlsVisible((current) => !current);
  }, []);

  const handleRemixImage = useCallback(
    (url: string, alt?: string) => {
      setComposerMode("message");
      setShowMentionSuggestions(false);
      setMentionFilter("");
      setMentionIndex(0);
      setUploadedDraftImages((current) => {
        if (current.some((item) => item.url === url)) {
          return current;
        }
        return [
          ...current,
          {
            id: `remix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            url,
            label: (alt && alt.trim()) || "Remix-Bild",
          },
        ];
      });
      setMessageDraft((current) => {
        if (hasChatGptMention(current)) {
          return current.trim() ? current : "@chatgpt remixe dieses Bild: ";
        }
        if (!current.trim()) {
          return "@chatgpt remixe dieses Bild: ";
        }
        return `@chatgpt ${current}`;
      });

      requestAnimationFrame(() => {
        const textarea = messageInputRef.current;
        if (!textarea) return;
        textarea.focus();
        const cursor = textarea.value.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    },
    [],
  );

  const downloadLightboxImage = useCallback(() => {
    if (!lightbox) return;

    const anchor = document.createElement("a");
    anchor.href = lightbox.url;
    anchor.download = buildDownloadFileName(lightbox.alt);
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, [lightbox]);

  const shareLightboxImage = useCallback(async () => {
    if (!lightbox) return;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        const response = await fetch(lightbox.url);
        const imageBlob = await response.blob();
        const imageFile = new File([imageBlob], buildDownloadFileName(lightbox.alt), {
          type: imageBlob.type || "image/png",
        });

        if (typeof navigator.canShare === "function" && navigator.canShare({ files: [imageFile] })) {
          await navigator.share({
            files: [imageFile],
          });
          return;
        }

        if (!lightbox.url.startsWith("data:")) {
          await navigator.share({ url: lightbox.url });
          return;
        }
      } catch (shareError) {
        if (isAbortError(shareError)) return;
        // Fall through to clipboard fallback.
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(lightbox.url).catch(() => {
        // Ignore clipboard failures.
      });
    }
  }, [lightbox]);

  const showLightboxCopyFeedback = useCallback((state: Exclude<LightboxCopyState, "idle">) => {
    setLightboxCopyState(state);
    if (lightboxCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(lightboxCopyResetTimeoutRef.current);
    }
    lightboxCopyResetTimeoutRef.current = window.setTimeout(() => {
      setLightboxCopyState("idle");
      lightboxCopyResetTimeoutRef.current = null;
    }, 3_000);
  }, []);

  const copyLightboxImage = useCallback(async () => {
    if (!lightbox) return;
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      showLightboxCopyFeedback("error");
      return;
    }

    const copyUrlFallback = async (): Promise<boolean> => {
      if (!navigator.clipboard?.writeText) {
        return false;
      }

      try {
        await navigator.clipboard.writeText(lightbox.url);
        return true;
      } catch {
        return false;
      }
    };

    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const response = await fetch(lightbox.url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Bild konnte nicht geladen werden.");
        }

        const originalBlob = await response.blob();
        const blobType = originalBlob.type.startsWith("image/") ? originalBlob.type : "image/png";
        const imageBlob = originalBlob.type === blobType
          ? originalBlob
          : new Blob([originalBlob], { type: blobType });

        await navigator.clipboard.write([
          new ClipboardItem({
            [blobType]: imageBlob,
          }),
        ]);
        showLightboxCopyFeedback("success");
        return;
      }
    } catch {
      // Fall through to URL fallback.
    }

    const copiedUrl = await copyUrlFallback();
    showLightboxCopyFeedback(copiedUrl ? "link" : "error");
  }, [lightbox, showLightboxCopyFeedback]);

  useEffect(() => {
    return () => {
      if (lightboxCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(lightboxCopyResetTimeoutRef.current);
        lightboxCopyResetTimeoutRef.current = null;
      }
      if (validationToastResetTimeoutRef.current !== null) {
        window.clearTimeout(validationToastResetTimeoutRef.current);
        validationToastResetTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const hoverMediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const syncLightboxHoverSupport = () => {
      setLightboxSupportsHover(hoverMediaQuery.matches);
    };
    syncLightboxHoverSupport();

    if (typeof hoverMediaQuery.addEventListener === "function") {
      hoverMediaQuery.addEventListener("change", syncLightboxHoverSupport);
      return () => {
        hoverMediaQuery.removeEventListener("change", syncLightboxHoverSupport);
      };
    }

    hoverMediaQuery.addListener(syncLightboxHoverSupport);
    return () => {
      hoverMediaQuery.removeListener(syncLightboxHoverSupport);
    };
  }, []);

  useEffect(() => {
    setLightboxCopyState("idle");
    setLightboxControlsVisible(true);
    if (lightboxCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(lightboxCopyResetTimeoutRef.current);
      lightboxCopyResetTimeoutRef.current = null;
    }
  }, [lightbox?.url]);

  async function saveProfile() {
    const username = usernameDraft.trim();
    const profilePicture = profilePictureDraft.trim() || getDefaultProfilePicture();
    if (username.length < 3) {
      setError("Der Benutzername muss mindestens 3 Zeichen lang sein.");
      return;
    }
    setSavingProfile(true);
    try {
      await updateUser({ newUsername: username, profilePicture });
      setProfilePictureDraft(profilePicture);
      setError(null);
      setValidationNotice({
        title: "Profil gespeichert",
        message: "Anzeigename und Profilbild wurden aktualisiert.",
      });
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Profil konnte nicht gespeichert werden.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveSecurity(): Promise<void> {
    if (!session) return;

    const currentPassword = currentPasswordDraft.trim();
    const nextLoginName = loginNameDraft.trim().toLowerCase();
    const currentLoginName = (session.loginName || "").trim().toLowerCase();
    const loginNameChanged = nextLoginName !== currentLoginName;
    const nextPassword = newPasswordDraft.trim();
    const confirmPassword = confirmNewPasswordDraft.trim();

    if (!loginNameChanged && !nextPassword) {
      setError("Keine Sicherheitsänderung erkannt.");
      return;
    }
    if (loginNameChanged && !LOGIN_NAME_PATTERN.test(nextLoginName)) {
      setError("Der Login-Name muss 3-32 Zeichen haben (a-z, 0-9, ., _, -).");
      return;
    }
    if (!currentPassword) {
      setError("Bitte aktuelles Passwort eingeben.");
      return;
    }
    if (currentPassword.length < 8) {
      setError("Das aktuelle Passwort muss mindestens 8 Zeichen haben.");
      return;
    }
    if (!nextPassword && confirmPassword) {
      setError("Bitte neues Passwort eingeben.");
      return;
    }
    if (nextPassword && nextPassword.length < 8) {
      setError("Das neue Passwort muss mindestens 8 Zeichen haben.");
      return;
    }
    if (nextPassword && confirmPassword !== nextPassword) {
      setError("Die neuen Passwörter stimmen nicht überein.");
      return;
    }

    setSavingSecurity(true);
    try {
      await updateOwnAccount({
        currentPassword,
        ...(loginNameChanged ? { newLoginName: nextLoginName } : {}),
        ...(nextPassword ? { newPassword: nextPassword } : {}),
      });
      setLoginNameDraft(nextLoginName);
      setCurrentPasswordDraft("");
      setNewPasswordDraft("");
      setConfirmNewPasswordDraft("");
      setError(null);
      setValidationNotice({
        title: "Sicherheit gespeichert",
        message: "Login-Name/Passwort wurden aktualisiert.",
      });
    } catch (securityError) {
      setError(securityError instanceof Error ? securityError.message : "Sicherheitseinstellungen konnten nicht gespeichert werden.");
    } finally {
      setSavingSecurity(false);
    }
  }

  async function refreshManagedBots(): Promise<void> {
    if (!session?.clientId) return;
    setLoadingBots(true);
    try {
      const result = await fetchManagedBots();
      setManagedBots(result.items);
      setBotSlots({
        limit: result.limit,
        used: result.used,
        remaining: result.remaining,
      });
    } catch (botError) {
      setError(botError instanceof Error ? botError.message : "Bots konnten nicht geladen werden.");
    } finally {
      setLoadingBots(false);
    }
  }

  function resetBotEditor(): void {
    setEditingBotId(null);
    setBotNameDraft("");
    setBotProfilePictureDraft(getDefaultProfilePicture());
    setBotHandleDraft("");
    setBotLanguagePreferenceDraft("all");
    setBotInstructionsDraft("");
    setBotCatchphrasesDraft("");
    setBotAutonomousEnabledDraft(false);
    setBotAutonomousMinMinutesDraft("60");
    setBotAutonomousMaxMinutesDraft("240");
    setBotAutonomousPromptDraft("");
    setBotAutomationExpanded(false);
    setBotProfileDropActive(false);
    setBotComposerOpen(false);
  }

  function openNewBotComposer(): void {
    setEditingBotId(null);
    setBotNameDraft("");
    setBotProfilePictureDraft(getDefaultProfilePicture());
    setBotHandleDraft("");
    setBotLanguagePreferenceDraft("all");
    setBotInstructionsDraft("");
    setBotCatchphrasesDraft("");
    setBotAutonomousEnabledDraft(false);
    setBotAutonomousMinMinutesDraft("60");
    setBotAutonomousMaxMinutesDraft("240");
    setBotAutonomousPromptDraft("");
    setBotAutomationExpanded(false);
    setBotProfileDropActive(false);
    setBotComposerOpen(true);
  }

  async function saveBot(): Promise<void> {
    if (!session?.clientId) return;
    const displayName = botNameDraft.trim();
    const profilePicture = botProfilePictureDraft.trim() || getDefaultProfilePicture();
    const mentionHandle = botHandleDraft.trim().replace(/^@+/, "");
    const instructions = botInstructionsDraft.trim();
    const catchphrases = botCatchphrasesDraft
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const autonomousMinIntervalMinutes = botAutonomousMinValid ? parsedBotAutonomousMinMinutes : 60;
    const autonomousMaxIntervalMinutes = botAutonomousMaxValid
      ? Math.max(autonomousMinIntervalMinutes, parsedBotAutonomousMaxMinutes)
      : Math.max(autonomousMinIntervalMinutes, 240);

    if (!displayName || !mentionHandle || !instructions) {
      setError("Bitte Name, Handle und Anweisungen für den Bot ausfüllen.");
      return;
    }

    setSavingBot(true);
    try {
      if (editingBotId) {
        await apiJson<ManagedBotDTO>(`/api/bots/${encodeURIComponent(editingBotId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            clientId: session.clientId,
            displayName,
            profilePicture,
            mentionHandle,
            languagePreference: botLanguagePreferenceDraft,
            instructions,
            catchphrases,
            autonomousEnabled: botAutonomousEnabledDraft,
            autonomousMinIntervalMinutes,
            autonomousMaxIntervalMinutes,
            autonomousPrompt: botAutonomousPromptDraft.trim(),
          }),
        });
      } else {
        await apiJson<ManagedBotDTO>("/api/bots", {
          method: "POST",
          body: JSON.stringify({
            clientId: session.clientId,
            displayName,
            profilePicture,
            mentionHandle,
            languagePreference: botLanguagePreferenceDraft,
            instructions,
            catchphrases,
            autonomousEnabled: botAutonomousEnabledDraft,
            autonomousMinIntervalMinutes,
            autonomousMaxIntervalMinutes,
            autonomousPrompt: botAutonomousPromptDraft.trim(),
          }),
        });
      }

      await refreshManagedBots();
      resetBotEditor();
      setEditingBots(true);
      setError(null);
    } catch (botError) {
      setError(botError instanceof Error ? botError.message : "Bot konnte nicht gespeichert werden.");
    } finally {
      setSavingBot(false);
    }
  }

  function startEditBot(bot: ManagedBotDTO): void {
    setEditingBotId(bot.id);
    setBotNameDraft(bot.displayName);
    setBotProfilePictureDraft(bot.profilePicture || getDefaultProfilePicture());
    setBotHandleDraft(bot.mentionHandle);
    setBotLanguagePreferenceDraft(bot.languagePreference);
    setBotInstructionsDraft(bot.instructions);
    setBotCatchphrasesDraft(bot.catchphrases.join("\n"));
    setBotAutonomousEnabledDraft(Boolean(bot.autonomousEnabled));
    setBotAutonomousMinMinutesDraft(String(bot.autonomousMinIntervalMinutes ?? 60));
    setBotAutonomousMaxMinutesDraft(String(bot.autonomousMaxIntervalMinutes ?? 240));
    setBotAutonomousPromptDraft(bot.autonomousPrompt || "");
    setBotAutomationExpanded(Boolean(bot.autonomousEnabled || bot.autonomousPrompt));
    setBotProfileDropActive(false);
    setBotComposerOpen(true);
  }

  async function removeBot(botId: string): Promise<void> {
    if (!session?.clientId) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Diesen Bot wirklich löschen?");
      if (!confirmed) return;
    }
    setDeletingBotId(botId);
    try {
      await apiJson<{ ok: true }>(`/api/bots/${encodeURIComponent(botId)}`, {
        method: "DELETE",
        body: JSON.stringify({
          clientId: session.clientId,
        }),
      });
      if (editingBotId === botId) {
        resetBotEditor();
      }
      await refreshManagedBots();
      setError(null);
    } catch (botError) {
      setError(botError instanceof Error ? botError.message : "Bot konnte nicht gelöscht werden.");
    } finally {
      setDeletingBotId(null);
    }
  }

  function clearProfileCropState(): void {
    setProfileCropFile(null);
    setProfileCropTarget(null);
  }

  async function onBotProfileImageUpload(file: File | undefined) {
    if (!file) return;
    if (!SUPPORTED_PROFILE_UPLOAD_MIME_TYPES.has(file.type)) {
      setError("Nur jpg, png, webp oder gif werden unterstützt.");
      return;
    }
    setError(null);
    setProfileCropTarget("bot");
    setProfileCropFile(file);
    if (botProfileUploadRef.current) botProfileUploadRef.current.value = "";
  }

  async function onProfileImageUpload(file: File | undefined) {
    if (!file) return;
    if (!SUPPORTED_PROFILE_UPLOAD_MIME_TYPES.has(file.type)) {
      setError("Nur jpg, png, webp oder gif werden unterstützt.");
      return;
    }
    setError(null);
    setProfileCropTarget("profile");
    setProfileCropFile(file);
    if (profileUploadRef.current) profileUploadRef.current.value = "";
  }

  function onBotProfileImagePaste(event: ClipboardEvent<HTMLElement>): void {
    const imageFiles = extractSupportedImageFiles(event.clipboardData, SUPPORTED_PROFILE_UPLOAD_MIME_TYPES);
    if (imageFiles.length > 0) {
      event.preventDefault();
      void onBotProfileImageUpload(imageFiles[0]);
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain").trim();
    if (/^(https?:\/\/\S+|\/[^/\s].*)$/i.test(pastedText)) {
      event.preventDefault();
      setBotProfilePictureDraft(pastedText);
    }
  }

  function onProfileImagePaste(event: ClipboardEvent<HTMLElement>): void {
    const imageFiles = extractSupportedImageFiles(event.clipboardData, SUPPORTED_PROFILE_UPLOAD_MIME_TYPES);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void onProfileImageUpload(imageFiles[0]);
  }

  function onProfileImageDragOver(event: DragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setProfileDropActive(true);
  }

  function onProfileImageDragLeave(event: DragEvent<HTMLElement>): void {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setProfileDropActive(false);
  }

  function onProfileImageDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setProfileDropActive(false);

    const imageFiles = extractSupportedImageFiles(event.dataTransfer, SUPPORTED_PROFILE_UPLOAD_MIME_TYPES);
    if (imageFiles.length === 0) {
      setError("Nur jpg, png, webp oder gif werden unterstützt.");
      return;
    }
    void onProfileImageUpload(imageFiles[0]);
  }

  function onBotProfileImageDragOver(event: DragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setBotProfileDropActive(true);
  }

  function onBotProfileImageDragLeave(event: DragEvent<HTMLElement>): void {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setBotProfileDropActive(false);
  }

  function onBotProfileImageDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setBotProfileDropActive(false);

    const imageFiles = extractSupportedImageFiles(event.dataTransfer, SUPPORTED_PROFILE_UPLOAD_MIME_TYPES);
    if (imageFiles.length === 0) {
      setError("Nur jpg, png, webp oder gif werden unterstützt.");
      return;
    }
    void onBotProfileImageUpload(imageFiles[0]);
  }

  async function onProfileCropConfirm(file: File) {
    const cropTarget = profileCropTarget || "profile";
    if (cropTarget === "bot") {
      setUploadingBotProfile(true);
    } else {
      setUploadingProfile(true);
    }
    const uploadController = new AbortController();
    const uploadTimeout = window.setTimeout(() => {
      uploadController.abort();
    }, PROFILE_UPLOAD_TIMEOUT_MS);
    try {
      const url = await uploadProfileImage(file, uploadController.signal);
      if (cropTarget === "bot") {
        setBotProfilePictureDraft(url);
      } else {
        setProfilePictureDraft(url);
      }
      setError(null);
      clearProfileCropState();
    } catch (uploadError) {
      if (uploadController.signal.aborted) {
        setError("Upload dauert zu lange. Bitte Verbindung prüfen und erneut versuchen.");
      } else {
        setError(uploadError instanceof Error ? uploadError.message : "Bild konnte nicht hochgeladen werden.");
      }
    } finally {
      window.clearTimeout(uploadTimeout);
      if (cropTarget === "bot") {
        setUploadingBotProfile(false);
      } else {
        setUploadingProfile(false);
      }
    }
  }

  async function onChatImageUpload(file: File | undefined) {
    if (!file) return;
    setUploadingChat(true);
    try {
      if (!SUPPORTED_CHAT_UPLOAD_MIME_TYPES.has(file.type)) {
        throw new Error("Nur jpg, png, webp oder gif werden unterstützt.");
      }
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/uploads/chat", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await readApiError(response, "Upload fehlgeschlagen"));
      const { url } = (await response.json()) as { url: string };
      setComposerMode("message");
      setUploadedDraftImages((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url,
          label: file.name || "Bild",
        },
      ]);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Bild konnte nicht hochgeladen werden.");
    } finally {
      setUploadingChat(false);
      if (chatUploadRef.current) chatUploadRef.current.value = "";
    }
  }

  async function onChatImageDrop(files: FileList | File[]): Promise<void> {
    const allFiles = Array.from(files);
    if (allFiles.length === 0) return;

    const imageFiles = allFiles.filter((file) => SUPPORTED_CHAT_UPLOAD_MIME_TYPES.has(file.type));
    if (imageFiles.length === 0) {
      setError("Nur jpg, png, webp oder gif werden unterstützt.");
      return;
    }

    setUploadingChat(true);
    try {
      const uploadedItems = await Promise.all(imageFiles.map(async (file) => {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch("/api/uploads/chat", { method: "POST", body: formData });
        if (!response.ok) throw new Error(await readApiError(response, "Upload fehlgeschlagen"));
        const { url } = (await response.json()) as { url: string };
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url,
          label: file.name || "Bild",
        };
      }));

      setComposerMode("message");
      setUploadedDraftImages((current) => [...current, ...uploadedItems]);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Bild konnte nicht hochgeladen werden.");
    } finally {
      setUploadingChat(false);
    }
  }

  function onMessageInputPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const imageFiles = extractSupportedImageFiles(event.clipboardData, SUPPORTED_CHAT_UPLOAD_MIME_TYPES);

    if (imageFiles.length === 0) return;
    void onChatImageDrop(imageFiles);
  }

  function selectMentionUser(mentionValue: string): void {
    const selectionStart = messageInputRef.current?.selectionStart || 0;
    const textBefore = messageDraft.slice(0, selectionStart);
    const textAfter = messageDraft.slice(selectionStart);
    const newTextBefore = textBefore.replace(/@([\w-]*)$/, `@${mentionValue} `);
    setMessageDraft(newTextBefore + textAfter);
    setShowMentionSuggestions(false);
  }

  function onMessageInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (showMentionSuggestions && filteredMentionUsers.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % filteredMentionUsers.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => (index - 1 + filteredMentionUsers.length) % filteredMentionUsers.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const user = filteredMentionUsers[mentionIndex];
        if (!user) return;
        selectMentionUser(user.bot?.mentionHandle || user.username);
        return;
      }
      if (event.key === "Escape") {
        setShowMentionSuggestions(false);
        return;
      }
    }

    if (event.key === "ArrowUp" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (ownMessageHistory.length === 0) return;

      if (composerHistoryIndex === -1) {
        draftBeforeHistoryRef.current = messageDraft;
        const nextIndex = ownMessageHistory.length - 1;
        setComposerHistoryIndex(nextIndex);
        setMessageDraft(ownMessageHistory[nextIndex] || "");
        return;
      }

      const nextIndex = Math.max(0, composerHistoryIndex - 1);
      setComposerHistoryIndex(nextIndex);
      setMessageDraft(ownMessageHistory[nextIndex] || "");
      return;
    }

    if (event.key === "ArrowDown" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      if (composerHistoryIndex === -1) return;
      event.preventDefault();

      if (composerHistoryIndex < ownMessageHistory.length - 1) {
        const nextIndex = composerHistoryIndex + 1;
        setComposerHistoryIndex(nextIndex);
        setMessageDraft(ownMessageHistory[nextIndex] || "");
        return;
      }

      setComposerHistoryIndex(-1);
      setMessageDraft(draftBeforeHistoryRef.current);
      draftBeforeHistoryRef.current = "";
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      window.setTimeout(() => {
        void submitComposer();
      }, 0);
    }
  }

  function onQuestionInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    window.setTimeout(() => {
      void submitComposer();
    }, 0);
  }

  async function saveChatBackground(url: string | null): Promise<void> {
    if (!session) return;

    const response = await apiJson<ChatBackgroundDTO>("/api/chat/background", {
      method: "POST",
      body: JSON.stringify({
        clientId: session.clientId,
        url,
      }),
    });
    setChatBackgroundUrl(response.url);
  }

  async function onBackgroundImageUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    if (!SUPPORTED_CHAT_UPLOAD_MIME_TYPES.has(file.type)) {
      setError("Nur png, jpg, webp oder gif werden unterstützt.");
      return;
    }
    setUploadingBackground(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/uploads/chat", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await readApiError(response, "Upload fehlgeschlagen"));
      const payload = (await response.json()) as UploadResponse;
      setBackgroundDraftUrl(payload.url);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Chat-Hintergrund konnte nicht aktualisiert werden.");
    } finally {
      setUploadingBackground(false);
      if (backgroundUploadRef.current) backgroundUploadRef.current.value = "";
    }
  }

  function onBackgroundModalPaste(event: ClipboardEvent<HTMLDivElement>): void {
    const imageFiles = extractSupportedImageFiles(event.clipboardData, SUPPORTED_CHAT_UPLOAD_MIME_TYPES);
    if (imageFiles.length > 0) {
      event.preventDefault();
      void onBackgroundImageUpload(imageFiles[0]);
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain").trim();
    if (/^https?:\/\/\S+/i.test(pastedText)) {
      event.preventDefault();
      setBackgroundDraftUrl(pastedText);
    }
  }

  async function logout() {
    if (!session) return;

    setIsLeaving(true);

    await fetch("/api/presence/typing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: session.clientId, status: "" }),
      keepalive: true,
    }).catch(() => {});

    await fetch("/api/presence/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: session.clientId }),
      keepalive: true,
    }).catch(() => {});

    await fetch("/api/auth/session", {
      method: "DELETE",
    }).catch(() => {});

    clearSession();
    router.replace("/login");
  }

  function finishOnboarding(): void {
    window.localStorage.setItem(ONBOARDING_KEY, "done");
    setShowOnboarding(false);
  }

  const openProfileEditor = useCallback((): void => {
    if (!session) return;
    setUsernameDraft(session.username);
    setLoginNameDraft(session.loginName || "");
    setProfilePictureDraft(session.profilePicture || getDefaultProfilePicture());
    setCurrentPasswordDraft("");
    setNewPasswordDraft("");
    setConfirmNewPasswordDraft("");
    setEditingBotId(null);
    setBotNameDraft("");
    setBotProfilePictureDraft(getDefaultProfilePicture());
    setBotHandleDraft("");
    setBotInstructionsDraft("");
    setBotCatchphrasesDraft("");
    startUiTransition(() => {
      setMobileSidebarOpen(false);
      setProfileDropActive(false);
      setEditingBots(false);
      setMemberDrawerOpen(false);
      setEditingProfile(true);
    });
    window.setTimeout(() => {
      void loadTasteProfileModalData();
    }, 0);
  }, [loadTasteProfileModalData, session, startUiTransition]);

  const closeProfileEditor = useCallback((): void => {
    if (profileEditorCloseBlocked) return;
    startUiTransition(() => {
      setProfileDropActive(false);
      setEditingProfile(false);
    });

    window.setTimeout(() => {
      setCurrentPasswordDraft("");
      setNewPasswordDraft("");
      setConfirmNewPasswordDraft("");
    }, 0);
  }, [profileEditorCloseBlocked, startUiTransition]);

  const openBotEditor = useCallback((): void => {
    if (!session) return;
    startUiTransition(() => {
      setMobileSidebarOpen(false);
      setProfileDropActive(false);
      setEditingProfile(false);
      setMemberDrawerOpen(false);
      setEditingBots(true);
    });
    window.setTimeout(() => {
      void refreshManagedBots();
    }, 0);
  }, [refreshManagedBots, session, startUiTransition]);

  const closeBotEditor = useCallback((): void => {
    if (profileEditorCloseBlocked) return;
    startUiTransition(() => {
      setEditingBots(false);
    });
  }, [profileEditorCloseBlocked, startUiTransition]);

  const openSharedBackgroundModal = useCallback((): void => {
    startUiTransition(() => {
      setMobileSidebarOpen(false);
      setBackgroundDraftUrl("");
      setShowBackgroundModal(true);
    });
  }, [startUiTransition]);

  const openPointsInfoModal = useCallback((): void => {
    startUiTransition(() => {
      setMobileSidebarOpen(false);
      setShowPointsInfo(true);
    });
  }, [startUiTransition]);

  const openMediaModal = useCallback((): void => {
    startUiTransition(() => {
      setMobileSidebarOpen(false);
      setMediaVisibleCount(60);
      setShowMedia(true);
    });
  }, [startUiTransition]);

  const openDevMenu = useCallback((): void => {
    if (!isDeveloperMode) return;
    setMobileSidebarOpen(false);
    router.push("/dev");
  }, [isDeveloperMode, router]);

  async function saveBackgroundDraft(): Promise<void> {
    setUploadingBackground(true);
    try {
      await saveChatBackground(backgroundDraftUrl.trim() || null);
      setShowBackgroundModal(false);
      setError(null);
    } catch (backgroundError) {
      setError(backgroundError instanceof Error ? backgroundError.message : "Chat-Hintergrund konnte nicht gespeichert werden.");
    } finally {
      setUploadingBackground(false);
    }
  }

  const openMemberProfile = useCallback(async (user: UserPresenceDTO): Promise<void> => {
    const ownCachedProfile = session?.clientId ? publicProfileCacheRef.current[session.clientId] : undefined;
    const fallbackOwnStats = ownWindowStats ? ownProfileStats : null;
    startUiTransition(() => {
      setMobileSidebarOpen(false);
      setMemberDrawerOpen(true);
      setMemberDrawerError(null);
      setMemberDrawerOwnStats(ownCachedProfile?.stats ?? fallbackOwnStats);
    });

    if (AI_CLIENT_IDS.has(user.clientId) || user.bot) {
      setMemberDrawerLoading(false);
      setMemberDrawerProfile(toSyntheticPublicProfile(user));
      return;
    }

    const cached = publicProfileCacheRef.current[user.clientId];
    if (cached) {
      setMemberDrawerLoading(false);
      setMemberDrawerProfile(cached);
      if (session?.clientId === user.clientId) {
        setMemberDrawerOwnStats(cached.stats);
      } else if (!ownCachedProfile && session?.clientId) {
        try {
          const ownProfile = await fetchPublicUserProfile(session.clientId);
          publicProfileCacheRef.current[ownProfile.clientId] = ownProfile;
          setMemberDrawerOwnStats(ownProfile.stats);
        } catch {
          // Keep fallback own stats when own profile cannot be loaded.
        }
      }
      return;
    }

    setMemberDrawerLoading(true);
    setMemberDrawerProfile(null);
    try {
      const ownProfilePromise: Promise<PublicUserProfileDTO | null> = session?.clientId
        ? user.clientId === session.clientId
          ? Promise.resolve(null)
          : ownCachedProfile
            ? Promise.resolve(ownCachedProfile)
            : fetchPublicUserProfile(session.clientId).catch(() => null)
        : Promise.resolve(null);
      const profile = await fetchPublicUserProfile(user.clientId);
      publicProfileCacheRef.current[user.clientId] = profile;
      setMemberDrawerProfile(profile);
      const ownProfile = user.clientId === session?.clientId ? profile : await ownProfilePromise;
      if (ownProfile) {
        publicProfileCacheRef.current[ownProfile.clientId] = ownProfile;
      }
      setMemberDrawerOwnStats(
        ownProfile?.stats ?? (session?.clientId === user.clientId ? profile.stats : fallbackOwnStats),
      );
    } catch (profileError) {
      setMemberDrawerError(profileError instanceof Error ? profileError.message : "Profil konnte nicht geladen werden.");
    } finally {
      setMemberDrawerLoading(false);
    }
  }, [fetchPublicUserProfile, ownProfileStats, ownWindowStats, session?.clientId, startUiTransition]);

  const openMessageAuthorProfile = useCallback((message: MessageDTO): void => {
    if (message.bot) {
      const botUser = onlineUsers.find((user) => user.clientId === message.bot?.clientId);
      if (botUser) {
        void openMemberProfile(botUser);
        return;
      }

      const ownCachedProfile = session?.clientId ? publicProfileCacheRef.current[session.clientId] : undefined;
      const fallbackProfile = toSyntheticPublicProfile({
        id: message.bot.clientId,
        clientId: message.bot.clientId,
        username: message.bot.displayName,
        profilePicture: normalizeProfilePictureUrl(message.profilePicture),
        status: "online",
        isOnline: true,
        lastSeenAt: null,
        mentionHandle: message.bot.mentionHandle,
        member: undefined,
        bot: message.bot,
      });
      startUiTransition(() => {
        setMobileSidebarOpen(false);
        setMemberDrawerOpen(true);
        setMemberDrawerLoading(false);
        setMemberDrawerError(null);
        setMemberDrawerOwnStats(ownCachedProfile?.stats ?? (ownWindowStats ? ownProfileStats : null));
        setMemberDrawerProfile(fallbackProfile);
      });
      return;
    }

    const normalizedAuthor = message.username.trim().toLowerCase();
    const matchedOnlineUserById = message.authorId
      ? users.find((user) => user.id === message.authorId)
      : undefined;
    const matchedOnlineUserByName = users.find((user) => user.username.trim().toLowerCase() === normalizedAuthor);
    const matchedAiUser = AI_ASSISTANT_USERNAMES.has(normalizedAuthor)
      ? onlineUsers.find((user) => user.username.trim().toLowerCase() === normalizedAuthor)
      : undefined;
    const matched = matchedOnlineUserById || matchedOnlineUserByName || matchedAiUser;

    if (matched) {
      void openMemberProfile(matched);
      return;
    }

    const ownCachedProfile = session?.clientId ? publicProfileCacheRef.current[session.clientId] : undefined;
    const fallbackProfile = toSyntheticPublicProfile({
      id: message.authorId || `message-author-${message.id}`,
      clientId: AI_CLIENT_IDS.has(normalizedAuthor) ? normalizedAuthor : `message-author-${message.id}`,
      username: message.username,
      profilePicture: normalizeProfilePictureUrl(message.profilePicture),
      status: "",
      isOnline: false,
      lastSeenAt: null,
      member: message.member,
    });
    startUiTransition(() => {
      setMobileSidebarOpen(false);
      setMemberDrawerOpen(true);
      setMemberDrawerLoading(false);
      setMemberDrawerError(null);
      setMemberDrawerOwnStats(ownCachedProfile?.stats ?? (ownWindowStats ? ownProfileStats : null));
      setMemberDrawerProfile(fallbackProfile);
    });
  }, [onlineUsers, openMemberProfile, ownProfileStats, ownWindowStats, session?.clientId, startUiTransition, users]);

  const closeMobileSidebar = useCallback((): void => {
    setMobileSidebarOpen(false);
  }, []);

  const openMobileSidebar = useCallback((): void => {
    setMobileSidebarOpen(true);
  }, []);

  const handleOpenSidebarMemberProfile = useCallback((user: UserPresenceDTO): void => {
    void openMemberProfile(user);
  }, [openMemberProfile]);

  const handleOpenBotCreator = useCallback((): void => {
    openBotEditor();
  }, [openBotEditor]);

  const sidebarOnlineUsersContent = useMemo(
    () => (
      <OnlineUsersList
        users={sidebarOnlineUsers}
        avatarSizeClassName="h-11 w-11"
        currentUserId={session?.id ?? null}
        currentUsername={session?.username ?? null}
        botSlots={botSlots}
        onOpenBotCreator={handleOpenBotCreator}
        onOpenMemberProfile={handleOpenSidebarMemberProfile}
      />
    ),
    [botSlots, handleOpenBotCreator, handleOpenSidebarMemberProfile, session?.id, session?.username, sidebarOnlineUsers],
  );
  const botManagerSection = (
    <section
      className="space-y-3"
      data-testid="bot-manager-section"
      onPaste={onBotProfileImagePaste}
    >
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900">Meine Bots</h3>
            <p className="mt-1 text-sm text-slate-500">{botSlots.used} von {botSlots.limit} belegt</p>
          </div>
          <button
            type="button"
            onClick={() => openNewBotComposer()}
            disabled={botCreationLimitReached}
            aria-label="Neuen Bot erstellen"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Neuer Bot
          </button>
        </div>
        {botCreationLimitReached ? (
          <p className="mt-3 text-xs text-slate-500">
            Alle Slots belegt. Bearbeite einen Bot oder steig im Rang auf.
          </p>
        ) : null}
      </div>

      {loadingBots ? <p className="text-sm text-slate-500">Bots werden geladen…</p> : null}

      <div className="space-y-2">
        {managedBots.map((bot) => (
          <div
            key={bot.id}
            className="rounded-xl border border-slate-200 bg-white px-3 py-3"
            data-testid={`bot-card-${bot.id}`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-50">
                    <img
                      src={normalizeProfilePictureUrl(bot.profilePicture)}
                      alt={`${bot.displayName} Profilbild`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                      width={40}
                      height={40}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{bot.displayName}</p>
                    <p className="truncate text-xs font-medium text-sky-700">@{bot.mentionHandle}</p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">
                      {(bot.instructions.split("\n")[0] || bot.instructions).trim()}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => startEditBot(bot)}
                  data-testid={`bot-edit-${bot.id}`}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  Bearbeiten
                </button>
                <button
                  type="button"
                  onClick={() => void removeBot(bot.id)}
                  disabled={deletingBotId === bot.id}
                  data-testid={`bot-delete-${bot.id}`}
                  className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:opacity-60"
                >
                  {deletingBotId === bot.id ? "Löscht…" : "Löschen"}
                </button>
              </div>
            </div>
          </div>
        ))}
        {managedBots.length === 0 && !loadingBots ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
            Noch kein Bot erstellt.
          </p>
        ) : null}
      </div>

      {botComposerOpen ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Editor</p>
              <h4 className="mt-1 text-base font-semibold text-slate-900">{botComposerTitle}</h4>
            </div>
            <button
              type="button"
              onClick={() => resetBotEditor()}
              data-testid="bot-reset-button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              Schließen
            </button>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-white">
              <img
                src={botPreviewProfilePicture}
                alt="Bot Profilbild Vorschau"
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                width={44}
                height={44}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{botDisplayNameValue || "Dein Bot"}</p>
              <p className="truncate text-xs font-medium text-sky-700">@{botHandlePreview || "handle"}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="bot-display-name">
              Name
            </label>
            <input
              id="bot-display-name"
              name="bot-display-name"
              data-testid="bot-name-input"
              value={botNameDraft}
              onChange={(event) => setBotNameDraft(event.target.value)}
              placeholder="z. B. Peter Griffin"
              maxLength={40}
              autoComplete="off"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="bot-handle">
              Handle
            </label>
            <div className="mt-1.5 flex items-center rounded-xl border border-slate-200 bg-white px-3">
              <span className="text-sm font-semibold text-sky-700">@</span>
              <input
                id="bot-handle"
                name="bot-handle"
                data-testid="bot-handle-input"
                value={botHandleDraft}
                onChange={(event) => setBotHandleDraft(event.target.value.replace(/^@+/, "").replace(/\s+/g, "-"))}
                placeholder="peter-griffin"
                maxLength={24}
                autoComplete="off"
                spellCheck={false}
                className="h-11 w-full bg-transparent px-2 text-sm text-slate-900 focus-visible:outline-none"
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">So wird der Bot im Chat getriggert.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="bot-language-preference">
              Sprache
            </label>
            <select
              id="bot-language-preference"
              name="bot-language-preference"
              data-testid="bot-language-input"
              value={botLanguagePreferenceDraft}
              onChange={(event) => setBotLanguagePreferenceDraft(event.target.value as BotLanguagePreference)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
              <option value="all">Alle Sprachen</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">Alle Sprachen passt sich an die Sprache der Nachricht an.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="bot-instructions">
              Anweisungen
            </label>
            <textarea
              id="bot-instructions"
              name="bot-instructions"
              data-testid="bot-instructions-input"
              value={botInstructionsDraft}
              onChange={(event) => setBotInstructionsDraft(event.target.value)}
              rows={5}
              placeholder="Beschreibe kurz, wie die Figur spricht und reagiert."
              maxLength={1000}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            />
            <p className="mt-1 text-xs text-slate-500">{botInstructionsRemaining} Zeichen frei</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="bot-catchphrases">
              Catchphrases
            </label>
            <textarea
              id="bot-catchphrases"
              name="bot-catchphrases"
              data-testid="bot-catchphrases-input"
              value={botCatchphrasesDraft}
              onChange={(event) => setBotCatchphrasesDraft(event.target.value)}
              rows={3}
              placeholder={"Giggity\nShut up, Meg"}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            />
            <p className="mt-1 text-xs text-slate-500">Optional, eine Zeile pro Satz.</p>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Profilbild</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => botProfileUploadRef.current?.click()}
                disabled={uploadingBotProfile}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-60"
              >
                {uploadingBotProfile ? "Lädt Bild…" : "Bild hochladen"}
              </button>
              <button
                type="button"
                onClick={() => setBotProfilePictureDraft(getDefaultProfilePicture())}
                disabled={uploadingBotProfile}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-60"
              >
                Standardbild
              </button>
            </div>
            <div
              className={`rounded-lg border px-3 py-2 transition ${
                botProfileDropActive
                  ? "border-sky-400 bg-sky-50"
                  : "border-slate-200 bg-white"
              }`}
              tabIndex={0}
              onDragOver={onBotProfileImageDragOver}
              onDragEnter={onBotProfileImageDragOver}
              onDragLeave={onBotProfileImageDragLeave}
              onDrop={onBotProfileImageDrop}
            >
              <p className="text-xs text-slate-500">Bild hierher ziehen oder per Cmd/Ctrl + V einfügen.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="bot-profile-picture-url">
                Bild-Link
              </label>
              <input
                id="bot-profile-picture-url"
                name="bot-profile-picture-url"
                type="url"
                data-testid="bot-profile-picture-url-input"
                value={botProfilePictureDraft}
                onChange={(event) => setBotProfilePictureDraft(event.target.value)}
                placeholder="https://example.com/bot.png"
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Autopost</p>
              <button
                type="button"
                onClick={() => setBotAutomationExpanded((current) => !current)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                {botAutomationExpanded ? "Optionen ausblenden" : "Mehr Optionen"}
              </button>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <span className="text-sm font-medium text-slate-700">Spontane Nachrichten</span>
              <input
                type="checkbox"
                checked={botAutonomousEnabledDraft}
                onChange={(event) => {
                  setBotAutonomousEnabledDraft(event.target.checked);
                  if (event.target.checked) {
                    setBotAutomationExpanded(true);
                  }
                }}
              />
            </label>

            {botAutomationExpanded ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700" htmlFor="bot-auto-minutes-min">
                      Min. Minuten
                    </label>
                    <input
                      id="bot-auto-minutes-min"
                      name="bot-auto-minutes-min"
                      type="number"
                      min={minBotAutonomousIntervalMinutes}
                      max={maxBotAutonomousIntervalMinutes}
                      value={botAutonomousMinMinutesDraft}
                      onChange={(event) => setBotAutonomousMinMinutesDraft(event.target.value)}
                      className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700" htmlFor="bot-auto-minutes-max">
                      Max. Minuten
                    </label>
                    <input
                      id="bot-auto-minutes-max"
                      name="bot-auto-minutes-max"
                      type="number"
                      min={minBotAutonomousIntervalMinutes}
                      max={maxBotAutonomousIntervalMinutes}
                      value={botAutonomousMaxMinutesDraft}
                      onChange={(event) => setBotAutonomousMaxMinutesDraft(event.target.value)}
                      className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700" htmlFor="bot-auto-prompt">
                    Gedanken-Fokus
                  </label>
                  <textarea
                    id="bot-auto-prompt"
                    name="bot-auto-prompt"
                    value={botAutonomousPromptDraft}
                    onChange={(event) => setBotAutonomousPromptDraft(event.target.value)}
                    rows={3}
                    maxLength={280}
                    placeholder="Optional: Worüber soll der Bot spontan posten?"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  />
                </div>
              </>
            ) : null}
          </div>

          <p
              className={`text-sm ${
                botFormReady || botLimitReached ? "text-slate-600" : "text-rose-700"
              }`}
            data-testid="bot-helper-text"
          >
            {botHelperText}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveBot()}
              disabled={botSaveDisabled}
              data-testid="bot-save-button"
              className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-60"
            >
              {savingBot ? "Speichert…" : editingBotId ? "Änderungen speichern" : "Bot erstellen"}
            </button>
            <button
              type="button"
              onClick={() => resetBotEditor()}
              data-testid={editingBotId ? "bot-cancel-edit-button" : "bot-close-button"}
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              Abbrechen
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );

  if (!session) {
    return (
      <div className="brand-surface min-h-[100svh] p-6">
        <div className="glass-panel-strong mx-auto max-w-5xl rounded-2xl p-5 animate-pulse">
          <div className="h-5 w-36 rounded bg-slate-200/70" />
          <div className="mt-4 h-12 rounded-xl bg-slate-200/70" />
          <div className="mt-3 h-12 rounded-xl bg-slate-200/70" />
          <div className="mt-3 h-40 rounded-2xl bg-slate-200/70" />
        </div>
      </div>
    );
  }

  if (appKillState.enabled) {
    return (
      <main className="fixed inset-0 z-[1300] h-[100dvh] w-full bg-black" aria-label="Kill-Switch aktiv" />
    );
  }

  return (
    <main
      style={chatBackgroundStyle}
      className="brand-surface relative h-[100dvh] w-full overflow-x-hidden overflow-y-hidden [touch-action:manipulation]"
    >
      <ChatShellSidebar
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={closeMobileSidebar}
        username={session.username}
        profilePicture={sessionProfilePicture}
        member={ownMember}
        memberHighlight={highlightOwnMember}
        onOpenProfileEditor={openProfileEditor}
        onOpenDevMenu={isDeveloperMode ? openDevMenu : undefined}
        onOpenBots={openBotEditor}
        onOpenSharedBackground={openSharedBackgroundModal}
        onOpenMedia={openMediaModal}
        onOpenPointsInfo={openPointsInfoModal}
        onlineUsersContent={sidebarOnlineUsersContent}
      />

      {rankCelebration ? (
        <RankUpConfettiOverlay
          confettiKey={rankCelebration.key}
          username={rankCelebration.username}
          rankLabel={rankCelebration.rankLabel}
        />
      ) : null}

      {scoreGainOverlays.length > 0 && typeof document !== "undefined"
        ? createPortal(<ScoreGainOverlay items={scoreGainOverlays} />, document.body)
        : null}

      <div className="flex h-full min-h-0 flex-col lg:pl-72">
        <section
          className="relative flex min-h-0 flex-1 flex-col pt-[calc(env(safe-area-inset-top)+3.5rem)] lg:pt-0"
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDraggingUpload(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            if (!isDraggingUpload) {
              setIsDraggingUpload(true);
            }
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) {
              setIsDraggingUpload(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepthRef.current = 0;
            setIsDraggingUpload(false);
            void onChatImageDrop(event.dataTransfer.files);
          }}
        >
          <button
            type="button"
            onClick={openMobileSidebar}
            className="absolute left-3 top-3 z-30 rounded-full border border-slate-200 bg-white p-2.5 text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:hidden"
            aria-label="Sidebar öffnen"
            style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
          >
            <Bars3Icon aria-hidden="true" className="size-5" />
          </button>

          {isDraggingUpload ? (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-sky-500/12 backdrop-blur-[1px]">
              <div className="rounded-2xl border-2 border-dashed border-sky-400 bg-white/95 px-6 py-5 text-center shadow-lg">
                <p className="text-sm font-semibold text-slate-900">Bild zum Hochladen ablegen</p>
                <p className="mt-1 text-xs text-slate-500">PNG, JPG, WEBP, GIF</p>
              </div>
            </div>
          ) : null}

          <div
            ref={scrollRef}
            className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 [overscroll-behavior:contain] [overflow-anchor:none] [-webkit-overflow-scrolling:touch] [touch-action:pan-y] sm:p-4"
            style={scrollContainerStyle}
          >
            {loadingOlder ? (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
                <p className="rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm animate-pulse">
                  Ältere Nachrichten werden geladen…
                </p>
              </div>
            ) : null}
            <div className="space-y-3">
              <MessageList
                messages={visibleMessages}
                currentUserId={session.id}
                currentUsername={session.username}
                isDeveloperMode={isDeveloperMode}
                pendingDeliveries={pendingDeliveries}
                answerDrafts={answerDrafts}
                onAnswerDraftChange={handleAnswerDraftChange}
                onSubmitAnswer={submitAnswer}
                onVote={handleVote}
                onReact={handleReact}
                onExtendPoll={handleExtendPoll}
                onDeleteMessage={handleDeleteMessage}
                onStartReply={handleStartReply}
                onOpenLightbox={handleOpenLightbox}
                onRemixImage={handleRemixImage}
                onOpenAuthorProfile={openMessageAuthorProfile}
              />
            </div>
          </div>

          {!isAtBottom ? (
            <div className="pointer-events-none absolute inset-x-0 z-30 flex justify-center" style={jumpToNewestStyle}>
              <button
                type="button"
                className="pointer-events-auto rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg"
                onClick={() => {
                  userDetachedFromBottomRef.current = false;
                  isAtBottomRef.current = true;
                  setIsAtBottom(true);
                  setMessageWindowSize(Math.min(messages.length, MESSAGE_RENDER_WINDOW));
                  scrollToBottom("smooth");
                  requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom("auto")));
                }}
              >
                Zu neuesten springen
              </button>
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-16 sm:px-3">
            <div className="pointer-events-auto relative mx-auto w-full max-w-[960px]">
              <ChatComposer
                composerRef={composerRef}
                messageInputRef={messageInputRef}
                chatUploadRef={chatUploadRef}
                mode={composerMode}
                messageDraft={messageDraft}
                questionDraft={questionDraft}
                pollQuestion={pollQuestion}
                pollOptions={pollOptions}
                pollMultiSelect={pollMultiSelect}
                uploadedDraftImages={uploadedDraftImages}
                replyTarget={replyTarget}
                uploadingChat={uploadingChat}
                showMentionSuggestions={showMentionSuggestions}
                mentionUsers={filteredMentionUsers}
                mentionIndex={mentionIndex}
                hasChatGptMention={hasLeadingAiTag(messageDraft, "chatgpt")}
                hasGrokMention={hasLeadingAiTag(messageDraft, "grok")}
                onModeChange={(mode) => {
                  setComposerMode(mode);
                  if (mode !== "poll" && pollExtendDraft) {
                    setPollExtendDraft(null);
                  }
                }}
                onAskChatGpt={activateAskChatGpt}
                onAskGrok={activateAskGrok}
                onRemoveReplyTarget={() => setReplyTarget(null)}
                onMessageDraftChange={handleMessageDraftChange}
                onMessageInputPaste={onMessageInputPaste}
                onMessageKeyDown={onMessageInputKeyDown}
                onQuestionDraftChange={setQuestionDraft}
                onQuestionKeyDown={onQuestionInputKeyDown}
                onPollQuestionChange={setPollQuestion}
                onPollOptionChange={updatePollOptionValue}
                onPollMultiSelectChange={setPollMultiSelect}
                onRemovePollOption={() =>
                  setPollOptions((current) => {
                    const minCount = Math.max(2, pollExtendDraft?.existingOptions.length ?? 0);
                    return current.length <= minCount ? current : current.slice(0, -1);
                  })}
                pollExtending={Boolean(pollExtendDraft)}
                pollLockedOptionCount={pollExtendDraft?.existingOptions.length ?? 0}
                onCancelPollExtend={() => {
                  setPollExtendDraft(null);
                  setPollQuestion("");
                  setPollOptions(["", ""]);
                  setPollMultiSelect(false);
                }}
                onSelectMention={selectMentionUser}
                onRemoveDraftImage={(imageId) =>
                  setUploadedDraftImages((current) => current.filter((uploadedImage) => uploadedImage.id !== imageId))
                }
                onOpenUpload={() => chatUploadRef.current?.click()}
                onUploadChange={(event) => void onChatImageUpload(event.target.files?.[0])}
                onSubmit={() => void submitComposer()}
              />
            </div>
          </div>
        </section>
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36">
        <div className="absolute inset-0 bg-gradient-to-t from-white/85 via-white/30 to-transparent" />
        <div
          className="absolute inset-0 sm:backdrop-blur-md"
          style={{
            maskImage: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 100%)",
            WebkitMaskImage:
              "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 100%)",
          }}
        />
      </div>

      <UiToast
        show={Boolean(error)}
        title="Fehler"
        message={error || ""}
        tone="error"
        onClose={() => setError(null)}
      />

      <UiToast
        show={Boolean(validationNotice)}
        title={validationNotice?.title}
        message={validationNotice?.message || ""}
        tone="info"
        onClose={() => {
          if (validationToastResetTimeoutRef.current !== null) {
            window.clearTimeout(validationToastResetTimeoutRef.current);
            validationToastResetTimeoutRef.current = null;
          }
          setValidationNotice(null);
        }}
      />

      {memberDrawerOpen ? (
        <MemberProfileDrawer
          open={memberDrawerOpen}
          onClose={() => setMemberDrawerOpen(false)}
          loading={memberDrawerLoading}
          error={memberDrawerError}
          profile={memberDrawerProfile}
          ownStats={memberDrawerOwnStats}
          aiModels={{ chatgpt: aiStatus.chatgptModel, grok: aiStatus.grokModel }}
          onOpenProfileImage={(url, alt) => setLightbox({ url, alt })}
        />
      ) : null}

      {showPointsInfo ? (
        <AppOverlayDialog
          open={showPointsInfo}
          onClose={() => setShowPointsInfo(false)}
          title="Wie bekomme ich PPC Score?"
          description="So wird dein PPC Score aktuell wirklich berechnet."
          maxWidthClassName="sm:max-w-lg"
          bodyClassName="space-y-4"
          footer={(
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setShowPointsInfo(false)}
                className="inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-xs inset-ring-1 inset-ring-slate-300 hover:bg-slate-50 sm:w-auto"
              >
                Schließen
              </button>
            </div>
          )}
        >
          <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-3">
            <p className="text-sm font-semibold text-slate-900">Direkte Punkte pro Aktion</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Dein Rohscore steigt durch diese Aktionen. Der sichtbare PPC Score sinkt bei längerer Inaktivität
              langsam wieder ab.
            </p>
          </div>

          <div className="space-y-2">
            {PPC_MEMBER_POINT_RULES.map((rule) => (
              <div
                key={rule.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{rule.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-600">{rule.description}</p>
                </div>
                <span className="shrink-0 rounded-full border border-sky-200 bg-white px-2 py-0.5 text-xs font-semibold text-sky-700">
                  +{rule.points}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ränge & Schwellen</p>
            <div className="mt-2 space-y-2">
              {ownRankMilestones.map((step) => (
                <div
                  key={step.rank}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    step.reached
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                    <p className="text-xs text-slate-600">ab {step.minScore} Punkten</p>
                  </div>
                  <p className={`text-xs font-semibold ${step.reached ? "text-emerald-700" : "text-slate-700"}`}>
                    {step.reached ? "erreicht" : `noch ${step.remaining} Punkte`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </AppOverlayDialog>
      ) : null}

      {showBackgroundModal ? (
        <AppOverlayDialog
          open={showBackgroundModal}
          onClose={() => setShowBackgroundModal(false)}
          title="Geteilter Chat-Hintergrund"
          description="URL einfügen, Bild per Copy/Paste übernehmen oder hochladen."
          maxWidthClassName="sm:max-w-xl"
          bodyClassName="space-y-3"
          footer={(
            <div className="flex flex-wrap gap-2 sm:flex-row-reverse sm:justify-start">
              <button
                type="button"
                onClick={() => void saveBackgroundDraft()}
                className="inline-flex w-full justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-60 sm:ml-3 sm:w-auto"
                disabled={uploadingBackground}
              >
                {uploadingBackground ? "Speichert…" : "Speichern"}
              </button>
              <button
                type="button"
                onClick={() => setShowBackgroundModal(false)}
                className="inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-xs inset-ring-1 inset-ring-slate-300 hover:bg-slate-50 sm:w-auto"
              >
                Abbrechen
              </button>
            </div>
          )}
        >
          <div className="space-y-3" onPaste={onBackgroundModalPaste}>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktuelle Vorschau</p>
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {chatBackgroundUrl ? (
                  <img
                    src={chatBackgroundUrl}
                    alt="Aktueller Chat-Hintergrund"
                    className="aspect-video w-full bg-slate-100 object-contain"
                    loading="lazy"
                    decoding="async"
                    width={960}
                    height={540}
                  />
                ) : (
                  <div className="grid aspect-video place-items-center bg-slate-100 text-xs text-slate-500">Kein Hintergrund gesetzt</div>
                )}
              </div>
            </div>

            <label className="block text-sm font-medium text-slate-900" htmlFor="chat-background-url">Bild-URL</label>
            <input
              id="chat-background-url"
              name="chat-background-url"
              type="url"
              value={backgroundDraftUrl}
              onChange={(event) => setBackgroundDraftUrl(event.target.value)}
              placeholder="https://example.com/background.jpg…"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              autoComplete="off"
            />

            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
              <p className="text-xs text-slate-600">Tipp: Hier hinein klicken und dann ein Bild einfügen (Cmd/Ctrl + V).</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => backgroundUploadRef.current?.click()}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  disabled={uploadingBackground}
                >
                  {uploadingBackground ? "Wird hochgeladen…" : "Datei hochladen"}
                </button>
                <button
                  type="button"
                  onClick={() => setBackgroundDraftUrl("")}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  Zurücksetzen
                </button>
              </div>
            </div>
          </div>
        </AppOverlayDialog>
      ) : null}

      <input
        ref={profileUploadRef}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => void onProfileImageUpload(event.target.files?.[0])}
      />

      <input
        ref={botProfileUploadRef}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => void onBotProfileImageUpload(event.target.files?.[0])}
      />

      {editingBots ? (
        <AppOverlayDialog
          open={editingBots}
          onClose={closeBotEditor}
          title="Bots"
          description="Erstelle und verwalte deine Charaktere."
          maxWidthClassName="sm:max-w-3xl"
          bodyClassName="space-y-3"
          footer={(
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                onClick={closeBotEditor}
                className="inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-xs inset-ring-1 inset-ring-slate-300 hover:bg-slate-50 sm:w-auto"
              >
                Schließen
              </button>
            </div>
          )}
        >
          {botManagerSection}
        </AppOverlayDialog>
      ) : null}

      {editingProfile ? (
        <AppOverlayDialog
          open={editingProfile}
          onClose={closeProfileEditor}
          title="Mein Profil"
          description="Profil, Sicherheit und Statistik."
          maxWidthClassName="sm:max-w-2xl"
          bodyClassName="space-y-4"
          footer={(
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                onClick={closeProfileEditor}
                className="inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-xs inset-ring-1 inset-ring-slate-300 hover:bg-slate-50 sm:w-auto"
              >
                Schließen
              </button>
            </div>
          )}
        >
          <section className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4" onPaste={onProfileImagePaste}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Profil</h3>
              <button
                type="button"
                onClick={() => void saveProfile()}
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
                disabled={uploadingProfile || savingProfile || isLeaving}
              >
                {savingProfile ? "Speichert…" : "Speichern"}
              </button>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <img
                src={profilePictureDraft || getDefaultProfilePicture()}
                alt="Profilbild-Vorschau"
                className="h-20 w-20 rounded-full border border-slate-200 object-cover"
                loading="lazy"
                decoding="async"
                width={80}
                height={80}
              />
              <div className="min-w-0">
                <p className="truncate text-xl font-semibold text-slate-900">{usernameDraft || session.username}</p>
                <p className={`mt-1 text-sm font-medium ${isDeveloperMode ? "text-amber-600" : "text-sky-500"}`}>
                  {isDeveloperMode ? "Entwicklermodus" : "online"}
                </p>
              </div>
            </div>

            <label className="block text-sm font-medium text-slate-900" htmlFor="profile-display-name">Anzeigename</label>
            <input
              id="profile-display-name"
              value={usernameDraft}
              onChange={(event) => setUsernameDraft(event.target.value)}
              placeholder="Benutzername…"
              className="h-12 w-full rounded-xl border border-slate-200 px-4 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            />

            <div
              className={`space-y-3 rounded-xl border border-dashed p-3 transition ${
                profileDropActive
                  ? "border-sky-400 bg-sky-50"
                  : "border-slate-300 bg-white"
              }`}
              tabIndex={0}
              onDragOver={onProfileImageDragOver}
              onDragEnter={onProfileImageDragOver}
              onDragLeave={onProfileImageDragLeave}
              onDrop={onProfileImageDrop}
            >
              <p className="text-sm text-slate-500">Vor dem Speichern Profilbild hochladen und zuschneiden.</p>
              <p className="text-xs text-slate-500">
                Bild hierher ziehen oder per Einfügen (Cmd/Ctrl + V) übernehmen.
              </p>
              <button
                type="button"
                onClick={() => profileUploadRef.current?.click()}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-60"
                disabled={uploadingProfile || savingProfile || isLeaving}
              >
                {uploadingProfile ? "Wird hochgeladen…" : "Hochladen"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              className="h-11 w-full rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLeaving}
            >
              {isLeaving ? "Meldet ab…" : "Abmelden"}
            </button>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Statistik</h3>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">PPC Score</p>
              <p className="text-sm font-semibold text-sky-700">{ownMember?.score ?? 0}</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out"
                style={{ width: `${ownProgressPercent}%` }}
              />
            </div>
            <p className="text-xs text-slate-600">
              {ownMember?.nextRank
                ? `Noch ${ownMember.pointsToNext ?? 0} bis zum nächsten Rang`
                : "Höchster Rang erreicht"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ownRankMilestones.map((step) => (
                <div key={`profile-rank-${step.rank}`} className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                  <p className="text-xs font-semibold text-slate-800">{step.label}</p>
                  <p className="text-[11px] text-slate-600">
                    {step.reached ? "Erreicht" : `Noch ${step.remaining} bis ${step.minScore}`}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Posts: <span className="font-semibold">{ownProfileStats.postsTotal}</span></div>
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Reaktionen erhalten: <span className="font-semibold">{ownProfileStats.reactionsReceived}</span></div>
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Reaktionen gegeben: <span className="font-semibold">{ownProfileStats.reactionsGiven}</span></div>
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Umfragen erstellt: <span className="font-semibold">{ownProfileStats.pollsCreated}</span></div>
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Umfrage-Stimmen: <span className="font-semibold">{ownProfileStats.pollVotes}</span></div>
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Aktive Tage: <span className="font-semibold">{ownProfileStats.activeDays}</span></div>
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Sicherheit</h3>
              <button
                type="button"
                onClick={() => void saveSecurity()}
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
                disabled={savingSecurity || isLeaving}
              >
                {savingSecurity ? "Speichert…" : "Speichern"}
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900" htmlFor="profile-login-name">Login-Name</label>
              <input
                id="profile-login-name"
                value={loginNameDraft}
                onChange={(event) => setLoginNameDraft(event.target.value)}
                placeholder="z. B. vorname.nachname"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                disabled={savingSecurity || isLeaving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-900" htmlFor="profile-current-password">Aktuelles Passwort</label>
                <input
                  id="profile-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPasswordDraft}
                  onChange={(event) => setCurrentPasswordDraft(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  disabled={savingSecurity || isLeaving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-900" htmlFor="profile-new-password">Neues Passwort</label>
                <input
                  id="profile-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPasswordDraft}
                  onChange={(event) => setNewPasswordDraft(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  disabled={savingSecurity || isLeaving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-900" htmlFor="profile-confirm-password">Neues Passwort bestätigen</label>
                <input
                  id="profile-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmNewPasswordDraft}
                  onChange={(event) => setConfirmNewPasswordDraft(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  disabled={savingSecurity || isLeaving}
                />
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Für Login-Name- oder Passwort-Änderungen ist das aktuelle Passwort erforderlich.
            </p>
          </section>
        </AppOverlayDialog>
      ) : null}

      <input
        ref={backgroundUploadRef}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => void onBackgroundImageUpload(event.target.files?.[0])}
      />

      {profileCropFile ? (
        <ProfileImageCropModal
          key={`${profileCropFile.name}-${profileCropFile.size}-${profileCropFile.lastModified}`}
          file={profileCropFile}
          busy={profileCropTarget === "bot" ? uploadingBotProfile : uploadingProfile}
          onCancel={clearProfileCropState}
          onConfirm={onProfileCropConfirm}
        />
      ) : null}

      {lightbox && typeof document !== "undefined"
        ? createPortal(
          <div
            className="fixed inset-0 z-[1000] grid place-items-center bg-slate-950/85 p-4 pointer-events-auto"
            onClick={() => setLightbox(null)}
          >
            <div
              className="relative max-h-[92vh] max-w-[92vw] pointer-events-auto"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseEnter={lightboxSupportsHover ? revealLightboxControls : undefined}
              onMouseMove={lightboxSupportsHover ? revealLightboxControls : undefined}
              onMouseLeave={lightboxSupportsHover ? hideLightboxControls : undefined}
              role="dialog"
              aria-modal="true"
              aria-label="Bildansicht"
            >
              <div
                className={`absolute left-2 right-2 top-2 z-10 flex flex-wrap items-center justify-end gap-2 pointer-events-auto transition-opacity duration-200 ${
                  lightboxControlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
                onPointerDown={(event) => event.stopPropagation()}
                aria-hidden={!lightboxControlsVisible}
              >
                <button
                  type="button"
                  onClick={() => void shareLightboxImage()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white backdrop-blur-sm"
                >
                  <ShareIcon aria-hidden="true" className="size-4" />
                  Teilen
                </button>
                <button
                  type="button"
                  onClick={() => void copyLightboxImage()}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-white backdrop-blur-sm ${
                    lightboxCopyState === "success"
                      ? "bg-emerald-600/90"
                      : lightboxCopyState === "link"
                        ? "bg-sky-600/90"
                      : lightboxCopyState === "error"
                        ? "bg-rose-600/90"
                        : "bg-black/65"
                  }`}
                >
                  <ClipboardDocumentIcon aria-hidden="true" className="size-4" />
                  {lightboxCopyState === "success"
                    ? "Bild kopiert"
                    : lightboxCopyState === "link"
                      ? "Link kopiert"
                    : lightboxCopyState === "error"
                      ? "Kopieren nicht möglich"
                      : "Bild kopieren"}
                </button>
                <button
                  type="button"
                  onClick={downloadLightboxImage}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white backdrop-blur-sm"
                >
                  <ArrowDownTrayIcon aria-hidden="true" className="size-4" />
                  Herunterladen
                </button>
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white backdrop-blur-sm"
                >
                  <XMarkIcon aria-hidden="true" className="size-4" />
                  Schließen
                </button>
              </div>
              <img
                src={lightbox.url}
                alt={lightbox.alt}
                decoding="async"
                className="max-h-[92vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!lightboxSupportsHover) {
                    toggleLightboxControls();
                  }
                }}
              />
            </div>
          </div>,
          document.body,
        )
        : null}

      {showOnboarding ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 backdrop-blur-sm p-2 sm:p-4">
          <div
            className="glass-panel-strong w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-3xl p-6 [overscroll-behavior:contain]"
            role="dialog"
            aria-modal="true"
            aria-label="Schnellstart"
          >
            <p className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
              Willkommen bei ChatPPC
            </p>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">Schnellstart in 30 Sekunden</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p>1. Schreibe Nachrichten und Fragen im Composer.</p>
              <p>2. Erstelle Umfragen mit mehreren Optionen und sofortigen Updates.</p>
              <p>3. Teile Bilder und GIFs per Drag-and-drop.</p>
              <p>4. Erwähne <span className="font-semibold text-slate-900">@chatgpt</span> oder <span className="font-semibold text-slate-900">@grok</span>, wenn du KI-Antworten möchtest.</p>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={finishOnboarding}
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Los geht&apos;s
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showMedia ? (
        <AppOverlayDialog
          open={showMedia}
          onClose={() => setShowMedia(false)}
          title="Medien"
          description={
            loadingMedia && mediaItems.length === 0
              ? "Vollständige Medienhistorie wird geladen…"
              : `${mediaTotalCount} Bild${mediaTotalCount === 1 ? "" : "er"} in der Datenbank`
          }
          maxWidthClassName="sm:max-w-5xl"
          footer={(
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setShowMedia(false)}
                className="inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-xs inset-ring-1 inset-ring-slate-300 hover:bg-slate-50 sm:w-auto"
              >
                Schließen
              </button>
            </div>
          )}
        >
          {loadingMedia && mediaItems.length === 0 ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 animate-pulse">
                <div className="h-4 w-48 rounded bg-slate-200/70" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div key={`media-skeleton-${index}`} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 animate-pulse">
                    <div className="aspect-square w-full bg-slate-200/70" />
                    <div className="space-y-1.5 px-2 py-2">
                      <div className="h-3 w-3/4 rounded bg-slate-200/70" />
                      <div className="h-3 w-1/2 rounded bg-slate-200/70" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : mediaItems.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
              Noch keine Bilder geteilt.
            </div>
          ) : (
            <div ref={mediaScrollRef} className="max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {visibleMediaItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLightbox({ url: item.url, alt: `Geteilt von ${item.username}` })}
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left"
                    title={`Geteilt von ${item.username}`}
                  >
                    <div className="relative aspect-square w-full bg-slate-100">
                      <img
                        src={item.url}
                        alt="Geteiltes Medium"
                        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-[11px] font-medium text-slate-700">{item.username}</p>
                      <p className="text-[10px] text-slate-500">{item.createdAtLabel}</p>
                    </div>
                  </button>
                ))}
              </div>
              {mediaHasMore || loadingMediaMore || mediaHasHiddenLocalItems ? (
                <div className="mt-3 flex justify-center">
                  <p className={`rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 ${loadingMediaMore ? "animate-pulse" : ""}`}>
                    {loadingMediaMore
                      ? "Weitere werden geladen…"
                      : mediaHasHiddenLocalItems
                        ? "Zum Einblenden weiter scrollen"
                        : "Zum automatischen Nachladen scrollen"}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </AppOverlayDialog>
      ) : null}
    </main>
  );
}
