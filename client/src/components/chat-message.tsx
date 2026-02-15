"use client";
/* eslint-disable @next/next/no-img-element */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { getDefaultProfilePicture } from "@/lib/default-avatar";
import type { LinkPreviewDTO, MessageDTO, ReactionType } from "@/lib/types";

interface ChatMessageProps {
  message: MessageDTO;
  currentUserId?: string;
  currentUsername?: string;
  isDeveloperMode?: boolean;
  delivery?: { status: "sending" };
  answerDraft?: string;
  onAnswerDraftChange: (messageId: string, value: string) => void;
  onSubmitAnswer: (messageId: string) => void;
  onVote: (messageId: string, optionIds: string[]) => void;
  onExtendPoll?: (message: MessageDTO) => void;
  onDeleteMessage?: (messageId: string) => void;
  onStartReply?: (message: MessageDTO) => void;
  onReact?: (messageId: string, reaction: ReactionType) => void;
  onOpenLightbox?: (url: string, alt?: string) => void;
  onRemixImage?: (url: string, alt?: string) => void;
}

const IMAGE_URL_REGEX = /\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i;
const DEFAULT_INLINE_IMAGE_ASPECT_RATIO = 4 / 3;
const previewCache = new Map<string, LinkPreviewDTO | null>();
const pendingPreviewRequests = new Map<string, Promise<LinkPreviewDTO | null>>();
const imageAspectRatioCache = new Map<string, number>();
const DEFAULT_PROFILE_PICTURE = getDefaultProfilePicture();
const REACTION_OPTIONS: Array<{ reaction: ReactionType; emoji: string; label: string }> = [
  { reaction: "LOL", emoji: "😂", label: "LOL" },
  { reaction: "FIRE", emoji: "🔥", label: "FIRE" },
  { reaction: "BASED", emoji: "🫡", label: "BASED" },
  { reaction: "WTF", emoji: "💀", label: "WTF" },
  { reaction: "BIG_BRAIN", emoji: "🧠", label: "BIG BRAIN" },
];
const AI_ASSISTANT_USERNAMES = new Set(["chatgpt", "grok"]);

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSystemJoinMessage(message: MessageDTO): boolean {
  if (message.username !== "System") return false;
  const content = message.message.trim().toLowerCase();
  return content.endsWith("joined the chat") || content.endsWith("ist dem chat beigetreten");
}

function normalizeSharedUrl(raw: string): string {
  return raw.replace(/[),.!?;:]+$/, "");
}

function isImageUrl(url: string): boolean {
  return IMAGE_URL_REGEX.test(url);
}

function extractPreviewUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/gi) || [];
  const unique = new Set<string>();

  for (const match of matches) {
    const normalized = normalizeSharedUrl(match);
    if (!normalized || isImageUrl(normalized)) continue;
    unique.add(normalized);
  }

  return [...unique];
}

function normalizeProfilePictureUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return DEFAULT_PROFILE_PICTURE;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return DEFAULT_PROFILE_PICTURE;
  }
}

function normalizeTaggingImageUrlCandidate(raw: string): string {
  return raw.trim().replace(/[),.!?;:]+$/, "");
}

type ScoredTag = NonNullable<MessageDTO["tagging"]>["messageTags"][number];

function TagChip({ tag }: { tag: ScoredTag }) {
  return (
    <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
      {tag.tag}
      <span className="ml-1 text-[9px] text-slate-500">{Math.round(tag.score * 100)}%</span>
    </span>
  );
}

function TaggingBlock({
  title,
  tags,
  limit,
}: {
  title: string;
  tags: ScoredTag[];
  limit?: number;
}) {
  const visibleTags = limit ? tags.slice(0, limit) : tags;
  if (visibleTags.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="flex flex-wrap gap-1">
        {visibleTags.map((tag) => (
          <TagChip key={`${title}-${tag.tag}`} tag={tag} />
        ))}
      </div>
    </div>
  );
}

