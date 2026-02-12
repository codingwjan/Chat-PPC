"use client";
/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { ChatMessage } from "@/components/chat-message";
import { ProfileImageCropModal } from "@/components/profile-image-crop-modal";
import { apiJson } from "@/lib/http";
import {
  clearSession,
  getDefaultProfilePicture,
  loadSession,
  saveSession,
  type SessionState,
} from "@/lib/session";
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
  RenameUserRequest,
  SnapshotDTO,
  UserPresenceDTO,
  VotePollRequest,
} from "@/lib/types";
import chatgptAvatar from "@/resources/chatgpt.png";
import grokAvatar from "@/resources/grokAvatar.png";

type ComposerMode = "message" | "question" | "poll" | "challenge";
const PRIMARY_COMPOSER_MODES: ComposerMode[] = ["message"];
const SECONDARY_COMPOSER_MODES: ComposerMode[] = ["question", "poll", "challenge"];

const COMPOSER_MODE_LABEL: Record<ComposerMode, string> = {
  message: "Nachricht",
  question: "Frage",
  poll: "Umfrage",
  challenge: "Aufgabe",
};

interface UploadResponse {
  url: string;
}

interface UploadedDraftImage {
  id: string;
  url: string;
  label: string;
}

function DraftImagePreview({
  image,
  onRemove,
}: {
  image: UploadedDraftImage;
  onRemove: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="group relative h-14 w-14 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      {!loaded ? <div className="absolute inset-0 animate-pulse bg-slate-200" aria-hidden /> : null}
      <img
        src={image.url}
        alt={image.label}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-900/80 text-xs text-white group-hover:flex"
        aria-label="Hochgeladenes Bild entfernen"
      >
        ×
      </button>
    </div>
  );
}

const MESSAGE_PAGE_SIZE = 12;
const SNAPSHOT_LIMIT = 40;
const RECONCILE_INTERVAL_MS = 30_000;
const PRESENCE_PING_INTERVAL_MS = 20_000;
const NEAR_BOTTOM_PX = 80;
const AUTO_SCROLL_ON_SEND_MAX_DISTANCE_PX = 420;
const TOP_LOAD_TRIGGER_PX = 120;
const ONBOARDING_KEY = "chatppc.onboarding.v1";
const MAX_MESSAGE_INPUT_LINES = 10;
const MAX_VISIBLE_MESSAGES = 120;
const MESSAGE_RENDER_WINDOW = 40;
const MESSAGE_RENDER_CHUNK = 20;
const SUPPORTED_CHAT_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MEDIA_PAGE_SIZE = 3;
const MEDIA_CACHE_KEY = "chatppc.media.cache.v1";
const MEDIA_CACHE_TTL_MS = 5 * 60 * 1_000;
type NotificationState = NotificationPermission | "unsupported";

function hasChatGptMention(message: string): boolean {
  return /(^|\s)@chatgpt\b/i.test(message);
}

function hasGrokMention(message: string): boolean {
  return /(^|\s)@grok\b/i.test(message);
}

function hasAiMention(message: string): boolean {
  return hasChatGptMention(message) || hasGrokMention(message);
}

function prependMention(current: string, mention: "@chatgpt" | "@grok"): string {
  const trimmed = current.trim();
  if (!trimmed) return `${mention} `;
  return `${mention} ${current}`;
}

function mergeUser(users: UserPresenceDTO[], next: UserPresenceDTO): UserPresenceDTO[] {
  const index = users.findIndex((user) => user.clientId === next.clientId);
  if (index === -1) return [...users, next];
  const copy = [...users];
  copy[index] = next;
  return copy;
}

function mergeMessage(messages: MessageDTO[], next: MessageDTO): MessageDTO[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index === -1) {
    return [...messages, next].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }
  const copy = [...messages];
  copy[index] = next;
  return copy;
}

