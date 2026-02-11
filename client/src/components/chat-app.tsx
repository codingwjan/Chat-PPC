"use client";
/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "@/components/chat-message";
import { apiJson } from "@/lib/http";
import {
  clearSession,
  getDefaultProfilePicture,
  loadSession,
  saveSession,
  type SessionState,
} from "@/lib/session";
import type {
  CreateMessageRequest,
  MessageDTO,
  RenameUserRequest,
  SnapshotDTO,
  SseEventPayloadMap,
  UserPresenceDTO,
  VotePollRequest,
} from "@/lib/types";

type ComposerMode = "message" | "question" | "poll" | "challenge";

interface UploadResponse {
  url: string;
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

async function uploadProfileImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch("/api/uploads/profile", { method: "POST", body: formData });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Upload failed");
  }
  const payload = (await response.json()) as UploadResponse;
  return payload.url;
}

export function ChatApp() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const profileUploadRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  const [session, setSession] = useState<SessionState | null>(() => loadSession());
  const [users, setUsers] = useState<UserPresenceDTO[]>([]);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("message");

  const [messageDraft, setMessageDraft] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [challengeDraft, setChallengeDraft] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMultiSelect, setPollMultiSelect] = useState(false);
  const [pollAllowVoteChange, setPollAllowVoteChange] = useState(false);

  const [editingProfile, setEditingProfile] = useState(false);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(() => loadSession()?.username || "");
  const [profilePictureDraft, setProfilePictureDraft] = useState(
    () => loadSession()?.profilePicture || getDefaultProfilePicture(),
  );

  const onlineUsers = useMemo(
    () => users.filter((user) => user.isOnline).sort((a, b) => a.username.localeCompare(b.username)),
    [users],
  );

  useEffect(() => {
    if (!session) router.replace("/login");
  }, [router, session]);

  useEffect(() => {
    if (!session) return;

    const source = new EventSource("/api/stream");

    const onSnapshot = (event: MessageEvent<string>) => {
      const snapshot = JSON.parse(event.data) as SnapshotDTO;
      setUsers(snapshot.users);
      setMessages(snapshot.messages);
    };

    const onPresence = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SseEventPayloadMap["presence.updated"];
      setUsers((current) => mergeUser(current, payload));
    };

    const onUser = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SseEventPayloadMap["user.updated"];
      setUsers((current) => mergeUser(current, payload));
      setMessages((current) => syncProfilePictureForUser(current, payload));

      if (payload.clientId === session.clientId) {
        const nextSession = {
          ...session,
          username: payload.username,
          profilePicture: payload.profilePicture,
        };
        setSession(nextSession);
        setUsernameDraft(payload.username);
        setProfilePictureDraft(payload.profilePicture);
        saveSession(nextSession);
      }
    };

    const onMessage = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SseEventPayloadMap["message.created"];
      setMessages((current) => mergeMessage(current, payload));
    };

    const onPoll = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SseEventPayloadMap["poll.updated"];
      setMessages((current) => mergeMessage(current, payload));
    };

    source.addEventListener("snapshot", onSnapshot as EventListener);
    source.addEventListener("presence.updated", onPresence as EventListener);
    source.addEventListener("user.updated", onUser as EventListener);
    source.addEventListener("message.created", onMessage as EventListener);
    source.addEventListener("poll.updated", onPoll as EventListener);
    source.onerror = () => setError("Realtime connection lost. Retrying…");

    return () => source.close();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const ping = () => {
      apiJson<UserPresenceDTO>("/api/presence/ping", {
        method: "POST",
        body: JSON.stringify({ clientId: session.clientId }),
      }).catch(() => setError("Could not update online presence."));
    };
    ping();
    const interval = setInterval(ping, 5_000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const onPageHide = () => {
      navigator.sendBeacon(
        "/api/presence/logout",
        new Blob([JSON.stringify({ clientId: session.clientId })], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setComposerOpen(true);
        setComposerMode("message");
        messageInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setShowShortcuts(false);
        setMobileSidebarOpen(false);
      }
      if (event.key === "?" && !["input", "textarea"].includes((event.target as HTMLElement)?.tagName?.toLowerCase())) {
        event.preventDefault();
        setShowShortcuts((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  const updateUser = useCallback(
    async (payload: Omit<RenameUserRequest, "clientId">) => {
      if (!session) return;
      const user = await apiJson<UserPresenceDTO>("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ clientId: session.clientId, ...payload } satisfies RenameUserRequest),
      });
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
    await apiJson<MessageDTO>("/api/messages", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }, []);

  const submitComposer = useCallback(async () => {
    if (!session) return;
    try {
      if (composerMode === "message") {
        const content = messageDraft.trim();
        if (!content) return;
        setMessageDraft("");
        await sendMessage({ clientId: session.clientId, type: "message", message: content });
      }

      if (composerMode === "question") {
        const content = questionDraft.trim();
        if (!content) return;
        await sendMessage({ clientId: session.clientId, type: "question", message: content });
        setQuestionDraft("");
      }

      if (composerMode === "challenge") {
        const content = challengeDraft.trim();
        if (!content) return;
        await sendMessage({
          clientId: session.clientId,
          type: "message",
          message: `Class Challenge: ${content}`,
        });
        setChallengeDraft("");
      }

      if (composerMode === "poll") {
        const question = pollQuestion.trim();
        const options = pollOptions.map((option) => option.trim()).filter(Boolean);
        if (!question) {
          setError("Poll question is required.");
          return;
        }
        if (options.length < 2) {
          setError("At least two poll options are required.");
          return;
        }
        if (options.length > 15) {
          setError("Poll supports up to 15 options.");
          return;
        }

        await sendMessage({
          clientId: session.clientId,
          type: "votingPoll",
          message: question,
          pollOptions: options,
          pollMultiSelect,
          pollAllowVoteChange,
        });

        setPollQuestion("");
        setPollOptions(["", ""]);
        setPollMultiSelect(false);
        setPollAllowVoteChange(false);
      }

      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send message.");
    }
  }, [
    challengeDraft,
    composerMode,
    messageDraft,
    pollAllowVoteChange,
    pollMultiSelect,
    pollOptions,
    pollQuestion,
    questionDraft,
    sendMessage,
    session,
  ]);

  const submitAnswer = useCallback(
    async (questionMessageId: string) => {
      if (!session) return;
      const draft = answerDrafts[questionMessageId]?.trim() || "";
      if (!draft) return;
      await sendMessage({
        clientId: session.clientId,
        type: "answer",
        message: draft,
        questionId: questionMessageId,
      });
      setAnswerDrafts((current) => ({ ...current, [questionMessageId]: "" }));
    },
    [answerDrafts, sendMessage, session],
  );

  const handleVote = useCallback(
    async (pollMessageId: string, optionIds: string[]) => {
      if (!session) return;
      try {
        const payload: VotePollRequest = {
          clientId: session.clientId,
          pollMessageId,
          optionIds,
        };
        await apiJson<MessageDTO>("/api/polls/vote", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } catch (voteError) {
        setError(voteError instanceof Error ? voteError.message : "Could not register vote.");
      }
    },
    [session],
  );

  async function saveProfile() {
    const username = usernameDraft.trim();
    const profilePicture = profilePictureDraft.trim() || getDefaultProfilePicture();
    if (username.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    await updateUser({ newUsername: username, profilePicture });
    setProfilePictureDraft(profilePicture);
    setEditingProfile(false);
  }

  async function onProfileImageUpload(file: File | undefined) {
    if (!file) return;
    setUploadingProfile(true);
    try {
      const url = await uploadProfileImage(file);
      setProfilePictureDraft(url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload image.");
    } finally {
      setUploadingProfile(false);
      if (profileUploadRef.current) profileUploadRef.current.value = "";
    }
  }

  async function logout() {
    if (session) {
      await fetch("/api/presence/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: session.clientId }),
        keepalive: true,
      }).catch(() => {});
    }
    clearSession();
    router.replace("/login");
  }

  if (!session) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <main className="h-[100dvh] w-screen overflow-hidden bg-[radial-gradient(circle_at_top_right,_#dbeafe_0%,_#f8fafc_45%,_#eff6ff_100%)] [touch-action:manipulation]">
      <div className="grid h-full w-full md:grid-cols-[300px_1fr]">
        <aside className="hidden h-full border-r border-slate-200 bg-white/90 p-4 backdrop-blur md:flex md:flex-col">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <img src={session.profilePicture} alt={`${session.username} avatar`} className="h-11 w-11 rounded-full border border-slate-200 object-cover" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{session.username}</p>
              <p className="text-xs text-slate-500">Online</p>
            </div>
          </div>
          <button
            className="mt-3 h-10 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700"
            onClick={() => setEditingProfile((value) => !value)}
          >
            {editingProfile ? "Close Profile" : "Edit Profile"}
          </button>
          {editingProfile ? (
            <div className="mt-3 space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <input
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(event.target.value)}
                placeholder="Username…"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              />
              <input
                value={profilePictureDraft}
                onChange={(event) => setProfilePictureDraft(event.target.value)}
                placeholder="Avatar URL…"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => profileUploadRef.current?.click()}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                >
                  {uploadingProfile ? "Uploading…" : "Upload"}
                </button>
                <input
                  ref={profileUploadRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => void onProfileImageUpload(event.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white"
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Class Online</p>
            <div className="space-y-2">
              {onlineUsers.map((user) => (
                <div key={user.clientId} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
                  <img src={user.profilePicture} alt={`${user.username} avatar`} className="h-8 w-8 rounded-full border border-slate-200 object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{user.username}</p>
                    <p className="truncate text-xs text-slate-500">{user.status || "online"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => void logout()} className="mt-4 h-10 rounded-xl bg-rose-600 text-sm font-semibold text-white">
            Leave Chat
          </button>
        </aside>

        <section className="relative flex min-h-0 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Class Chat Bot</h1>
              <p className="text-xs text-slate-500">Use /ai, /roll, /coin, /help</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 md:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                People
              </button>
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                onClick={() => setShowShortcuts(true)}
              >
                Shortcuts
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pb-40 sm:p-4 sm:pb-44"
          >
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                answerDraft={answerDrafts[message.id] || ""}
                onAnswerDraftChange={(messageId, value) =>
                  setAnswerDrafts((current) => ({ ...current, [messageId]: value }))
                }
                onSubmitAnswer={submitAnswer}
                onVote={handleVote}
              />
            ))}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <div
              className={`pointer-events-auto w-[min(940px,94vw)] rounded-[2rem] border border-white/70 bg-white/90 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur transition-all duration-300 ${
                composerOpen ? "scale-100" : "scale-[0.98]"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {(["message", "question", "poll", "challenge"] as ComposerMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setComposerMode(mode);
                      setComposerOpen(true);
                    }}
                    className={`h-8 rounded-full px-3 text-xs font-semibold capitalize transition ${
                      composerMode === mode
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {composerMode === "message" ? (
                <textarea
                  ref={messageInputRef}
                  value={messageDraft}
                  onFocus={() => setComposerOpen(true)}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitComposer();
                    }
                  }}
                  placeholder="Type a message… Try /ai explain photosynthesis"
                  rows={composerOpen ? 3 : 1}
                  className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                />
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
                  placeholder="Ask your class a question…"
                  className="h-11 w-full rounded-2xl border border-slate-200 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
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
                  placeholder="Post a class challenge…"
                  className="h-11 w-full rounded-2xl border border-slate-200 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
                />
              ) : null}

              {composerMode === "poll" ? (
                <div className="space-y-2">
                  <input
                    value={pollQuestion}
                    onFocus={() => setComposerOpen(true)}
                    onChange={(event) => setPollQuestion(event.target.value)}
                    placeholder="Poll question…"
                    className="h-11 w-full rounded-2xl border border-slate-200 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pollOptions.map((option, index) => (
                      <input
                        key={`poll-option-${index}`}
                        value={option}
                        onChange={(event) =>
                          setPollOptions((current) =>
                            current.map((value, i) => (i === index ? event.target.value : value)),
                          )
                        }
                        placeholder={`Option ${index + 1}…`}
                        className="h-10 rounded-xl border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPollOptions((current) => (current.length >= 15 ? current : [...current, ""]))
                      }
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                    >
                      Add Option
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPollOptions((current) => (current.length <= 2 ? current : current.slice(0, -1)))
                      }
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                    >
                      Remove Option
                    </button>
                    <label className="ml-2 inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={pollMultiSelect}
                        onChange={(event) => setPollMultiSelect(event.target.checked)}
                      />
                      Multi select
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={pollAllowVoteChange}
                        onChange={(event) => setPollAllowVoteChange(event.target.checked)}
                      />
                      Allow vote changes
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => void submitComposer()}
                  className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white"
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          {error ? (
            <p className="absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600" aria-live="polite">
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
            aria-label="Close panel"
          />
          <div className="absolute right-0 top-0 h-full w-[90vw] max-w-sm overflow-y-auto bg-white p-4 [overscroll-behavior:contain]">
            <button
              className="mb-3 h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
              onClick={() => setMobileSidebarOpen(false)}
            >
              Close
            </button>
            <div className="space-y-2">
              {onlineUsers.map((user) => (
                <div key={user.clientId} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
                  <img src={user.profilePicture} alt={`${user.username} avatar`} className="h-8 w-8 rounded-full border border-slate-200 object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{user.username}</p>
                    <p className="truncate text-xs text-slate-500">{user.status || "online"}</p>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => void logout()} className="mt-4 h-10 w-full rounded-xl bg-rose-600 text-sm font-semibold text-white">
              Leave Chat
            </button>
          </div>
        </div>
      ) : null}

      {showShortcuts ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setShowShortcuts(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900">Shortcuts</h2>
            <p className="mt-2 text-sm text-slate-600">Cmd/Ctrl + K opens the message bubble quickly.</p>
            <p className="text-sm text-slate-600">Type /ai, /roll, /coin, or /help in message mode.</p>
            <button className="mt-4 h-10 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white" onClick={() => setShowShortcuts(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
