"use client";
/* eslint-disable @next/next/no-img-element */

import { PaperAirplaneIcon, PaperClipIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { UserPresenceDTO } from "@/lib/types";

export type ComposerMode = "message" | "question" | "poll";

interface UploadedDraftImage {
  id: string;
  url: string;
  label: string;
}

interface ReplyTargetState {
  id: string;
  username: string;
  message: string;
}

interface ChatComposerProps {
  composerRef: RefObject<HTMLDivElement | null>;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  chatUploadRef: RefObject<HTMLInputElement | null>;
  mode: ComposerMode;
  messageDraft: string;
  questionDraft: string;
  pollQuestion: string;
  pollOptions: string[];
  pollMultiSelect: boolean;
  pollExtending: boolean;
  pollLockedOptionCount: number;
  uploadedDraftImages: UploadedDraftImage[];
  replyTarget: ReplyTargetState | null;
  uploadingChat: boolean;
  showMentionSuggestions: boolean;
  mentionUsers: UserPresenceDTO[];
  mentionIndex: number;
  hasChatGptMention: boolean;
  hasGrokMention: boolean;
  onModeChange: (mode: ComposerMode) => void;
  onAskChatGpt: () => void;
  onAskGrok: () => void;
  onRemoveReplyTarget: () => void;
  onMessageDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onMessageInputPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onMessageKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onQuestionDraftChange: (value: string) => void;
  onQuestionKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPollQuestionChange: (value: string) => void;
  onPollOptionChange: (index: number, value: string) => void;
  onPollMultiSelectChange: (checked: boolean) => void;
  onRemovePollOption: () => void;
  onCancelPollExtend: () => void;
  onSelectMention: (username: string) => void;
  onRemoveDraftImage: (imageId: string) => void;
  onOpenUpload: () => void;
  onUploadChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
}

const PRIMARY_MODES: ComposerMode[] = ["message", "question", "poll"];

const MODE_LABELS: Record<ComposerMode, string> = {
  message: "Nachricht",
  question: "Frage",
  poll: "Umfrage",
};

function DraftImagePreview({
  image,
  onRemove,
}: {
  image: UploadedDraftImage;
  onRemove: () => void;
}) {
  return (
    <div className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <img
        src={image.url}
        alt={image.label}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-900/80 text-xs text-white group-hover:flex"
        aria-label="Hochgeladenes Bild entfernen"
      >
        <XMarkIcon className="size-3" />
      </button>
    </div>
  );
}

export function ChatComposer({
  composerRef,
  messageInputRef,
  chatUploadRef,
  mode,
  messageDraft,
  questionDraft,
  pollQuestion,
  pollOptions,
  pollMultiSelect,
  pollExtending,
  pollLockedOptionCount,
  uploadedDraftImages,
  replyTarget,
  uploadingChat,
  showMentionSuggestions,
  mentionUsers,
  mentionIndex,
  hasChatGptMention,
  hasGrokMention,
  onModeChange,
  onAskChatGpt,
  onAskGrok,
  onRemoveReplyTarget,
  onMessageDraftChange,
  onMessageInputPaste,
  onMessageKeyDown,
  onQuestionDraftChange,
  onQuestionKeyDown,
  onPollQuestionChange,
  onPollOptionChange,
  onPollMultiSelectChange,
  onRemovePollOption,
  onCancelPollExtend,
  onSelectMention,
  onRemoveDraftImage,
  onOpenUpload,
  onUploadChange,
  onSubmit,
}: ChatComposerProps) {
  return (
    <div ref={composerRef} className="relative rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_35px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PRIMARY_MODES.map((composerMode) => (
          <button
            type="button"
            key={composerMode}
            onClick={() => onModeChange(composerMode)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              mode === composerMode
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {MODE_LABELS[composerMode]}
          </button>
        ))}
        <button
          type="button"
          onClick={onAskChatGpt}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            mode === "message" && hasChatGptMention
              ? "bg-sky-600 text-white"
              : "bg-sky-100 text-sky-700 hover:bg-sky-200"
          }`}
        >
          ChatGPT fragen
        </button>
        <button
          type="button"
          onClick={onAskGrok}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            mode === "message" && hasGrokMention
              ? "bg-sky-600 text-white"
              : "bg-sky-100 text-sky-700 hover:bg-sky-200"
          }`}
        >
          Grok fragen
        </button>
      </div>

      {mode === "message" ? (
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
                onClick={onRemoveReplyTarget}
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
                  onRemove={() => onRemoveDraftImage(image.id)}
                />
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <textarea
              ref={messageInputRef}
              value={messageDraft}
              onChange={onMessageDraftChange}
              onPaste={onMessageInputPaste}
              onKeyDown={onMessageKeyDown}
              placeholder="Nachricht schreiben…"
              rows={1}
              className="max-h-[14rem] min-h-[2.5rem] w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            />
            <button
              type="button"
              onClick={onOpenUpload}
              disabled={uploadingChat}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              aria-label="Bild hochladen"
              title="Bild hochladen"
            >
              {uploadingChat ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
              ) : (
                <PaperClipIcon className="size-5" />
              )}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800"
              aria-label="Senden"
              title="Senden"
            >
              <PaperAirplaneIcon className="size-5" />
            </button>
            <input
              ref={chatUploadRef}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onUploadChange}
            />
          </div>
        </div>
      ) : null}

      {mode === "question" ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
          <input
            value={questionDraft}
            onChange={(event) => onQuestionDraftChange(event.target.value)}
            onKeyDown={onQuestionKeyDown}
            placeholder="Stelle deiner Gruppe eine Frage…"
            className="h-10 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          />
          <button
            type="button"
            onClick={onSubmit}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800"
            aria-label="Senden"
          >
            <PaperAirplaneIcon className="size-5" />
          </button>
        </div>
      ) : null}

      {mode === "poll" ? (
        <div className="space-y-2">
          {replyTarget && !pollExtending ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Antwort auf</p>
                <p className="truncate text-xs text-slate-700">
                  {replyTarget.username}: {replyTarget.message}
                </p>
              </div>
              <button
                type="button"
                onClick={onRemoveReplyTarget}
                className="shrink-0 rounded-lg border border-sky-200 bg-white px-2 py-1 text-[11px] font-semibold text-sky-700"
              >
                Entfernen
              </button>
            </div>
          ) : null}
          {pollExtending ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Bestehende Optionen sind vorausgefüllt. Füge unten neue Optionen hinzu und sende.
            </div>
          ) : null}
          <input
            value={pollQuestion}
            onChange={(event) => onPollQuestionChange(event.target.value)}
            placeholder="Umfragefrage…"
            readOnly={pollExtending}
            className={`h-10 w-full rounded-2xl border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
              pollExtending
                ? "border-slate-200 bg-slate-100 text-slate-500"
                : "border-slate-200 bg-white"
            }`}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {pollOptions.map((option, index) => (
              <input
                key={`poll-option-${index}`}
                value={option}
                onChange={(event) => onPollOptionChange(index, event.target.value)}
                placeholder={`Option ${index + 1}…`}
                readOnly={pollExtending && index < pollLockedOptionCount}
                className={`h-9 rounded-xl border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
                  pollExtending && index < pollLockedOptionCount
                    ? "border-slate-200 bg-slate-100 text-slate-500"
                    : "border-slate-200 bg-white"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <button
              type="button"
              onClick={onRemovePollOption}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
            >
              Option entfernen
            </button>
            <label className="ml-1 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={pollMultiSelect}
                onChange={(event) => onPollMultiSelectChange(event.target.checked)}
                disabled={pollExtending}
              />
              Mehrfachauswahl
            </label>
            {pollExtending ? (
              <button
                type="button"
                onClick={onCancelPollExtend}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
              >
                Abbrechen
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSubmit}
              className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800"
              aria-label={pollExtending ? "Umfrage erweitern" : "Umfrage senden"}
            >
              <PaperAirplaneIcon className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      {showMentionSuggestions && mentionUsers.length > 0 && mode === "message" ? (
        <div className="absolute bottom-[calc(100%+0.5rem)] left-3 z-20 max-h-44 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {mentionUsers.map((user, index) => (
            <button
              type="button"
              key={user.clientId}
              onClick={() => onSelectMention(user.username)}
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
    </div>
  );
}