function MessageTaggingPanel({ message }: { message: MessageDTO }) {
  const tagging = message.tagging;
  if (!tagging) return null;

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Tagging</p>
        <p className="text-[10px] text-amber-700">
          {tagging.provider}/{tagging.model} · {tagging.status}
        </p>
      </div>
      {tagging.status === "pending" || tagging.status === "processing" ? (
        <p className="text-[11px] text-amber-700">Tags werden generiert…</p>
      ) : null}
      {tagging.status === "failed" ? (
        <p className="text-[11px] text-rose-700">{tagging.error || "Tagging fehlgeschlagen."}</p>
      ) : null}
      {tagging.status === "completed" ? (
        <div className="space-y-2">
          <TaggingBlock title="Message Tags" tags={tagging.messageTags} />
          <TaggingBlock title="Themes" tags={tagging.categories.themes} limit={8} />
          <TaggingBlock title="Humor" tags={tagging.categories.humor} limit={8} />
          <TaggingBlock title="Art" tags={tagging.categories.art} limit={8} />
          <TaggingBlock title="Tone" tags={tagging.categories.tone} limit={8} />
          <TaggingBlock title="Topics" tags={tagging.categories.topics} limit={8} />
        </div>
      ) : null}
    </div>
  );
}

function getImageTagging(message: MessageDTO, imageUrl: string): NonNullable<MessageDTO["tagging"]>["images"][number] | undefined {
  const normalized = normalizeTaggingImageUrlCandidate(imageUrl);
  return message.tagging?.images.find(
    (image) => normalizeTaggingImageUrlCandidate(image.imageUrl) === normalized,
  );
}

