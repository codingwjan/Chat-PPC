"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import type { MessageDTO } from "@/lib/types";

interface ChatMessageProps {
  message: MessageDTO;
  answerDraft?: string;
  onAnswerDraftChange: (messageId: string, value: string) => void;
  onSubmitAnswer: (messageId: string) => void;
  onVote: (messageId: string, optionIds: string[]) => void;
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSystemPresenceMessage(message: MessageDTO): boolean {
  return (
    message.username === "System" &&
    (message.message.endsWith(" joined the chat") || message.message.endsWith(" left the chat"))
  );
}

export function ChatMessage({
  message,
  answerDraft,
  onAnswerDraftChange,
  onSubmitAnswer,
  onVote,
}: ChatMessageProps) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const pollSettings = message.poll?.settings;

  const sortedPollOptions = useMemo(
    () => [...(message.poll?.options || [])].sort((a, b) => b.votes - a.votes),
    [message.poll?.options],
  );

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
    const options = sortedPollOptions;
    const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);

    return (
      <article className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold text-slate-900">{message.message}</p>
            <p className="text-sm text-slate-500">Poll by {message.username}</p>
            <p className="text-xs text-slate-400">
              {pollSettings?.multiSelect ? "Multi-select enabled" : "Single choice"} |{" "}
              {pollSettings?.allowVoteChange ? "Vote changes allowed" : "Vote lock enabled"}
            </p>
          </div>
          <time className="text-xs text-slate-400">{formatTime(message.createdAt)}</time>
        </div>
        <div className="space-y-2">
          {options.map((option) => {
            const checked = selectedOptions.includes(option.id);
            const percentage = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;

            return (
              <button
                key={option.id}
                type="button"
                className={`w-full rounded-xl border p-3 text-left transition ${
                  checked
                    ? "border-sky-400 bg-sky-50"
                    : "border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-sky-50"
                }`}
                onClick={() => {
                  if (pollSettings?.multiSelect) {
                    setSelectedOptions((current) =>
                      current.includes(option.id)
                        ? current.filter((id) => id !== option.id)
                        : [...current, option.id],
                    );
                    return;
                  }
                  setSelectedOptions([option.id]);
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
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
            disabled={selectedOptions.length === 0}
            onClick={() => onVote(message.id, selectedOptions)}
          >
            Submit Vote
          </button>
        </div>
      </article>
    );
  }

  if (message.type === "question") {
    return (
      <article className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 shadow-sm">
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
      </article>
    );
  }

  const answerContext = message.type === "answer" && message.oldmessage && message.oldusername;

  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <img
          className="h-10 w-10 rounded-full border border-slate-200 object-cover"
          src={message.profilePicture}
          alt={`${message.username} avatar`}
          width={40}
          height={40}
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-slate-900">{message.username}</p>
            <time className="text-xs text-slate-400">{formatTime(message.createdAt)}</time>
          </div>
          {answerContext ? (
            <p className="mb-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500">
              In reply to &quot;{message.oldmessage}&quot; by {message.oldusername}
            </p>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{message.message}</p>
        </div>
      </div>
    </article>
  );
}