function mergeMessages(messages: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  return incoming.reduce((current, message) => mergeMessage(current, message), messages);
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

function syncProfilePictureForUser(messages: MessageDTO[], user: UserPresenceDTO): MessageDTO[] {
  let changed = false;
  const nextMessages = messages.map((message) => {
    const matchesUser =
      (message.authorId && message.authorId === user.id) ||
      (!message.authorId && message.username === user.username);

    if (!matchesUser || message.profilePicture === user.profilePicture) {
      return message;
    }
    changed = true;
    return { ...message, profilePicture: user.profilePicture };
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

async function uploadProfileImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch("/api/uploads/profile", { method: "POST", body: formData });
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

function statusForComposer(input: {
  mode: ComposerMode;
  messageDraft: string;
  hasUploadedImages: boolean;
  questionDraft: string;
  challengeDraft: string;
  pollQuestion: string;
  pollOptions: string[];
}): string {
  if (input.mode === "message" && (input.messageDraft.trim() || input.hasUploadedImages)) return "schreibt…";
  if (input.mode === "question" && input.questionDraft.trim()) return "stellt eine Frage…";
  if (input.mode === "challenge" && input.challengeDraft.trim()) return "erstellt eine Aufgabe…";
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

function describeNotificationState(state: NotificationState): string {
  if (state === "denied") {
    return "Benachrichtigungen sind blockiert. Aktiviere sie in den Browser-Einstellungen und versuche es erneut.";
  }
  if (state === "unsupported") {
    return "Dieser Browser unterstützt keine Desktop-Benachrichtigungen.";
  }
  if (state === "granted") {
    return "Desktop-Benachrichtigungen für neue Nachrichten und Beitritte sind aktiviert.";
  }
  return "Aktiviere Desktop-Benachrichtigungen für neue Nachrichten und wenn jemand dem Chat beitritt.";
}

function notificationButtonLabel(state: NotificationState): string {
  if (state === "granted") return "Benachrichtigungen aktiv";
  if (state === "denied") return "Benachrichtigungen aktivieren";
  if (state === "unsupported") return "Nicht unterstützt";
  return "Benachrichtigungen aktivieren";
}

function isJoinSystemMessage(message: MessageDTO): boolean {
  if (message.type !== "message" || message.username !== "System") return false;
  const content = message.message.trim().toLowerCase();
  return content.endsWith("joined the chat") || content.endsWith("ist dem chat beigetreten");
}

function shouldNotifyMessage(message: MessageDTO): boolean {
  if (isJoinSystemMessage(message)) return true;
  return message.type === "message" && message.username !== "System";
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
    updatedAt: new Date().toISOString(),
  };
}

interface MessageListProps {
  messages: MessageDTO[];
  currentUsername: string;
  isDeveloperMode: boolean;
  pendingDeliveries: Record<string, true>;
  answerDrafts: Record<string, string>;
  onAnswerDraftChange: (messageId: string, value: string) => void;
  onSubmitAnswer: (messageId: string) => void;
  onVote: (messageId: string, optionIds: string[]) => void;
  onDeleteMessage: (messageId: string) => void;
  onStartReply: (message: MessageDTO) => void;
  onOpenLightbox: (url: string, alt?: string) => void;
  onRemixImage: (url: string, alt?: string) => void;
}

const MessageList = memo(function MessageList({
  messages,
  currentUsername,
  isDeveloperMode,
  pendingDeliveries,
  answerDrafts,
  onAnswerDraftChange,
  onSubmitAnswer,
  onVote,
  onDeleteMessage,
  onStartReply,
  onOpenLightbox,
  onRemixImage,
}: MessageListProps) {
  return (
    <>
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
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
          onDeleteMessage={onDeleteMessage}
          onStartReply={onStartReply}
          onOpenLightbox={onOpenLightbox}
          onRemixImage={onRemixImage}
        />
      ))}
    </>
  );
});

interface OnlineUsersListProps {
  users: UserPresenceDTO[];
  avatarSizeClassName: string;
  onOpenLightbox: (url: string, alt?: string) => void;
}

const OnlineUsersList = memo(function OnlineUsersList({ users, avatarSizeClassName, onOpenLightbox }: OnlineUsersListProps) {
  return (
    <>
      {users.map((user) => (
        <div key={user.clientId} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <button
            type="button"
            onClick={() => onOpenLightbox(user.profilePicture, `Profilbild von ${user.username}`)}
            className={`${avatarSizeClassName} shrink-0 cursor-zoom-in overflow-hidden rounded-full border border-slate-200 object-cover transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300`}
            aria-label={`Profilbild von ${user.username} öffnen`}
          >
            <img
              src={user.profilePicture}
              alt={`${user.username} Profilbild`}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{user.username}</p>
            <p className="truncate text-xs text-slate-500">{formatPresenceStatus(user)}</p>
            {shouldShowAiProgress(user) ? (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
                <div
                  className="h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out animate-pulse"
                  style={{ width: `${aiProgressForStatus(user.status)}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
});

export function ChatApp() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const profileUploadRef = useRef<HTMLInputElement>(null);
  const chatUploadRef = useRef<HTMLInputElement>(null);
  const backgroundUploadRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const mediaScrollRef = useRef<HTMLDivElement>(null);
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
  const draftBeforeHistoryRef = useRef("");
  const dragDepthRef = useRef(0);
  const messageInputLineHeightRef = useRef<number | null>(null);
  const messageInputResizeFrameRef = useRef<number | null>(null);
  const lightboxCopyResetTimeoutRef = useRef<number | null>(null);
  const bottomStickFrameRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);

  const [session, setSession] = useState<SessionState | null>(() => loadSession());
  const [users, setUsers] = useState<UserPresenceDTO[]>([]);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [messageWindowSize, setMessageWindowSize] = useState(MESSAGE_RENDER_WINDOW);
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusDTO>(() => createDefaultAiStatus());
  const [uploadingChat, setUploadingChat] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [chatBackgroundUrl, setChatBackgroundUrl] = useState<string | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItemDTO[]>([]);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [mediaTotalCount, setMediaTotalCount] = useState(0);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingMediaMore, setLoadingMediaMore] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
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
  const [notificationState, setNotificationState] = useState<NotificationState>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });
  const [adminOverview, setAdminOverview] = useState<AdminOverviewDTO | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminTargetUsername, setAdminTargetUsername] = useState("");
  const [adminTargetMessageId, setAdminTargetMessageId] = useState("");
  const [pendingDeliveries, setPendingDeliveries] = useState<Record<string, true>>({});
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [lightboxCopyState, setLightboxCopyState] = useState<LightboxCopyState>("idle");
  const [replyTarget, setReplyTarget] = useState<ReplyTargetState | null>(null);

  const [messageDraft, setMessageDraft] = useState("");
  const [uploadedDraftImages, setUploadedDraftImages] = useState<UploadedDraftImage[]>([]);
  const [questionDraft, setQuestionDraft] = useState("");
  const [challengeDraft, setChallengeDraft] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMultiSelect, setPollMultiSelect] = useState(false);

  const [editingProfile, setEditingProfile] = useState(false);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [profileCropFile, setProfileCropFile] = useState<File | null>(null);
  const [usernameDraft, setUsernameDraft] = useState(() => loadSession()?.username || "");
  const [profilePictureDraft, setProfilePictureDraft] = useState(
    () => loadSession()?.profilePicture || getDefaultProfilePicture(),
  );

  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [composerHistoryIndex, setComposerHistoryIndex] = useState(-1);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [viewportHeightPx, setViewportHeightPx] = useState<number | null>(null);
  const isDeveloperMode = Boolean(session?.devMode && session.devAuthToken);

  const onlineUsers = useMemo(
    () => [
      {
        id: "chatgpt",
        clientId: "chatgpt",
        username: "ChatGPT",
        profilePicture: chatgptAvatar.src,
        status: aiStatus.chatgpt,
        isOnline: true,
        lastSeenAt: aiStatus.updatedAt,
      },
      {
        id: "grok",
        clientId: "grok",
        username: "Grok",
        profilePicture: grokAvatar.src,
        status: aiStatus.grok,
        isOnline: true,
        lastSeenAt: aiStatus.updatedAt,
      },
      ...users.filter((user) => user.isOnline).sort((a, b) => a.username.localeCompare(b.username)),
    ],
    [users, aiStatus],
  );

  const filteredMentionUsers = useMemo(() => {
    if (!mentionFilter) return onlineUsers;
    return onlineUsers.filter((user) => user.username.toLowerCase().includes(mentionFilter.toLowerCase()));
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
        challengeDraft,
        pollQuestion,
        pollOptions,
      }),
    [challengeDraft, composerMode, messageDraft, pollOptions, pollQuestion, questionDraft, uploadedDraftImages.length],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior,
    });
  }, []);

  const captureScrollAnchor = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    prependAnchorRef.current = {
      height: element.scrollHeight,
      top: element.scrollTop,
    };
  }, []);

  const scheduleBottomStick = useCallback(() => {
    if (!isAtBottomRef.current) return;
    if (bottomStickFrameRef.current !== null) return;

    bottomStickFrameRef.current = window.requestAnimationFrame(() => {
      bottomStickFrameRef.current = null;
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
      const element = scrollRef.current;
      const distanceFromBottom = element
        ? element.scrollHeight - (element.scrollTop + element.clientHeight)
        : 0;
      const shouldAutoScroll = distanceFromBottom <= AUTO_SCROLL_ON_SEND_MAX_DISTANCE_PX;

      setMessages((current) => limitVisibleMessages(mergeMessage(current, message)));
      if (!shouldAutoScroll) {
        return;
      }

      prependAnchorRef.current = null;
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      requestAnimationFrame(() => {
        scrollToBottom("smooth");
        requestAnimationFrame(() => scrollToBottom("auto"));
      });
    },
    [scrollToBottom],
  );

  const removeOptimisticMessage = useCallback((messageId: string) => {
    knownMessageIdsRef.current.delete(messageId);
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  const resizeMessageInput = useCallback(() => {
    const textarea = messageInputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    let lineHeight = messageInputLineHeightRef.current;
    if (!lineHeight || !Number.isFinite(lineHeight) || lineHeight <= 0) {
      lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight || "20") || 20;
      messageInputLineHeightRef.current = lineHeight;
    }
    const maxHeight = lineHeight * MAX_MESSAGE_INPUT_LINES;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(lineHeight, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  const scheduleMessageInputResize = useCallback(() => {
    if (messageInputResizeFrameRef.current !== null) return;
    messageInputResizeFrameRef.current = window.requestAnimationFrame(() => {
      messageInputResizeFrameRef.current = null;
      resizeMessageInput();
    });
  }, [resizeMessageInput]);

  const handleMessageDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setMessageDraft(value);
      setComposerHistoryIndex((current) => (current === -1 ? current : -1));
      draftBeforeHistoryRef.current = "";

      const cursor = event.target.selectionStart ?? value.length;
      const textBefore = value.slice(0, cursor);
      const match = textBefore.match(/@(\w*)$/);
      if (match) {
        const nextFilter = match[1];
        setShowMentionSuggestions((current) => (current ? current : true));
        setMentionFilter((current) => (current === nextFilter ? current : nextFilter));
        setMentionIndex((current) => (current === 0 ? current : 0));
      } else {
        setShowMentionSuggestions((current) => (current ? false : current));
      }

      scheduleMessageInputResize();
    },
    [scheduleMessageInputResize],
  );

  const activateAskChatGpt = useCallback(() => {
    setComposerMode("message");
    setComposerOpen(true);
    setMessageDraft((current) => {
      if (hasChatGptMention(current)) return current;
      return prependMention(current, "@chatgpt");
    });

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
    setComposerOpen(true);
    setMessageDraft((current) => {
      if (hasGrokMention(current)) return current;
      return prependMention(current, "@grok");
    });

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

  const notifyMessages = useCallback(
    (incoming: MessageDTO[]) => {
      if (Notification.permission !== "granted" || isLeavingRef.current) return;

      const currentUsername = session?.username?.trim().toLowerCase() ?? "";

      for (const payload of incoming) {
        const isOwnByClientId = Boolean(session?.clientId) && payload.authorId === session?.clientId;
        const isOwnByUsername = currentUsername.length > 0 && payload.username.trim().toLowerCase() === currentUsername;
        if (isOwnByClientId || isOwnByUsername) continue;
        if (!shouldNotifyMessage(payload)) continue;

        const compactMessage = payload.message.replace(/\s+/g, " ").trim();
        const title = isJoinSystemMessage(payload)
          ? "Neue Anmeldung"
          : `${payload.username}: ${compactMessage || "Neue Nachricht"}`;
        new Notification(title, {
          body: isJoinSystemMessage(payload) ? compactMessage : undefined,
          icon: payload.profilePicture,
        });
      }
    },
    [session?.clientId, session?.username],
  );

  const fetchMessagePage = useCallback(async (params: {
    limit?: number;
    before?: string;
    after?: string;
  }): Promise<MessagePageDTO> => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.limit ?? MESSAGE_PAGE_SIZE));
    if (params.before) searchParams.set("before", params.before);
    if (params.after) searchParams.set("after", params.after);
    return apiJson<MessagePageDTO>(`/api/messages?${searchParams.toString()}`);
  }, []);

  const fetchPresence = useCallback(async (): Promise<UserPresenceDTO[]> => {
    return apiJson<UserPresenceDTO[]>("/api/presence");
  }, []);

  const fetchAiStatus = useCallback(async (): Promise<AiStatusDTO> => {
    return apiJson<AiStatusDTO>("/api/ai/status");
  }, []);

  const fetchChatBackground = useCallback(async (): Promise<ChatBackgroundDTO> => {
    return apiJson<ChatBackgroundDTO>("/api/chat/background");
  }, []);

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
    (incoming: MessageDTO[], options: { notify: boolean }) => {
      if (incoming.length === 0) return;

      const shouldStickToBottom = isAtBottomRef.current;
      const fresh = incoming.filter((message) => !knownMessageIdsRef.current.has(message.id));

      if (!shouldStickToBottom && fresh.length > 0) {
        captureScrollAnchor();
        setMessageWindowSize((current) => Math.min(MAX_VISIBLE_MESSAGES, current + fresh.length));
      }

      setMessages((current) => limitVisibleMessages(mergeMessages(current, incoming)));
      updateLatestMessageCursor(incoming);

      for (const message of fresh) {
        knownMessageIdsRef.current.add(message.id);
      }

      if (options.notify && fresh.length > 0) {
        notifyMessages(fresh);
      }

      if (showMedia && fresh.length > 0) {
        void fetchMediaItems({ silent: true });
      }

      if (shouldStickToBottom) {
        scheduleBottomStick();
      }
    },
    [captureScrollAnchor, fetchMediaItems, notifyMessages, scheduleBottomStick, showMedia, updateLatestMessageCursor],
  );

  const applySnapshot = useCallback(
    (snapshot: SnapshotDTO) => {
      if (isLeavingRef.current) return;

      setUsers(snapshot.users);
      setAiStatus(snapshot.aiStatus || createDefaultAiStatus());
      setChatBackgroundUrl(snapshot.background.url);

      const limitedMessages = limitVisibleMessages(snapshot.messages);
      setMessages(limitedMessages);
      setMessageWindowSize(Math.min(limitedMessages.length, MESSAGE_RENDER_WINDOW));
      setHasMoreOlder(limitedMessages.length >= SNAPSHOT_LIMIT && limitedMessages.length < MAX_VISIBLE_MESSAGES);

      knownMessageIdsRef.current = new Set(limitedMessages.map((message) => message.id));
      latestMessageAtRef.current = null;
      updateLatestMessageCursor(limitedMessages);

      if (showMedia) {
        void fetchMediaItems({ silent: true });
      }
    },
    [fetchMediaItems, showMedia, updateLatestMessageCursor],
  );

  const syncChatState = useCallback(async (): Promise<UserPresenceDTO[]> => {
    const [presence, page, ai, background] = await Promise.all([
      fetchPresence(),
      fetchMessagePage({ limit: SNAPSHOT_LIMIT }),
      fetchAiStatus().catch(() => createDefaultAiStatus()),
      fetchChatBackground().catch(() => ({ url: null, updatedAt: null, updatedBy: null })),
    ]);

    setUsers(presence);
    setAiStatus(ai);
    setChatBackgroundUrl(background.url);
    const limitedMessages = limitVisibleMessages(page.messages);
    setMessages(limitedMessages);
    setMessageWindowSize(Math.min(limitedMessages.length, MESSAGE_RENDER_WINDOW));
    setHasMoreOlder(page.hasMore && limitedMessages.length < MAX_VISIBLE_MESSAGES);

    knownMessageIdsRef.current = new Set(limitedMessages.map((message) => message.id));
    latestMessageAtRef.current = null;
    updateLatestMessageCursor(limitedMessages);

    return presence;
  }, [fetchAiStatus, fetchChatBackground, fetchMessagePage, fetchPresence, updateLatestMessageCursor]);

  const restoreSessionPresence = useCallback(async (): Promise<void> => {
    if (!session || isLeavingRef.current) return;

    const restored = await apiJson<LoginResponseDTO>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: session.username,
        clientId: session.clientId,
        profilePicture: session.profilePicture || getDefaultProfilePicture(),
      }),
    });

    const nextSession: SessionState = {
      clientId: restored.clientId,
      username: restored.username,
      profilePicture: restored.profilePicture || getDefaultProfilePicture(),
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
        Boolean(current.devMode) === Boolean(nextSession.devMode) &&
        (current.devAuthToken || "") === (nextSession.devAuthToken || "")
      ) {
        return current;
      }

      return nextSession;
    });
  }, [session]);

  const ensureSessionInPresence = useCallback(
    async (presence: UserPresenceDTO[]): Promise<void> => {
      if (!session || isLeavingRef.current) return;

      const hasCurrentUser = presence.some((user) => user.clientId === session.clientId);
      if (hasCurrentUser) return;

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
    [restoreSessionPresence, router, session, syncChatState],
  );

  const fetchAdminOverview = useCallback(async () => {
    if (!session?.clientId || !session.devAuthToken) {
      setAdminOverview(null);
      return;
    }

    const searchParams = new URLSearchParams({
      clientId: session.clientId,
      devAuthToken: session.devAuthToken,
    });
    const overview = await apiJson<AdminOverviewDTO>(`/api/admin?${searchParams.toString()}`);
    setAdminOverview(overview);
  }, [session?.clientId, session?.devAuthToken]);

  const runAdminAction = useCallback(
    async (
      action: AdminActionRequest["action"],
      options?: {
        targetUsername?: string;
        targetMessageId?: string;
      },
    ) => {
      if (!session?.clientId || !session.devAuthToken) {
        setError("Entwicklermodus ist nicht aktiv.");
        return;
      }

      setAdminBusy(true);
      setAdminNotice(null);
      try {
        const payload: AdminActionRequest = {
          clientId: session.clientId,
          devAuthToken: session.devAuthToken,
          action,
          targetUsername: options?.targetUsername,
          targetMessageId: options?.targetMessageId,
        };

        const result = await apiJson<AdminActionResponse>("/api/admin", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        setAdminOverview(result.overview);
        setAdminNotice(result.message);
        setError(null);
        await syncChatState();
        requestAnimationFrame(() => scrollToBottom("auto"));
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Admin-Aktion fehlgeschlagen.");
      } finally {
        setAdminBusy(false);
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
      backgroundAttachment: "fixed",
    } as const;
  }, [chatBackgroundUrl]);

  const viewportAwareMainStyle = useMemo(() => {
    if (!viewportHeightPx || !Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) {
      return chatBackgroundStyle;
    }

    return {
      ...(chatBackgroundStyle || {}),
      height: `${Math.round(viewportHeightPx)}px`,
    };
  }, [chatBackgroundStyle, viewportHeightPx]);

  const refreshNotificationState = useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationState("unsupported");
      return;
    }
    setNotificationState(Notification.permission);
  }, []);

  const requestNotificationPermission = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationState("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationState(permission);
  }, []);

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
      setError(loadError instanceof Error ? loadError.message : "Aeltere Nachrichten konnten nicht geladen werden.");
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
    if (composerMode !== "message") return;
    scheduleMessageInputResize();
  }, [composerMode, messageDraft, scheduleMessageInputResize, uploadedDraftImages.length]);

  useEffect(() => {
    setMessageWindowSize((current) => {
      if (messages.length <= MESSAGE_RENDER_WINDOW) {
        return messages.length;
      }
      return Math.min(current, messages.length);
    });
  }, [messages.length]);

  useEffect(() => {
    if (!session) router.replace("/login");
  }, [router, session]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame: number | null = null;
    const updateViewportHeight = () => {
      const next = Math.round(window.visualViewport?.height ?? window.innerHeight);
      if (!Number.isFinite(next) || next <= 0) return;
      setViewportHeightPx((current) => (current === next ? current : next));
    };

    const scheduleViewportHeightUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateViewportHeight();
      });
    };

    updateViewportHeight();
    window.addEventListener("resize", scheduleViewportHeightUpdate);
    window.addEventListener("orientationchange", scheduleViewportHeightUpdate);
    window.visualViewport?.addEventListener("resize", scheduleViewportHeightUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleViewportHeightUpdate);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", scheduleViewportHeightUpdate);
      window.removeEventListener("orientationchange", scheduleViewportHeightUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleViewportHeightUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleViewportHeightUpdate);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (messageInputResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(messageInputResizeFrameRef.current);
        messageInputResizeFrameRef.current = null;
      }
      if (bottomStickFrameRef.current !== null) {
        window.cancelAnimationFrame(bottomStickFrameRef.current);
        bottomStickFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    refreshNotificationState();
    window.addEventListener("focus", refreshNotificationState);
    return () => {
      window.removeEventListener("focus", refreshNotificationState);
    };
  }, [refreshNotificationState]);

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

        requestAnimationFrame(() => scrollToBottom("auto"));
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

    const hasCache = hydrateMediaCache();
    void fetchMediaItems({ silent: hasCache });
  }, [fetchMediaItems, hydrateMediaCache, showMedia]);

  useEffect(() => {
    if (!showMedia || !mediaHasMore || loadingMedia || loadingMediaMore) return;
    const container = mediaScrollRef.current;
    if (!container) return;
    let requesting = false;

    const onScroll = () => {
      if (requesting) return;
      const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 80;
      if (!nearBottom) return;
      requesting = true;
      void fetchMediaItems({ append: true, silent: true }).finally(() => {
        requesting = false;
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [fetchMediaItems, loadingMedia, loadingMediaMore, mediaHasMore, showMedia]);

  useEffect(() => {
    if (!showMedia || !mediaHasMore || loadingMedia || loadingMediaMore) return;
    const container = mediaScrollRef.current;
    if (!container) return;

    const canScroll = container.scrollHeight > container.clientHeight + 8;
    if (canScroll) return;

    void fetchMediaItems({ append: true, silent: true });
  }, [fetchMediaItems, loadingMedia, loadingMediaMore, mediaHasMore, mediaItems.length, showMedia]);

  useEffect(() => {
    if (!isDeveloperMode) {
      setAdminOverview(null);
      return;
    }

    let cancelled = false;

    const loadOverview = async () => {
      try {
        await fetchAdminOverview();
      } catch (overviewError) {
        if (!cancelled) {
          setError(overviewError instanceof Error ? overviewError.message : "Entwicklerwerkzeuge konnten nicht geladen werden.");
        }
      }
    };

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [fetchAdminOverview, isDeveloperMode]);

  useEffect(() => {
    if (!session) return;

    const stream = new EventSource(`/api/stream?limit=${SNAPSHOT_LIMIT}`);

    const parseEvent = <TValue,>(event: MessageEvent<string>): TValue | null => {
      try {
        return JSON.parse(event.data) as TValue;
      } catch {
        return null;
      }
    };

    const onSnapshot = (event: Event) => {
      const parsed = parseEvent<SnapshotDTO>(event as MessageEvent<string>);
      if (!parsed) return;
      applySnapshot(parsed);
      setError((current) => (current === "Echtzeitverbindung getrennt. Verbinde neu…" ? null : current));
    };

    const onPresenceUpdated = (event: Event) => {
      const parsed = parseEvent<UserPresenceDTO>(event as MessageEvent<string>);
      if (!parsed || isLeavingRef.current) return;
      setUsers((current) => mergeUser(current, parsed));
    };

    const onUserUpdated = (event: Event) => {
      const parsed = parseEvent<UserPresenceDTO>(event as MessageEvent<string>);
      if (!parsed || isLeavingRef.current) return;
      setUsers((current) => mergeUser(current, parsed));
      setMessages((current) => limitVisibleMessages(syncProfilePictureForUser(current, parsed)));
    };

    const onMessageCreated = (event: Event) => {
      const parsed = parseEvent<MessageDTO>(event as MessageEvent<string>);
      if (!parsed || isLeavingRef.current) return;
      applyIncomingMessages([parsed], { notify: true });
    };

    const onPollUpdated = (event: Event) => {
      const parsed = parseEvent<MessageDTO>(event as MessageEvent<string>);
      if (!parsed || isLeavingRef.current) return;
      applyIncomingMessages([parsed], { notify: false });
    };

    const onAiStatus = (event: Event) => {
      const parsed = parseEvent<{ status: string; provider?: "chatgpt" | "grok" }>(event as MessageEvent<string>);
      if (!parsed || isLeavingRef.current) return;
      const status = parsed.status || "online";
      setAiStatus((current) => {
        const nextProvider = parsed.provider || "chatgpt";
        return {
          ...current,
          [nextProvider]: status,
          updatedAt: new Date().toISOString(),
        };
      });
    };

    const onBackgroundUpdated = (event: Event) => {
      const parsed = parseEvent<ChatBackgroundDTO>(event as MessageEvent<string>);
      if (!parsed || isLeavingRef.current) return;
      setChatBackgroundUrl(parsed.url);
    };

    stream.addEventListener("snapshot", onSnapshot);
    stream.addEventListener("presence.updated", onPresenceUpdated);
    stream.addEventListener("user.updated", onUserUpdated);
    stream.addEventListener("message.created", onMessageCreated);
    stream.addEventListener("poll.updated", onPollUpdated);
    stream.addEventListener("ai.status", onAiStatus);
    stream.addEventListener("chat.background.updated", onBackgroundUpdated);
    stream.onerror = () => {
      if (isLeavingRef.current) return;
      setError((current) => current || "Echtzeitverbindung getrennt. Verbinde neu…");
    };

    return () => {
      stream.close();
    };
  }, [applyIncomingMessages, applySnapshot, session]);

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

    const onLoadCapture = () => {
      scheduleBottomStick();
    };

    const observer = new MutationObserver(() => {
      scheduleBottomStick();
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
    previousScrollTopRef.current = element.scrollTop;

    const onScroll = () => {
      const currentScrollTop = element.scrollTop;
      const previousScrollTop = previousScrollTopRef.current;
      previousScrollTopRef.current = currentScrollTop;

      const distanceFromBottom = element.scrollHeight - (currentScrollTop + element.clientHeight);
      const atBottom = distanceFromBottom <= NEAR_BOTTOM_PX;
      isAtBottomRef.current = atBottom;
      setIsAtBottom((current) => (current === atBottom ? current : atBottom));

      const crossedTopThresholdUpward =
        currentScrollTop < TOP_LOAD_TRIGGER_PX &&
        previousScrollTop >= TOP_LOAD_TRIGGER_PX &&
        currentScrollTop < previousScrollTop;

      if (crossedTopThresholdUpward && !loadingOlder) {
        if (messageWindowSize < messages.length) {
          captureScrollAnchor();
          setMessageWindowSize((current) => Math.min(messages.length, current + MESSAGE_RENDER_CHUNK));
          return;
        }

        if (hasMoreOlder) {
          if (messages.length >= MAX_VISIBLE_MESSAGES) return;
          void loadOlderMessages();
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
    element.scrollTop = anchor.top + delta;
    prependAnchorRef.current = null;
  }, [messages]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setComposerOpen(true);
        setComposerMode("message");
        messageInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setShowMedia(false);
        setLightbox(null);
        setMobileSidebarOpen(false);
        setEditingProfile(false);
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
  }, []);

  const updateUser = useCallback(
    async (payload: Omit<RenameUserRequest, "clientId">) => {
      if (!session) return;
      const user = await apiJson<UserPresenceDTO>("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ clientId: session.clientId, ...payload } satisfies RenameUserRequest),
      });

      setUsers((current) => mergeUser(current, user));
      setMessages((current) => limitVisibleMessages(syncProfilePictureForUser(current, user)));

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

  const sendMessage = useCallback(async (payload: CreateMessageRequest) => {
    return apiJson<MessageDTO>("/api/messages", {
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

  const updatePollOptionValue = useCallback((index: number, value: string) => {
    setPollOptions((current) => {
      const next = current.map((option, optionIndex) => (optionIndex === index ? value : option));
      const allFieldsFilled = next.length > 0 && next.every((option) => option.trim().length > 0);

      if (allFieldsFilled && next.length < 15) {
        return [...next, ""];
      }

      return next;
    });
  }, []);

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
        const shouldTriggerAiWorker = hasAiMention(combinedMessage);

        tempMessageId = createTempMessageId();
        appendOptimisticMessage({
          id: tempMessageId,
          authorId: session.clientId,
          type: "message",
          message: combinedMessage,
          username: session.username,
          profilePicture: session.profilePicture,
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
        if (shouldTriggerAiWorker) {
          kickOffAiWorker();
        }
        setReplyTarget(null);
      } else if (composerMode === "question") {
        const content = questionDraft.trim();
        if (!content) return;

        tempMessageId = createTempMessageId();
        appendOptimisticMessage({
          id: tempMessageId,
          authorId: session.clientId,
          type: "question",
          message: content,
          username: session.username,
          profilePicture: session.profilePicture,
          createdAt: new Date().toISOString(),
        });
        startPendingDelivery(tempMessageId);
        setQuestionDraft("");

        const created = await sendMessage({ clientId: session.clientId, type: "question", message: content });
        clearPendingDelivery(tempMessageId);
        removeOptimisticMessage(tempMessageId);
        applyIncomingMessages([created], { notify: false });
      } else if (composerMode === "challenge") {
        const content = challengeDraft.trim();
        if (!content) return;
        const challengeMessage = `ChatPPC Aufgabe: ${content}`;

        tempMessageId = createTempMessageId();
        appendOptimisticMessage({
          id: tempMessageId,
          authorId: session.clientId,
          type: "message",
          message: challengeMessage,
          username: session.username,
          profilePicture: session.profilePicture,
          createdAt: new Date().toISOString(),
        });
        startPendingDelivery(tempMessageId);
        setChallengeDraft("");

        const created = await sendMessage({
          clientId: session.clientId,
          type: "message",
          message: challengeMessage,
        });
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

        tempMessageId = createTempMessageId();
        appendOptimisticMessage({
          id: tempMessageId,
          authorId: session.clientId,
          type: "votingPoll",
          message: question,
          username: session.username,
          profilePicture: session.profilePicture,
          createdAt: new Date().toISOString(),
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
        });
        clearPendingDelivery(tempMessageId);
        removeOptimisticMessage(tempMessageId);
        applyIncomingMessages([created], { notify: false });

        setPollQuestion("");
        setPollOptions(["", ""]);
        setPollMultiSelect(false);
      }

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
    challengeDraft,
    clearPendingDelivery,
    composerMode,
    createTempMessageId,
    messageDraft,
    pollMultiSelect,
    pollOptions,
    pollQuestion,
    questionDraft,
    removeOptimisticMessage,
    replyTarget,
    kickOffAiWorker,
    sendMessage,
    session,
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
        authorId: session.clientId,
        type: "answer",
        message: draft,
        username: session.username,
        profilePicture: session.profilePicture,
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
            profilePicture: session.profilePicture,
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
    [applyIncomingMessages, session],
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
    setComposerMode("message");
    setComposerOpen(true);
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }, []);

  const handleOpenLightbox = useCallback((url: string, alt?: string) => {
    window.requestAnimationFrame(() => {
      setLightbox({ url, alt: alt || "Bildvorschau" });
    });
  }, []);

  const handleRemixImage = useCallback(
    (url: string, alt?: string) => {
      setComposerMode("message");
      setComposerOpen(true);
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
        return prependMention(current, "@chatgpt");
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
    };
  }, []);

  useEffect(() => {
    setLightboxCopyState("idle");
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
    await updateUser({ newUsername: username, profilePicture });
    setProfilePictureDraft(profilePicture);
    setEditingProfile(false);
  }

  async function onProfileImageUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setProfileCropFile(file);
    if (profileUploadRef.current) profileUploadRef.current.value = "";
  }

  async function onProfileCropConfirm(file: File) {
    setUploadingProfile(true);
    try {
      const url = await uploadProfileImage(file);
      setProfilePictureDraft(url);
      setProfileCropFile(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Bild konnte nicht hochgeladen werden.");
    } finally {
      setUploadingProfile(false);
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
      setComposerOpen(true);
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
      setComposerOpen(true);
      setUploadedDraftImages((current) => [...current, ...uploadedItems]);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Bild konnte nicht hochgeladen werden.");
    } finally {
      setUploadingChat(false);
    }
  }

  function onMessageInputPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(
        (file): file is File => file !== null && SUPPORTED_CHAT_UPLOAD_MIME_TYPES.has(file.type),
      );

    if (imageFiles.length === 0) return;
    void onChatImageDrop(imageFiles);
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
    setUploadingBackground(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/uploads/chat", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await readApiError(response, "Upload fehlgeschlagen"));
      const payload = (await response.json()) as UploadResponse;
      await saveChatBackground(payload.url);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Chat-Hintergrund konnte nicht aktualisiert werden.");
    } finally {
      setUploadingBackground(false);
      if (backgroundUploadRef.current) backgroundUploadRef.current.value = "";
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

    clearSession();
    router.replace("/login");
  }

  function finishOnboarding(): void {
    window.localStorage.setItem(ONBOARDING_KEY, "done");
    setShowOnboarding(false);
  }

  async function enableNotificationsFromOnboarding(): Promise<void> {
    await requestNotificationPermission();
    finishOnboarding();
  }

  async function enableNotificationsFromSidebar(): Promise<void> {
    await requestNotificationPermission();
  }

  function openProfileEditor(): void {
    if (!session) return;
    setUsernameDraft(session.username);
    setProfilePictureDraft(session.profilePicture || getDefaultProfilePicture());
    setEditingProfile(true);
  }

  function closeProfileEditor(): void {
    setEditingProfile(false);
  }

  if (!session) return <div className="p-6 text-sm text-slate-500">Wird geladen…</div>;

  return (
    <main
      style={viewportAwareMainStyle}
      className="h-[100dvh] w-screen overflow-hidden bg-[radial-gradient(circle_at_top_right,_#dbeafe_0%,_#f8fafc_45%,_#eff6ff_100%)] [touch-action:manipulation]"
    >
      <div className="grid h-full w-full md:grid-cols-[320px_1fr]">
        <aside className="hidden h-full border-r border-slate-200 bg-white/90 p-4 backdrop-blur md:flex md:flex-col">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <button
              type="button"
              onClick={openProfileEditor}
              className="rounded-full transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              title="Profilbild ändern"
              aria-label="Profilbild ändern"
            >
              <img
                src={session.profilePicture}
                alt={`${session.username} avatar`}
                className="h-14 w-14 rounded-full border border-slate-200 object-cover"
                loading="lazy"
                decoding="async"
              />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{session.username}</p>
              <p className={`text-xs font-medium ${isDeveloperMode ? "text-amber-600" : "text-sky-500"}`}>
                {isDeveloperMode ? "Entwicklermodus" : "online"}
              </p>
            </div>
          </div>
          <button
            className="mt-3 h-10 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700"
            onClick={openProfileEditor}
          >
            Profil bearbeiten
          </button>
          <input
            ref={profileUploadRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void onProfileImageUpload(event.target.files?.[0])}
          />

          <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Geteilter Chat-Hintergrund</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => backgroundUploadRef.current?.click()}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                disabled={uploadingBackground}
              >
                {uploadingBackground ? "Wird hochgeladen…" : "Hintergrund hochladen"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveChatBackground(null).catch(() => {
                    setError("Chat-Hintergrund konnte nicht zurückgesetzt werden.");
                  });
                }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
              >
                Zurücksetzen
              </button>
            </div>
          </div>

          {isDeveloperMode ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Entwicklerwerkzeuge</p>
                <button
                  type="button"
                  onClick={() => setShowAdminPanel((value) => !value)}
                  className="h-7 rounded-lg border border-amber-300 bg-white px-2 text-[11px] font-semibold text-amber-900"
                >
                  {showAdminPanel ? "Ausblenden" : "Öffnen"}
                </button>
              </div>

              {showAdminPanel ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-amber-900">
                    <div className="rounded-lg bg-white px-2 py-1">
                      Nutzer: <span className="font-semibold">{adminOverview?.usersTotal ?? "-"}</span>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-1">
                      Online: <span className="font-semibold">{adminOverview?.usersOnline ?? "-"}</span>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-1">
                      Nachrichten: <span className="font-semibold">{adminOverview?.messagesTotal ?? "-"}</span>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-1">
                      Sperrliste: <span className="font-semibold">{adminOverview?.blacklistTotal ?? "-"}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void fetchAdminOverview()}
                      disabled={adminBusy}
                      className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-900 disabled:opacity-60"
                    >
                      Aktualisieren
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Alle Chat-Nachrichten und Umfragen löschen?")) return;
                        void runAdminAction("delete_all_messages");
                      }}
                      disabled={adminBusy}
                      className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-900 disabled:opacity-60"
                    >
                      Nachrichten löschen
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Alle Nutzer außer dir abmelden?")) return;
                        void runAdminAction("logout_all_users");
                      }}
                      disabled={adminBusy}
                      className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-900 disabled:opacity-60"
                    >
                      Nutzer abmelden
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Sperrliste für Benutzernamen leeren?")) return;
                        void runAdminAction("clear_blacklist");
                      }}
                      disabled={adminBusy}
                      className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-900 disabled:opacity-60"
                    >
                      Sperrliste leeren
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Alles zurücksetzen? Nachrichten, Nutzer und Sperrliste werden gelöscht.")) return;
                        void runAdminAction("reset_all");
                      }}
                      disabled={adminBusy}
                      className="h-8 rounded-lg bg-amber-600 px-3 text-[11px] font-semibold text-white disabled:opacity-60"
                    >
                      Alles zurücksetzen
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={adminTargetUsername}
                        onChange={(event) => setAdminTargetUsername(event.target.value)}
                        placeholder="Benutzername zum Löschen…"
                        className="h-8 flex-1 rounded-lg border border-amber-300 bg-white px-2 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const target = adminTargetUsername.trim();
                          if (!target) return;
                          if (!window.confirm(`Nutzer ${target} löschen?`)) return;
                          void runAdminAction("delete_user", { targetUsername: target });
                        }}
                        disabled={adminBusy}
                        className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-900 disabled:opacity-60"
                      >
                        Nutzer löschen
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={adminTargetMessageId}
                        onChange={(event) => setAdminTargetMessageId(event.target.value)}
                        placeholder="Nachrichten-ID zum Löschen…"
                        className="h-8 flex-1 rounded-lg border border-amber-300 bg-white px-2 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const target = adminTargetMessageId.trim();
                          if (!target) return;
                          if (!window.confirm(`Nachricht ${target} löschen?`)) return;
                          void runAdminAction("delete_message", { targetMessageId: target });
                        }}
                        disabled={adminBusy}
                        className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-900 disabled:opacity-60"
                      >
                        Nachricht löschen
                      </button>
                    </div>
                  </div>

                  {adminNotice ? <p className="text-[11px] font-medium text-amber-900">{adminNotice}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {notificationState !== "granted" ? (
            <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Benachrichtigungen</p>
              <p className="mt-1 text-xs text-slate-600">{describeNotificationState(notificationState)}</p>
              <button
                type="button"
                onClick={() => void enableNotificationsFromSidebar()}
                disabled={notificationState === "unsupported"}
                className="mt-2 h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-60"
              >
                {notificationButtonLabel(notificationState)}
              </button>
            </div>
          ) : null}

	          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
	            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">ChatPPC Online</p>
	            <div className="space-y-2">
              <OnlineUsersList users={onlineUsers} avatarSizeClassName="h-11 w-11" onOpenLightbox={handleOpenLightbox} />
	            </div>
	          </div>
          <button onClick={() => void logout()} className="mt-4 h-10 rounded-xl bg-rose-600 text-sm font-semibold text-white">
            Chat verlassen
          </button>
        </aside>

        <section
          className="relative flex min-h-0 flex-col"
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
          {isDraggingUpload ? (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-sky-500/12 backdrop-blur-[1px]">
              <div className="rounded-2xl border-2 border-dashed border-sky-400 bg-white/95 px-6 py-5 text-center shadow-lg">
                <p className="text-sm font-semibold text-slate-900">Bild zum Hochladen ablegen</p>
                <p className="mt-1 text-xs text-slate-500">PNG, JPG, WEBP, GIF</p>
              </div>
            </div>
          ) : null}
          <header className="flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={openProfileEditor}
                className="rounded-full transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 md:hidden"
                title="Profilbild ändern"
                aria-label="Profilbild ändern"
              >
                <img
                  src={session.profilePicture}
                  alt={`${session.username} avatar`}
                  className="h-10 w-10 rounded-full border border-slate-200 object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900">ChatPPC</h1>
                  {isDeveloperMode ? (
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                      DEV
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">Chatte mit deiner Gruppe. Erwähne @chatgpt oder @grok für KI-Antworten.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 md:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                Personen
              </button>
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                onClick={() => setShowMedia(true)}
              >
                Medien
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pb-40 sm:p-4 sm:pb-44"
          >
            {loadingOlder ? (
              <p className="text-center text-xs text-slate-500">Aeltere Nachrichten werden geladen…</p>
            ) : null}

            <MessageList
              messages={visibleMessages}
              currentUsername={session.username}
              isDeveloperMode={isDeveloperMode}
              pendingDeliveries={pendingDeliveries}
              answerDrafts={answerDrafts}
              onAnswerDraftChange={handleAnswerDraftChange}
              onSubmitAnswer={submitAnswer}
              onVote={handleVote}
              onDeleteMessage={handleDeleteMessage}
              onStartReply={handleStartReply}
              onOpenLightbox={handleOpenLightbox}
              onRemixImage={handleRemixImage}
            />
          </div>

          {!isAtBottom ? (
            <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+12.5rem)] z-50 flex justify-center md:absolute md:bottom-36 md:z-40">
              <button
                type="button"
                className="pointer-events-auto rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg"
                onClick={() => {
                  isAtBottomRef.current = true;
                  setIsAtBottom(true);
                  setMessageWindowSize(Math.min(messages.length, MESSAGE_RENDER_WINDOW));
                  scrollToBottom("smooth");
                }}
              >
                Zu neuesten springen
              </button>
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <div
              className={`pointer-events-auto w-[min(940px,94vw)] rounded-[2rem] border border-white/70 bg-white/90 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur transition-all duration-300 ${
                composerOpen ? "scale-100" : "scale-[0.98]"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {PRIMARY_COMPOSER_MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => {
                      setComposerMode(mode);
                      setComposerOpen(true);
                    }}
                    className={`h-7 rounded-full px-3 text-xs font-semibold transition ${
                      composerMode === mode
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {COMPOSER_MODE_LABEL[mode]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={activateAskChatGpt}
                  className={`h-7 rounded-full px-3 text-xs font-semibold transition ${
                    composerMode === "message" && hasChatGptMention(messageDraft)
                      ? "bg-sky-600 text-white"
                      : "bg-sky-100 text-sky-700 hover:bg-sky-200"
                  }`}
                >
                  ChatGPT fragen
                </button>
                <button
                  type="button"
                  onClick={activateAskGrok}
                  className={`h-7 rounded-full px-3 text-xs font-semibold transition ${
                    composerMode === "message" && hasGrokMention(messageDraft)
                      ? "bg-sky-600 text-white"
                      : "bg-sky-100 text-sky-700 hover:bg-sky-200"
                  }`}
                >
                  Grok fragen
                </button>
                {SECONDARY_COMPOSER_MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => {
                      setComposerMode(mode);
                      setComposerOpen(true);
                    }}
                    className={`h-7 rounded-full px-3 text-xs font-semibold transition ${
                      composerMode === mode
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {COMPOSER_MODE_LABEL[mode]}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => chatUploadRef.current?.click()}
                    disabled={uploadingChat}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                    title="Bild hochladen"
                    aria-label="Bild hochladen"
                  >
                    {uploadingChat ? (
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                    ) : (
                      <span className="text-sm">📎</span>
                    )}
                  </button>
                  <input
                    ref={chatUploadRef}
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => void onChatImageUpload(event.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => void submitComposer()}
                    className="h-7 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800"
                  >
                    Senden
                  </button>
                </div>
              </div>

              {composerMode === "message" ? (
                <div className="space-y-2">
                  {replyTarget ? (
                    <div className="flex items-start justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Antwort auf</p>
                        <p className="truncate text-xs text-slate-700">
                          {replyTarget.username}: {replyTarget.message}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyTarget(null)}
                        className="shrink-0 rounded-lg border border-sky-200 bg-white px-2 py-1 text-[11px] font-semibold text-sky-700"
                      >
                        Entfernen
                      </button>
                    </div>
                  ) : null}

                  {uploadedDraftImages.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {uploadedDraftImages.map((image) => (
                        <DraftImagePreview
                          key={image.id}
                          image={image}
                          onRemove={() =>
                            setUploadedDraftImages((current) =>
                              current.filter((uploadedImage) => uploadedImage.id !== image.id),
                            )
                          }
                        />
                      ))}
                    </div>
                  ) : null}

                  <textarea
                    ref={messageInputRef}
                    value={messageDraft}
                    onFocus={() => setComposerOpen(true)}
                    onChange={handleMessageDraftChange}
                    onPaste={onMessageInputPaste}
                    onKeyDown={(event) => {
                      if (showMentionSuggestions && filteredMentionUsers.length > 0) {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setMentionIndex((index) => (index + 1) % filteredMentionUsers.length);
                          return;
                        }
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setMentionIndex(
                            (index) => (index - 1 + filteredMentionUsers.length) % filteredMentionUsers.length,
                          );
                          return;
                        }
                        if (event.key === "Enter" || event.key === "Tab") {
                          event.preventDefault();
                          const user = filteredMentionUsers[mentionIndex];
                          const selectionStart = messageInputRef.current?.selectionStart || 0;
                          const textBefore = messageDraft.slice(0, selectionStart);
                          const textAfter = messageDraft.slice(selectionStart);
                          const newTextBefore = textBefore.replace(/@(\w*)$/, `@${user.username} `);
                          setMessageDraft(newTextBefore + textAfter);
                          setShowMentionSuggestions(false);
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
                        void submitComposer();
                      }
                    }}
                    placeholder="Nachricht schreiben…"
                    rows={1}
                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  />
                </div>
              ) : null}

              {showMentionSuggestions && filteredMentionUsers.length > 0 && composerMode === "message" ? (
                <div className="absolute bottom-full left-4 mb-2 max-h-40 w-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {filteredMentionUsers.map((user, index) => (
                    <button
                      type="button"
                      key={user.clientId}
                      onClick={() => {
                        const selectionStart = messageInputRef.current?.selectionStart || 0;
                        const textBefore = messageDraft.slice(0, selectionStart);
                        const textAfter = messageDraft.slice(selectionStart);
                        const newTextBefore = textBefore.replace(/@(\w*)$/, `@${user.username} `);
                        setMessageDraft(newTextBefore + textAfter);
                        setShowMentionSuggestions(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                        index === mentionIndex
                          ? "bg-sky-100 text-sky-900"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <img
                        src={user.profilePicture}
                        className="h-5 w-5 rounded-full object-cover"
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="truncate">{user.username}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {composerMode === "question" ? (
                <input
                  value={questionDraft}
                  onFocus={() => setComposerOpen(true)}
                  onChange={(event) => setQuestionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitComposer();
                    }
                  }}
                  placeholder="Stelle deiner Gruppe eine Frage…"
                  className="h-9 w-full rounded-xl border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                />
              ) : null}

              {composerMode === "challenge" ? (
                <input
                  value={challengeDraft}
                  onFocus={() => setComposerOpen(true)}
                  onChange={(event) => setChallengeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitComposer();
                    }
                  }}
                  placeholder="Teile eine Aufgabe…"
                  className="h-9 w-full rounded-xl border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
                />
              ) : null}

              {composerMode === "poll" ? (
                <div className="space-y-2">
                  <input
                    value={pollQuestion}
                    onFocus={() => setComposerOpen(true)}
                    onChange={(event) => setPollQuestion(event.target.value)}
                    placeholder="Umfragefrage…"
                    className="h-9 w-full rounded-xl border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pollOptions.map((option, index) => (
                      <input
                        key={`poll-option-${index}`}
                        value={option}
                        onChange={(event) => updatePollOptionValue(index, event.target.value)}
                        placeholder={`Option ${index + 1}…`}
                        className="h-8 rounded-lg border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPollOptions((current) => (current.length <= 2 ? current : current.slice(0, -1)))
                      }
                      className="h-7 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                    >
                      Option entfernen
                    </button>
                    <label className="ml-2 inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={pollMultiSelect}
                        onChange={(event) => setPollMultiSelect(event.target.checked)}
                      />
                      Mehrfachauswahl
                    </label>
                    <p className="text-xs text-slate-500">
                      Stimmen werden beim Klick sofort aktualisiert und können jederzeit geändert werden.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {error ? (
            <p
              className="absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600"
              aria-live="polite"
            >
              {error}
            </p>
          ) : null}
        </section>
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Panel schließen"
          />
          <div className="absolute right-0 top-0 h-full w-[90vw] max-w-sm overflow-y-auto bg-white p-4 [overscroll-behavior:contain]">
            <button
              className="mb-3 h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
              onClick={() => setMobileSidebarOpen(false)}
            >
              Schließen
            </button>
            <div className="space-y-2">
              <OnlineUsersList users={onlineUsers} avatarSizeClassName="h-9 w-9" onOpenLightbox={handleOpenLightbox} />
            </div>
            {notificationState !== "granted" ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Benachrichtigungen</p>
                <p className="mt-1 text-xs text-slate-600">{describeNotificationState(notificationState)}</p>
                <button
                  type="button"
                  onClick={() => void enableNotificationsFromSidebar()}
                  disabled={notificationState === "unsupported"}
                  className="mt-2 h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-60"
                >
                  {notificationButtonLabel(notificationState)}
                </button>
              </div>
            ) : null}
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Geteilter Chat-Hintergrund</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => backgroundUploadRef.current?.click()}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                  disabled={uploadingBackground}
                >
                  {uploadingBackground ? "Wird hochgeladen…" : "Hintergrund hochladen"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void saveChatBackground(null).catch(() => {
                      setError("Chat-Hintergrund konnte nicht zurückgesetzt werden.");
                    });
                  }}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                >
                  Zurücksetzen
                </button>
              </div>
            </div>
            {isDeveloperMode ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Entwicklerwerkzeuge</p>
                <p className="mt-1 text-[11px] text-amber-900">
                  Öffne die Desktop-Seitenleiste für Zurücksetzen/Löschen/Moderation.
                </p>
                <button
                  type="button"
                  onClick={() => void fetchAdminOverview()}
                  disabled={adminBusy}
                  className="mt-2 h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-900 disabled:opacity-60"
                >
                  Aktualisieren Stats
                </button>
              </div>
            ) : null}
            <button
              onClick={() => void logout()}
              className="mt-4 h-10 w-full rounded-xl bg-rose-600 text-sm font-semibold text-white"
            >
              Chat verlassen
            </button>
          </div>
        </div>
      ) : null}

      {editingProfile ? (
        <div className="fixed inset-0 z-[65] grid place-items-center bg-slate-900/45 p-4" onClick={closeProfileEditor}>
          <div
            className="w-full max-w-2xl rounded-3xl border border-white/70 bg-white/95 p-5 shadow-2xl backdrop-blur sm:p-6"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Profil bearbeiten"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <img
                src={profilePictureDraft || getDefaultProfilePicture()}
                alt="Profilbild-Vorschau"
                className="h-16 w-16 rounded-full border border-slate-200 object-cover"
                loading="lazy"
                decoding="async"
              />
              <div className="min-w-0">
                <p className="truncate text-2xl font-bold leading-tight text-slate-900">{usernameDraft || session.username}</p>
                <p className={`mt-1 text-sm font-medium ${isDeveloperMode ? "text-amber-600" : "text-sky-500"}`}>
                  {isDeveloperMode ? "Entwicklermodus" : "online"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={closeProfileEditor}
              className="mt-4 h-12 w-full rounded-2xl border border-slate-200 bg-white text-base font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Profil schließen
            </button>

            <div className="mt-4 space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <input
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(event.target.value)}
                placeholder="Benutzername…"
                className="h-12 w-full rounded-xl border border-slate-200 px-4 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              />
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <img
                  src={profilePictureDraft || getDefaultProfilePicture()}
                  alt="Profilbild-Vorschau"
                  className="h-16 w-16 rounded-full border border-slate-200 object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <p className="text-sm text-slate-500">Vor dem Speichern Profilbild hochladen und zuschneiden.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => profileUploadRef.current?.click()}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700"
                >
                  {uploadingProfile ? "Wird hochgeladen…" : "Hochladen"}
                </button>
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  className="h-11 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={uploadingProfile}
                >
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
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
          busy={uploadingProfile}
          onCancel={() => setProfileCropFile(null)}
          onConfirm={onProfileCropConfirm}
        />
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/85 p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-h-[92vh] max-w-[92vw]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Bildansicht"
          >
            <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void shareLightboxImage()}
                className="h-9 rounded-full bg-black/65 px-3 text-xs font-semibold text-white"
              >
                Teilen
              </button>
              <button
                type="button"
                onClick={() => void copyLightboxImage()}
                className={`h-9 rounded-full px-3 text-xs font-semibold text-white ${
                  lightboxCopyState === "success"
                    ? "bg-emerald-600/90"
                    : lightboxCopyState === "link"
                      ? "bg-sky-600/90"
                    : lightboxCopyState === "error"
                      ? "bg-rose-600/90"
                      : "bg-black/65"
                }`}
              >
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
                className="h-9 rounded-full bg-black/65 px-3 text-xs font-semibold text-white"
              >
                Herunterladen
              </button>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="h-9 rounded-full bg-black/65 px-3 text-xs font-semibold text-white"
              >
                Schließen
              </button>
            </div>
            <img
              src={lightbox.url}
              alt={lightbox.alt}
              decoding="async"
              className="max-h-[92vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
            />
          </div>
        </div>
      ) : null}

      {showOnboarding ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/55 p-4">
          <div
            className="w-full max-w-xl rounded-3xl border border-white/70 bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Schnellstart"
          >
            <p className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
              Willkommen bei ChatPPC
            </p>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">Schnellstart in 30 Sekunden</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p>1. Schreibe Nachrichten, Fragen und Aufgaben im Composer.</p>
              <p>2. Erstelle Umfragen mit mehreren Optionen und sofortigen Updates.</p>
              <p>3. Teile Bilder und GIFs per Drag-and-drop.</p>
              <p>4. Erwähne <span className="font-semibold text-slate-900">@chatgpt</span> oder <span className="font-semibold text-slate-900">@grok</span>, wenn du KI-Antworten möchtest.</p>
            </div>
            <div className="mt-5 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-900">
              Nächster Schritt: Benachrichtigungen aktivieren, damit du nichts verpasst.
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void enableNotificationsFromOnboarding()}
                disabled={notificationState === "unsupported"}
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {notificationButtonLabel(notificationState)}
              </button>
              <button
                type="button"
                onClick={finishOnboarding}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Jetzt ohne Benachrichtigungen fortfahren
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">{describeNotificationState(notificationState)}</p>
          </div>
        </div>
      ) : null}

      {showMedia ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          onClick={() => setShowMedia(false)}
        >
          <div
            className="w-full max-w-5xl rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Medienansicht"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Medien</h2>
                <p className="text-sm text-slate-500">
                  {loadingMedia && mediaItems.length === 0
                    ? "Vollständige Medienhistorie wird geladen…"
                    : `${mediaTotalCount} Bild${mediaTotalCount === 1 ? "" : "er"} in der Datenbank`}
                </p>
              </div>
              <button
                className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
                onClick={() => setShowMedia(false)}
              >
                Schließen
              </button>
            </div>

            {loadingMedia && mediaItems.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                Medien werden geladen…
              </div>
            ) : mediaItems.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                Noch keine Bilder geteilt.
              </div>
            ) : (
              <div ref={mediaScrollRef} className="max-h-[70vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {mediaItems.map((item) => (
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
                        <p className="text-[10px] text-slate-500">{new Date(item.createdAt).toLocaleString("de-DE")}</p>
                      </div>
                    </button>
                  ))}
                </div>
                {mediaHasMore || loadingMediaMore ? (
                  <div className="mt-3 flex justify-center">
                    <p className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600">
                      {loadingMediaMore ? "Weitere werden geladen…" : "Zum automatischen Nachladen scrollen"}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
