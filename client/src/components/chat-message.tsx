"use client";
/* eslint-disable @next/next/no-img-element */

import { memo, useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from "react";
import type { LinkPreviewDTO, MessageDTO } from "@/lib/types";

interface ChatMessageProps {
  message: MessageDTO;
  currentUsername?: string;
  isDeveloperMode?: boolean;
  delivery?: { status: "sending"; progress: number };
  answerDraft?: string;
  onAnswerDraftChange: (messageId: string, value: string) => void;
  onSubmitAnswer: (messageId: string) => void;
  onVote: (messageId: string, optionIds: string[]) => void;
  onDeleteMessage?: (messageId: string) => void;
  onOpenLightbox?: (url: string, alt?: string) => void;
  onRemixImage?: (url: string, alt?: string) => void;
}

const IMAGE_URL_REGEX = /\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i;
const previewCache = new Map<string, LinkPreviewDTO | null>();
const pendingPreviewRequests = new Map<string, Promise<LinkPreviewDTO | null>>();

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSystemPresenceMessage(message: MessageDTO): boolean {
  return (
    message.username === "System" &&
    (message.message.endsWith(" joined the chat") ||
      message.message.endsWith(" left the chat") ||
      message.message.endsWith(" reset the background image") ||
      message.message.includes(" is now "))
  );
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
}

function LazyImage({
  alt,
  frameClassName,
  imageClassName,
  pulseClassName,
  onLoad,
  onError,
  loading,
  decoding,
  ...imgProps
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`relative overflow-hidden ${frameClassName}`}>
      {!loaded ? (
        <div
          className={`absolute inset-0 animate-pulse ${pulseClassName || "bg-slate-200/80"}`}
          aria-hidden
        />
      ) : null}
      <img
        {...imgProps}
        alt={alt}
        loading={loading ?? "lazy"}
        decoding={decoding ?? "async"}
        onLoad={(event) => {
          setLoaded(true);
          onLoad?.(event);
        }}
        onError={(event) => {
          setLoaded(true);
          onError?.(event);
        }}
        className={`${imageClassName} transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
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

function ChatMessageComponent({
  message,
  currentUsername,
  isDeveloperMode,
  delivery,
  answerDraft,
  onAnswerDraftChange,
  onSubmitAnswer,
  onVote,
  onDeleteMessage,
  onOpenLightbox,
  onRemixImage,
}: ChatMessageProps) {
  const pollSettings = message.poll?.settings;
  const previewUrls = useMemo(() => extractPreviewUrls(message.message), [message.message]);
  const viewerUsernameNormalized = currentUsername?.trim().toLowerCase() ?? "";
  const isOwnMessage = viewerUsernameNormalized.length > 0
    && message.username.toLowerCase() === viewerUsernameNormalized;

  if (isSystemPresenceMessage(message)) {
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-slate-200" />
        <p className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
          {message.message}
        </p>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
    );
  }

  if (message.type === "votingPoll") {
    const options = message.poll?.options || [];
    const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);

    return (
      <div className={`flex w-full ${isOwnMessage ? "justify-end" : "justify-start"}`}>
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
                aria-label="Delete message"
              >
                Delete
              </button>
            </div>
          ) : null}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold text-slate-900">{message.message}</p>
              <p className="text-sm text-slate-500">Poll by {message.username}</p>
              <p className="text-xs text-slate-400">
                {pollSettings?.multiSelect
                  ? "Multi-select enabled - click updates your vote immediately"
                  : "Single choice - click updates your vote immediately"}
              </p>
            </div>
            <time className="text-xs text-slate-400">{formatTime(message.createdAt)}</time>
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
                      {option.votes} vote{option.votes === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-sky-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {voterNames.length > 0 ? `Voted by: ${voterNames.join(", ")}` : "No votes yet"}
                  </div>
                </button>
              );
            })}
          </div>
          {isOwnMessage ? (
            <div className="mt-2">
              {delivery?.status === "sending" ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-sky-600">
                    sending {Math.max(0, Math.min(100, Math.round(delivery.progress)))}%
                  </p>
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all duration-200"
                      style={{ width: `${Math.max(2, Math.min(100, delivery.progress))}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[11px] font-medium text-slate-400">sent</p>
              )}
            </div>
          ) : null}
        </article>
      </div>
    );
  }

  if (message.type === "question") {
    return (
      <div className={`flex w-full ${isOwnMessage ? "justify-end" : "justify-start"}`}>
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
                aria-label="Delete message"
              >
                Delete
              </button>
            </div>
          ) : null}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold text-slate-900">{message.message}</p>
              <p className="text-sm text-slate-500">Question from {message.username}</p>
            </div>
            <time className="text-xs text-slate-400">{formatTime(message.createdAt)}</time>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm transition focus:border-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              placeholder="Share your answer…"
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
              Reply
            </button>
          </div>
          {isOwnMessage ? (
            <div className="mt-2">
              {delivery?.status === "sending" ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-sky-600">
                    sending {Math.max(0, Math.min(100, Math.round(delivery.progress)))}%
                  </p>
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all duration-200"
                      style={{ width: `${Math.max(2, Math.min(100, delivery.progress))}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[11px] font-medium text-slate-400">sent</p>
              )}
            </div>
          ) : null}
        </article>
      </div>
    );
  }

  const answerContext = message.type === "answer" && message.oldmessage && message.oldusername;

  return (
    <div className={`flex w-full ${isOwnMessage ? "justify-end" : "justify-start"}`}>
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
              aria-label="Delete message"
            >
              Delete
            </button>
          </div>
        ) : null}
        <div className="flex items-start gap-3">
          <LazyImage
            src={message.profilePicture}
            alt={`${message.username} avatar`}
            frameClassName="h-16 w-16 shrink-0 rounded-full border-2 border-slate-200 bg-slate-200/80 shadow-sm"
            imageClassName="h-full w-full rounded-full object-cover"
          />
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold text-slate-900">{message.username}</p>
              <time className="text-xs text-slate-400">{formatTime(message.createdAt)}</time>
            </div>
            {answerContext ? (
              <p className="mb-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500">
                In reply to &quot;{message.oldmessage}&quot; by {message.oldusername}
              </p>
            ) : null}
            {message.message.split("\n").map((line, i) => {
              // Check for markdown image syntax first (e.g. from AI)
              const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
              if (imgMatch) {
                const imageAlt = imgMatch[1] || "Shared image";
                const imageUrl = imgMatch[2];
                return (
                  <span key={i} className="my-3 inline-flex flex-col items-start gap-1">
                    <button
                      type="button"
                      className="inline-block cursor-zoom-in"
                      onClick={() => onOpenLightbox?.(imageUrl, imageAlt)}
                    >
                      <LazyImage
                        src={imageUrl}
                        alt={imageAlt}
                        frameClassName="min-h-24 max-w-full rounded-2xl border border-slate-200 bg-slate-100 shadow-sm"
                        imageClassName="block max-h-80 max-w-full rounded-2xl object-contain transition hover:shadow-md"
                      />
                    </button>
                    {onRemixImage ? (
                      <button
                        type="button"
                        onClick={() => onRemixImage(imageUrl, imageAlt)}
                        className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                      >
                        Remix with @chatgpt
                      </button>
                    ) : null}
                  </span>
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
                      <span key={`${i}-${j}`} className="my-3 inline-flex flex-col items-start gap-1">
                        <button
                          type="button"
                          className="inline-block cursor-zoom-in"
                          onClick={() => onOpenLightbox?.(url, "Shared content")}
                        >
                          <LazyImage
                            src={url}
                            alt="Shared content"
                            frameClassName="min-h-24 max-w-full rounded-2xl border border-slate-200 bg-slate-100 shadow-sm"
                            imageClassName="block max-h-80 max-w-full rounded-2xl object-contain transition hover:shadow-md"
                          />
                        </button>
                        {onRemixImage ? (
                          <button
                            type="button"
                            onClick={() => onRemixImage(url, "Shared content")}
                            className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                          >
                            Remix with @chatgpt
                          </button>
                        ) : null}
                      </span>
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
            {isOwnMessage ? (
              <div className="mt-2">
                {delivery?.status === "sending" ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-sky-600">
                      sending {Math.max(0, Math.min(100, Math.round(delivery.progress)))}%
                    </p>
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-all duration-200"
                        style={{ width: `${Math.max(2, Math.min(100, delivery.progress))}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] font-medium text-slate-400">sent</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageComponent);