function MessageReactionBar({
  message,
  onReact,
  centered,
  showSummary = true,
}: {
  message: MessageDTO;
  onReact?: (messageId: string, reaction: ReactionType) => void;
  centered?: boolean;
  showSummary?: boolean;
}) {
  if (!onReact) return null;
  const reactions = message.reactions;
  if (!reactions) return null;

  const summary = new Map(reactions.summary.map((entry) => [entry.reaction, entry.count]));
  const userSummary = new Map(
    reactions.summary.map((entry) => [entry.reaction, entry.users.map((user) => user.username)]),
  );
  const chips = REACTION_OPTIONS
    .map((option) => ({
      ...option,
      count: summary.get(option.reaction) || 0,
    }))
    .filter((option) => option.count > 0);

  return (
    <div className={`mt-3 space-y-1.5 ${centered ? "flex flex-col items-center" : ""}`}>
      <div className={`flex flex-wrap gap-1.5 ${centered ? "justify-center" : ""}`}>
        {REACTION_OPTIONS.map((option) => {
          const selected = reactions.viewerReaction === option.reaction;
          return (
            <button
              key={option.reaction}
              type="button"
              onClick={() => onReact(message.id, option.reaction)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition ${
                selected
                  ? "border-sky-400 bg-sky-100 text-sky-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"
              }`}
            >
              <span>{option.emoji}</span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {showSummary && chips.length > 0 ? (
        <div className={`space-y-1 ${centered ? "w-full max-w-fit" : ""}`}>
          <div className={`flex flex-wrap gap-1 ${centered ? "justify-center" : ""}`}>
            {chips.map((chip) => (
              <span
                key={`count-${chip.reaction}`}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600"
              >
                <span>{chip.emoji}</span>
                <span>{chip.count}</span>
              </span>
            ))}
          </div>
          <div className={`space-y-0.5 ${centered ? "text-center" : ""}`}>
            {chips.map((chip) => {
              const names = userSummary.get(chip.reaction) || [];
              if (names.length === 0) return null;
              return (
                <p key={`names-${chip.reaction}`} className="text-[10px] text-slate-500">
                  {chip.emoji} {chip.label}: {names.join(", ")}
                </p>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewDTO | null> {
  if (previewCache.has(url)) {
    return previewCache.get(url) ?? null;
  }
  if (pendingPreviewRequests.has(url)) {
    return pendingPreviewRequests.get(url) ?? null;
  }

  const request = (async () => {
    try {
      const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        previewCache.set(url, null);
        return null;
      }
      const payload = (await response.json()) as LinkPreviewDTO;
      previewCache.set(url, payload);
      return payload;
    } catch {
      previewCache.set(url, null);
      return null;
    } finally {
      pendingPreviewRequests.delete(url);
    }
  })();

  pendingPreviewRequests.set(url, request);
  return request;
}

interface LazyImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "className" | "alt"> {
  alt: string;
  frameClassName: string;
  imageClassName: string;
  pulseClassName?: string;
  frameStyle?: CSSProperties;
}

function LazyImage({
  alt,
  frameClassName,
  imageClassName,
  pulseClassName,
  frameStyle,
  onLoad,
  onError,
  loading,
  decoding,
  ...imgProps
}: LazyImageProps) {
  const srcKey = String(imgProps.src ?? "");
  const [imageState, setImageState] = useState<{ src: string; loaded: boolean }>({
    src: srcKey,
    loaded: false,
  });
  const loaded = imageState.src === srcKey && imageState.loaded;

  const revealImage = useCallback(() => {
    setImageState((current) => {
      if (current.src === srcKey && current.loaded) {
        return current;
      }
      return { src: srcKey, loaded: true };
    });
  }, [srcKey]);

  const handleImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node || !node.complete) return;
      if (node.naturalWidth <= 0 || node.naturalHeight <= 0) return;
      revealImage();
    },
    [revealImage],
  );

  return (
    <div className={`relative overflow-hidden ${frameClassName}`} style={frameStyle}>
      {!loaded ? (
        <div
          className={`absolute inset-0 animate-pulse ${pulseClassName || "bg-slate-200/80"}`}
          aria-hidden
        />
      ) : null}
      <img
        ref={handleImageRef}
        {...imgProps}
        alt={alt}
        loading={loading ?? "lazy"}
        decoding={decoding ?? "async"}
        onLoad={(event) => {
          onLoad?.(event);
          revealImage();
        }}
        onError={(event) => {
          onError?.(event);
          revealImage();
        }}
        className={`${imageClassName} transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

interface InlineSharedImageProps {
  src: string;
  alt: string;
  imageTagging?: NonNullable<MessageDTO["tagging"]>["images"][number];
  taggingStatus?: NonNullable<MessageDTO["tagging"]>["status"];
  isDeveloperMode?: boolean;
  onOpenLightbox?: (url: string, alt?: string) => void;
  onRemixImage?: (url: string, alt?: string) => void;
}

function InlineSharedImage({
  src,
  alt,
  imageTagging,
  taggingStatus,
  isDeveloperMode,
  onOpenLightbox,
  onRemixImage,
}: InlineSharedImageProps) {
  const [aspectRatio, setAspectRatio] = useState<number>(() => {
    const cached = imageAspectRatioCache.get(src);
    return cached && Number.isFinite(cached) && cached > 0 ? cached : DEFAULT_INLINE_IMAGE_ASPECT_RATIO;
  });

  const handleImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    if (!element.naturalWidth || !element.naturalHeight) return;
    const measuredRatio = element.naturalWidth / element.naturalHeight;
    if (!Number.isFinite(measuredRatio) || measuredRatio <= 0) return;
    imageAspectRatioCache.set(src, measuredRatio);
    setAspectRatio((current) => (Math.abs(current - measuredRatio) < 0.01 ? current : measuredRatio));
  }, [src]);

  return (
    <span className="my-3 inline-flex w-full max-w-full flex-col items-start gap-1">
      <button
        type="button"
        className="inline-block w-full max-w-[min(78vw,24rem)] cursor-zoom-in"
        onClick={() => onOpenLightbox?.(src, alt)}
      >
        <LazyImage
          src={src}
          alt={alt}
          frameClassName="w-full rounded-2xl border border-slate-200 bg-slate-200/70 shadow-sm"
          frameStyle={{ aspectRatio }}
          imageClassName="h-full w-full rounded-2xl object-cover transition hover:shadow-md"
          pulseClassName="bg-slate-300/80"
          onLoad={handleImageLoad}
        />
      </button>
      {onRemixImage ? (
        <span className="mt-1 inline-flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onRemixImage(src, alt)}
            className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
          >
            Mit @chatgpt remixen
          </button>
        </span>
      ) : null}
      {isDeveloperMode ? (
        <span className="mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/70 p-2">
          {imageTagging ? (
            <>
              <TaggingBlock title="Image Tags" tags={imageTagging.tags} />
              <TaggingBlock title="Objects" tags={imageTagging.categories.objects} limit={8} />
              <TaggingBlock title="Themes" tags={imageTagging.categories.themes} limit={8} />
              <TaggingBlock title="Humor" tags={imageTagging.categories.humor} limit={8} />
              <TaggingBlock title="Art" tags={imageTagging.categories.art} limit={8} />
              <TaggingBlock title="Tone" tags={imageTagging.categories.tone} limit={8} />
            </>
          ) : taggingStatus === "pending" || taggingStatus === "processing" ? (
            <p className="text-[11px] text-amber-700">Bild-Tags werden generiert…</p>
          ) : taggingStatus === "failed" ? (
            <p className="text-[11px] text-rose-700">Bild-Tags fehlgeschlagen.</p>
          ) : (
            <p className="text-[11px] text-slate-500">Keine Bild-Tags vorhanden.</p>
          )}
        </span>
      ) : null}
    </span>
  );
}

function LinkPreviewCard({ url }: { url: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [preview, setPreview] = useState<LinkPreviewDTO | null>(null);

  useEffect(() => {
    if (!ref.current || isVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setIsVisible(true);
      },
      { rootMargin: "150px" },
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    let active = true;
    void fetchLinkPreview(url).then((payload) => {
      if (!active) return;
      setPreview(payload);
    });
    return () => {
      active = false;
    };
  }, [isVisible, url]);

  if (!preview) {
    return <a ref={ref} href={url} className="hidden" />;
  }

  return (
    <a
      ref={ref}
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition hover:border-sky-300 hover:bg-sky-50"
    >
      {preview.image ? (
        <LazyImage
          src={preview.image}
          alt={preview.title || preview.hostname}
          frameClassName="h-36 w-full bg-slate-200/80"
          imageClassName="h-full w-full object-cover"
        />
      ) : null}
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 text-sm font-semibold text-slate-900">
          {preview.title || preview.siteName || preview.hostname}
        </p>
        {preview.description ? (
          <p className="line-clamp-2 text-xs text-slate-600">{preview.description}</p>
        ) : null}
        <p className="text-xs text-slate-500">{preview.hostname}</p>
      </div>
    </a>
  );
}

function MessageAvatar({
  src,
  alt,
  onOpenLightbox,
}: {
  src: string;
  alt: string;
  onOpenLightbox?: (url: string, alt?: string) => void;
}) {
  const normalizedSrc = useMemo(() => normalizeProfilePictureUrl(src), [src]);
  const [failed, setFailed] = useState(false);

  const activeSrc = failed ? DEFAULT_PROFILE_PICTURE : normalizedSrc;
  const isFallback = failed || activeSrc === DEFAULT_PROFILE_PICTURE;

  if (onOpenLightbox && !isFallback) {
    return (
      <button
        type="button"
        onClick={() => onOpenLightbox(activeSrc, alt)}
        className="shrink-0 cursor-zoom-in rounded-full transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        aria-label={`${alt} öffnen`}
      >
        <LazyImage
          src={activeSrc}
          alt={alt}
          frameClassName="h-16 w-16 rounded-full border-2 border-slate-200 bg-slate-200/80 shadow-sm"
          imageClassName="h-full w-full rounded-full object-cover"
          onError={() => setFailed(true)}
        />
      </button>
    );
  }

  return (
    <LazyImage
      src={activeSrc}
      alt={alt}
      frameClassName="h-16 w-16 shrink-0 rounded-full border-2 border-slate-200 bg-slate-200/80 shadow-sm"
      imageClassName="h-full w-full rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function ChatMessageComponent({
  message,
  currentUserId,
  currentUsername,
  isDeveloperMode,
  delivery,
  answerDraft,
  onAnswerDraftChange,
  onSubmitAnswer,
  onVote,
  onExtendPoll,
  onDeleteMessage,
  onStartReply,
  onReact,
  onOpenLightbox,
  onRemixImage,
}: ChatMessageProps) {
  const pollSettings = message.poll?.settings;
  const previewUrls = useMemo(() => extractPreviewUrls(message.message), [message.message]);
  const messageLines = useMemo(() => message.message.split("\n"), [message.message]);
  const viewerUsernameNormalized = currentUsername?.trim().toLowerCase() ?? "";
  const isOwnMessage = (Boolean(currentUserId) && message.authorId === currentUserId)
    || (viewerUsernameNormalized.length > 0 && message.username.toLowerCase() === viewerUsernameNormalized);
  const isAiReplyToOwnMessage = viewerUsernameNormalized.length > 0
    && AI_ASSISTANT_USERNAMES.has(message.username.trim().toLowerCase())
    && message.oldusername?.trim().toLowerCase() === viewerUsernameNormalized;
  const isRightAligned = isOwnMessage || isAiReplyToOwnMessage;
  const profilePictureAlt = `Profilbild von ${message.username}`;

  if (message.username === "System") {
    if (!isSystemJoinMessage(message)) return null;
    return (
      <div className="py-2">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <p className="rounded-full border border-slate-200 bg-white px-3 py-1 text-base font-medium text-slate-700">
            {message.message}
          </p>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="mt-2 flex justify-center">
          <MessageReactionBar message={message} onReact={onReact} centered showSummary={false} />
        </div>
      </div>
    );
  }

  if (message.type === "votingPoll") {
    const options = message.poll?.options || [];
    const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);

    return (
      <div className={`flex w-full ${isRightAligned ? "justify-end" : "justify-start"} [content-visibility:auto] [contain-intrinsic-size:320px]`}>
        <article
          data-message-id={message.id}
          className={`w-full max-w-[min(92vw,42rem)] rounded-2xl border p-4 shadow-sm ${isOwnMessage
            ? "border-sky-200 bg-sky-50/80"
            : "border-sky-100 bg-white"
            }`}
        >
          {isDeveloperMode && onDeleteMessage ? (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => onDeleteMessage(message.id)}
                className="h-7 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                aria-label="Nachricht löschen"
              >
                Löschen
              </button>
            </div>
          ) : null}
          <div className="mb-3 flex items-start gap-3">
            <MessageAvatar
              key={`poll-${message.id}:${message.profilePicture}`}
              src={message.profilePicture}
              alt={profilePictureAlt}
              onOpenLightbox={onOpenLightbox}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-900">{message.message}</p>
                  <p className="text-sm text-slate-500">Umfrage von {message.username}</p>
                </div>
                <time className="shrink-0 text-xs text-slate-400" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
              </div>
              {onExtendPoll ? (
                <button
                  type="button"
                  onClick={() => onExtendPoll(message)}
                  className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                >
                  Umfrage erweitern
                </button>
              ) : null}
              <p className="text-xs text-slate-400">
                {pollSettings?.multiSelect
                  ? "Mehrfachauswahl aktiv - Klick aktualisiert deine Stimme sofort"
                  : "Einzelauswahl - Klick aktualisiert deine Stimme sofort"}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {options.map((option) => {
              const voterNames = option.voters.map((voter) => voter.username);
              const checked = Boolean(viewerUsernameNormalized)
                && voterNames.some((name) => name.toLowerCase() === viewerUsernameNormalized);
              const percentage = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={`w-full rounded-xl border p-3 text-left transition ${checked
                    ? "border-sky-400 bg-sky-50"
                    : "border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-sky-50"
                    }`}
                  onClick={() => {
                    if (pollSettings?.multiSelect) {
                      const selectedByCurrent = options
                        .filter((entry) =>
                          Boolean(viewerUsernameNormalized)
                          && entry.voters.some((voter) => voter.username.toLowerCase() === viewerUsernameNormalized),
                        )
                        .map((entry) => entry.id);
                      const nextSelection = selectedByCurrent.includes(option.id)
                        ? selectedByCurrent.filter((id) => id !== option.id)
                        : [...selectedByCurrent, option.id];
                      if (nextSelection.length === 0) return;
                      onVote(message.id, nextSelection);
                      return;
                    }
                    onVote(message.id, [option.id]);
                  }}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{option.label}</span>
                    <span className="text-xs text-slate-500">
                      {option.votes} Stimme{option.votes === 1 ? "" : "n"}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-sky-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {voterNames.length > 0 ? `Abgestimmt: ${voterNames.join(", ")}` : "Noch keine Stimmen"}
                  </div>
                </button>
              );
            })}
          </div>
          <MessageReactionBar message={message} onReact={onReact} />
          {isOwnMessage ? (
            <div className="mt-2">
              {delivery?.status === "sending" ? (
                <p className="text-[11px] font-medium text-sky-600">wird gesendet…</p>
              ) : (
                <p className="text-[11px] font-medium text-slate-400">gesendet</p>
              )}
            </div>
          ) : null}
          {isDeveloperMode ? <MessageTaggingPanel message={message} /> : null}
        </article>
      </div>
    );
  }

  if (message.type === "question") {
    return (
      <div className={`flex w-full ${isRightAligned ? "justify-end" : "justify-start"} [content-visibility:auto] [contain-intrinsic-size:320px]`}>
        <article
          data-message-id={message.id}
          className={`w-full max-w-[min(92vw,42rem)] rounded-2xl border p-4 shadow-sm ${isOwnMessage
            ? "border-amber-200 bg-amber-50"
            : "border-amber-100 bg-amber-50/70"
            }`}
        >
          {isDeveloperMode && onDeleteMessage ? (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => onDeleteMessage(message.id)}
                className="h-7 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                aria-label="Nachricht löschen"
              >
                Löschen
              </button>
            </div>
          ) : null}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold text-slate-900">{message.message}</p>
              <p className="text-sm text-slate-500">Frage von {message.username}</p>
            </div>
            <time className="text-xs text-slate-400" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm transition focus:border-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              placeholder="Deine Antwort…"
              value={answerDraft || ""}
              data-answer-id={message.id}
              onChange={(event) => onAnswerDraftChange(message.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitAnswer(message.id);
                }
              }}
              type="text"
              name={`answer_${message.id}`}
              autoComplete="off"
            />
            <button
              className="h-11 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700"
              onClick={() => onSubmitAnswer(message.id)}
              type="button"
            >
              Antworten
            </button>
          </div>
          <MessageReactionBar message={message} onReact={onReact} />
          {isOwnMessage ? (
            <div className="mt-2">
              {delivery?.status === "sending" ? (
                <p className="text-[11px] font-medium text-sky-600">wird gesendet…</p>
              ) : (
                <p className="text-[11px] font-medium text-slate-400">gesendet</p>
              )}
            </div>
          ) : null}
          {isDeveloperMode ? <MessageTaggingPanel message={message} /> : null}
        </article>
      </div>
    );
  }

  const replyContext = Boolean(message.questionId && message.oldmessage && message.oldusername);

  return (
    <div className={`flex w-full ${isRightAligned ? "justify-end" : "justify-start"} [content-visibility:auto] [contain-intrinsic-size:320px]`}>
      <article
        data-message-id={message.id}
        className={`max-w-[min(92vw,44rem)] rounded-2xl border p-4 shadow-sm ${isOwnMessage
          ? "bg-sky-50/80 border-sky-200"
          : "border-slate-100 bg-white"
          }`}
      >
        {isDeveloperMode && onDeleteMessage ? (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => onDeleteMessage(message.id)}
              className="h-7 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
              aria-label="Nachricht löschen"
            >
              Löschen
            </button>
          </div>
        ) : null}
        <div className="flex items-start gap-3">
          <MessageAvatar
            key={`${message.id}:${message.profilePicture}`}
            src={message.profilePicture}
            alt={profilePictureAlt}
            onOpenLightbox={onOpenLightbox}
          />
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold text-slate-900">{message.username}</p>
              <time className="text-xs text-slate-400" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
              {onStartReply ? (
                <button
                  type="button"
                  onClick={() => onStartReply(message)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-sky-200 hover:text-sky-700"
                >
                  Antworten
                </button>
              ) : null}
            </div>
            {replyContext ? (
              <p className="mb-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500">
                Antwort auf &quot;{message.oldmessage}&quot; von {message.oldusername}
              </p>
            ) : null}
            {messageLines.map((line, i) => {
              // Check for markdown image syntax first (e.g. from AI)
              const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
              if (imgMatch) {
                const imageAlt = imgMatch[1] || "Geteiltes Bild";
                const imageUrl = imgMatch[2];
                return (
                  <InlineSharedImage
                    key={`${i}-${imageUrl}`}
                    src={imageUrl}
                    alt={imageAlt}
                    imageTagging={getImageTagging(message, imageUrl)}
                    taggingStatus={message.tagging?.status}
                    isDeveloperMode={isDeveloperMode}
                    onOpenLightbox={onOpenLightbox}
                    onRemixImage={onRemixImage}
                  />
                );
              }

              // Split line by URLs, @mentions, and text
              const parts = line.split(/(\s+)/);
              const content = parts.map((part, j) => {
                // URL detection
                const urlMatch = part.match(/^(https?:\/\/[^\s$.?#].[^\s]*)$/i);
                if (urlMatch) {
                  const url = urlMatch[1];
                  // Check if it's an image/GIF
                  if (isImageUrl(url)) {
                    return (
                      <InlineSharedImage
                        key={`${i}-${j}-${url}`}
                        src={url}
                        alt="Geteilter Inhalt"
                        imageTagging={getImageTagging(message, url)}
                        taggingStatus={message.tagging?.status}
                        isDeveloperMode={isDeveloperMode}
                        onOpenLightbox={onOpenLightbox}
                        onRemixImage={onRemixImage}
                      />
                    );
                  }
                  return (
                    <a
                      key={`${i}-${j}`}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-sky-600 underline decoration-sky-300 decoration-2 underline-offset-2 transition hover:text-sky-700 hover:decoration-sky-400"
                    >
                      {url}
                    </a>
                  );
                }

                // @username detection
                const mentionMatch = part.match(/^@(\w+)$/);
                if (mentionMatch) {
                  const username = mentionMatch[1];
                  return (
                    <span
                      key={`${i}-${j}`}
                      className={`inline-block rounded-md px-1.5 py-0.5 text-sm font-bold ring-1 ${username.toLowerCase() === "everyone" || username.toLowerCase() === "me"
                        ? "bg-amber-100 text-amber-700 ring-amber-200"
                        : "bg-sky-100 text-sky-700 ring-sky-200"
                        }`}
                    >
                      @{username}
                    </span>
                  );
                }

                return part;
              });

              return (
                <p
                  key={i}
                  className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700"
                >
                  {content}
                </p>
              );
            })}
            {previewUrls.length > 0 ? (
              <div className="space-y-2">
                {previewUrls.map((url) => (
                  <LinkPreviewCard key={url} url={url} />
                ))}
              </div>
            ) : null}
            <MessageReactionBar message={message} onReact={onReact} />
            {isOwnMessage ? (
              <div className="mt-2">
                {delivery?.status === "sending" ? (
                  <p className="text-[11px] font-medium text-sky-600">wird gesendet…</p>
                ) : (
                  <p className="text-[11px] font-medium text-slate-400">gesendet</p>
                )}
              </div>
            ) : null}
            {isDeveloperMode ? <MessageTaggingPanel message={message} /> : null}
          </div>
        </div>
      </article>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageComponent);
