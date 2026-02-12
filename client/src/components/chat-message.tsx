"use client";
/* eslint-disable @next/next/no-img-element */

import { memo, useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from "react";
import type { LinkPreviewDTO, MessageDTO } from "@/lib/types";

interface ChatMessageProps {
  message: MessageDTO;
  currentUsername?: string;
  isDeveloperMode?: boolean;
  delivery?: { status: "sending" };
  answerDraft?: string;
  onAnswerDraftChange: (messageId: string, value: string) => void;
  onSubmitAnswer: (messageId: string) => void;
  onVote: (messageId: string, optionIds: string[]) => void;
  onDeleteMessage?: (messageId: string) => void;
  onStartReply?: (message: MessageDTO) => void;
  onOpenLightbox?: (url: string, alt?: string) => void;
  onRemixImage?: (url: string, alt?: string, provider?: "chatgpt" | "grok") => void;
}

const IMAGE_URL_REGEX = /\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i;
const previewCache = new Map<string, LinkPreviewDTO | null>();
const pendingPreviewRequests = new Map<string, Promise<LinkPreviewDTO | null>>();

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSystemPresenceMessage(message: MessageDTO): boolean {
  const content = message.message;
  return (
    message.username === "System" &&
    (content.endsWith(" joined the chat") ||
      content.endsWith(" dem Chat beigetreten") ||
      content.endsWith(" left the chat") ||
      content.endsWith(" hat den Chat verlassen") ||
      content.endsWith(" changed the background image") ||
      content.endsWith(" hat das Hintergrundbild geändert") ||
      content.endsWith(" reset the background image") ||
      content.endsWith(" hat das Hintergrundbild zurückgesetzt") ||
      content.includes(" is now ") ||
      content.includes(" heißt jetzt "))
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
  onStartReply,
  onOpenLightbox,
  onRemixImage,
}: ChatMessageProps) {
  const pollSettings = message.poll?.settings;
  const previewUrls = useMemo(() => extractPreviewUrls(message.message), [message.message]);
  const messageLines = useMemo(() => message.message.split("\n"), [message.message]);
  const viewerUsernameNormalized = currentUsername?.trim().toLowerCase() ?? "";
  const isOwnMessage = viewerUsernameNormalized.length > 0
    && message.username.toLowerCase() === viewerUsernameNormalized;
  const profilePictureAlt = `Profilbild von ${message.username}`;

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
      <div className={`flex w-full ${isOwnMessage ? "justify-end" : "justify-start"} [content-visibility:auto] [contain-intrinsic-size:320px]`}>
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
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold text-slate-900">{message.message}</p>
              <p className="text-sm text-slate-500">Umfrage von {message.username}</p>
              <p className="text-xs text-slate-400">
                {pollSettings?.multiSelect
                  ? "Mehrfachauswahl aktiv - Klick aktualisiert deine Stimme sofort"
                  : "Einzelauswahl - Klick aktualisiert deine Stimme sofort"}
              </p>
            </div>
            <time className="text-xs text-slate-400" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
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
          {isOwnMessage ? (
            <div className="mt-2">
              {delivery?.status === "sending" ? (
                <p className="text-[11px] font-medium text-sky-600">wird gesendet…</p>
              ) : (
                <p className="text-[11px] font-medium text-slate-400">gesendet</p>
              )}
            </div>
          ) : null}
        </article>
      </div>
    );
  }

  if (message.type === "question") {
    return (
      <div className={`flex w-full ${isOwnMessage ? "justify-end" : "justify-start"} [content-visibility:auto] [contain-intrinsic-size:320px]`}>
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
          {isOwnMessage ? (
            <div className="mt-2">
              {delivery?.status === "sending" ? (
                <p className="text-[11px] font-medium text-sky-600">wird gesendet…</p>
              ) : (
                <p className="text-[11px] font-medium text-slate-400">gesendet</p>
              )}
            </div>
          ) : null}
        </article>
      </div>
    );
  }

  const replyContext = Boolean(message.questionId && message.oldmessage && message.oldusername);

  return (
    <div className={`flex w-full ${isOwnMessage ? "justify-end" : "justify-start"} [content-visibility:auto] [contain-intrinsic-size:320px]`}>
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
          {onOpenLightbox ? (
            <button
              type="button"
              onClick={() => onOpenLightbox(message.profilePicture, profilePictureAlt)}
              className="shrink-0 cursor-zoom-in rounded-full transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              aria-label={`${profilePictureAlt} öffnen`}
            >
              <LazyImage
                src={message.profilePicture}
                alt={profilePictureAlt}
                frameClassName="h-16 w-16 rounded-full border-2 border-slate-200 bg-slate-200/80 shadow-sm"
                imageClassName="h-full w-full rounded-full object-cover"
              />
            </button>
          ) : (
            <LazyImage
              src={message.profilePicture}
              alt={profilePictureAlt}
              frameClassName="h-16 w-16 shrink-0 rounded-full border-2 border-slate-200 bg-slate-200/80 shadow-sm"
              imageClassName="h-full w-full rounded-full object-cover"
            />
          )}
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
                      <span className="mt-1 inline-flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => onRemixImage(imageUrl, imageAlt, "chatgpt")}
                          className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                        >
                          Mit @chatgpt remixen
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemixImage(imageUrl, imageAlt, "grok")}
                          className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                        >
                          Mit @grok remixen
                        </button>
                      </span>
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
                          onClick={() => onOpenLightbox?.(url, "Geteilter Inhalt")}
                        >
                          <LazyImage
                            src={url}
                            alt="Geteilter Inhalt"
                            frameClassName="min-h-24 max-w-full rounded-2xl border border-slate-200 bg-slate-100 shadow-sm"
                            imageClassName="block max-h-80 max-w-full rounded-2xl object-contain transition hover:shadow-md"
                          />
                        </button>
                        {onRemixImage ? (
                          <span className="mt-1 inline-flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => onRemixImage(url, "Geteilter Inhalt", "chatgpt")}
                              className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                            >
                              Mit @chatgpt remixen
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemixImage(url, "Geteilter Inhalt", "grok")}
                              className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                            >
                              Mit @grok remixen
                            </button>
                          </span>
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
                  <p className="text-[11px] font-medium text-sky-600">wird gesendet…</p>
                ) : (
                  <p className="text-[11px] font-medium text-slate-400">gesendet</p>
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
