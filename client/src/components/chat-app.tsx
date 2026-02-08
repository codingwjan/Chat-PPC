"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "@/components/chat-message";
import { apiJson } from "@/lib/http";
import {
  buildVoteStorageKey,
  clearSession,
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

type ComposerMode = "message" | "question" | "poll";

function mergeUser(users: UserPresenceDTO[], next: UserPresenceDTO): UserPresenceDTO[] {
  const existingIndex = users.findIndex((user) => user.clientId === next.clientId);
  if (existingIndex === -1) {
    return [...users, next];
  }

  const copy = [...users];
  copy[existingIndex] = next;
  return copy;
}

function mergeMessage(messages: MessageDTO[], next: MessageDTO): MessageDTO[] {
  const existingIndex = messages.findIndex((message) => message.id === next.id);

  if (existingIndex === -1) {
    return [...messages, next].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  const copy = [...messages];
  copy[existingIndex] = next;
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
    return {
      ...message,
      profilePicture: user.profilePicture,
    };
  });

  return changed ? nextMessages : messages;
}

async function postTyping(clientId: string, status: string): Promise<void> {
  await apiJson<UserPresenceDTO>("/api/presence/typing", {
    method: "POST",
    body: JSON.stringify({ clientId, status }),
  });
}

export function ChatApp() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);

  const [session, setSession] = useState<SessionState | null>(() => loadSession());
  const [users, setUsers] = useState<UserPresenceDTO[]>([]);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [composerMode, setComposerMode] = useState<ComposerMode>("message");
  const [messageDraft, setMessageDraft] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptionOne, setPollOptionOne] = useState("");
  const [pollOptionTwo, setPollOptionTwo] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [editingUsername, setEditingUsername] = useState(false);
  const [editingProfilePicture, setEditingProfilePicture] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(() => loadSession()?.username || "");
  const [profilePictureDraft, setProfilePictureDraft] = useState(
    () => loadSession()?.profilePicture || "",
  );
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [, setVoteRefresh] = useState(0);

  const onlineUsers = useMemo(
    () => users.filter((user) => user.isOnline).sort((a, b) => a.username.localeCompare(b.username)),
    [users],
  );

  useEffect(() => {
    if (!session) {
      router.replace("/login");
    }
  }, [router, session]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const onResize = () => {
      if (window.innerWidth > 1000) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!session) {
      return;
    }

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

    source.onerror = () => {
      setError("Realtime connection lost. Retrying...");
    };

    return () => {
      source.close();
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const ping = () => {
      apiJson<UserPresenceDTO>("/api/presence/ping", {
        method: "POST",
        body: JSON.stringify({ clientId: session.clientId }),
      }).catch(() => {
        setError("Could not update online presence.");
      });
    };

    ping();
    const interval = setInterval(ping, 5_000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (composerMode === "message") {
      postTyping(session.clientId, "").catch(() => {});
      return;
    }

    const status = composerMode === "poll" ? "creating voting poll..." : "creating question...";
    postTyping(session.clientId, status).catch(() => {});
  }, [composerMode, session]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }

    const container = scrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages, autoScroll]);

  const updateUser = useCallback(
    async (payload: Omit<RenameUserRequest, "clientId">) => {
      if (!session) {
        return;
      }

      const user = await apiJson<UserPresenceDTO>("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          clientId: session.clientId,
          ...payload,
        } satisfies RenameUserRequest),
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

  const renameCurrentUser = useCallback(async () => {
    const nextUsername = usernameDraft.trim();
    if (nextUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    try {
      await updateUser({ newUsername: nextUsername });
      setEditingUsername(false);
      setError(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename user.");
    }
  }, [updateUser, usernameDraft]);

  const saveProfilePicture = useCallback(async () => {
    const nextPicture = profilePictureDraft.trim();
    if (!nextPicture) {
      setError("Profile picture URL is required.");
      return;
    }

    try {
      new URL(nextPicture);
    } catch {
      setError("Profile picture must be a valid URL.");
      return;
    }

    try {
      await updateUser({ profilePicture: nextPicture });
      setEditingProfilePicture(false);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save profile picture.");
    }
  }, [profilePictureDraft, updateUser]);

  const sendMessage = useCallback(async (payload: CreateMessageRequest) => {
    await apiJson<MessageDTO>("/api/messages", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }, []);

  const submitComposer = useCallback(async () => {
    if (!session) {
      return;
    }

    try {
      if (composerMode === "message") {
        const content = messageDraft.trim();
        if (!content) {
          return;
        }

        // Clear immediately for !ai and normal sends.
        setMessageDraft("");
        await sendMessage({
          clientId: session.clientId,
          type: "message",
          message: content,
        });
      }

      if (composerMode === "question") {
        const content = questionDraft.trim();
        if (!content) {
          return;
        }

        await sendMessage({
          clientId: session.clientId,
          type: "question",
          message: content,
        });
        setQuestionDraft("");
        setComposerMode("message");
      }

      if (composerMode === "poll") {
        const question = pollQuestion.trim();
        const optionOne = pollOptionOne.trim();
        const optionTwo = pollOptionTwo.trim();
        if (!question || !optionOne || !optionTwo) {
          setError("Poll question and both options are required.");
          return;
        }

        await sendMessage({
          clientId: session.clientId,
          type: "votingPoll",
          message: question,
          optionOne,
          optionTwo,
        });

        setPollQuestion("");
        setPollOptionOne("");
        setPollOptionTwo("");
        setComposerMode("message");
      }

      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send message.");
    }
  }, [
    composerMode,
    messageDraft,
    pollOptionOne,
    pollOptionTwo,
    pollQuestion,
    questionDraft,
    sendMessage,
    session,
  ]);

  const submitAnswer = useCallback(
    async (questionMessageId: string) => {
      if (!session) {
        return;
      }

      const draft = answerDrafts[questionMessageId]?.trim() || "";
      if (!draft) {
        return;
      }

      try {
        await sendMessage({
          clientId: session.clientId,
          type: "answer",
          message: draft,
          questionId: questionMessageId,
        });

        setAnswerDrafts((current) => ({
          ...current,
          [questionMessageId]: "",
        }));
        setError(null);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Could not submit answer.");
      }
    },
    [answerDrafts, sendMessage, session],
  );

  const handleVote = useCallback(
    async (pollMessageId: string, side: "left" | "right") => {
      if (!session) {
        return;
      }

      const voteKey = buildVoteStorageKey(pollMessageId);
      if (window.localStorage.getItem(voteKey) === "voted") {
        setError("You already voted on this poll in this browser.");
        return;
      }

      try {
        const payload: VotePollRequest = {
          clientId: session.clientId,
          pollMessageId,
          side,
        };

        await apiJson<MessageDTO>("/api/polls/vote", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        window.localStorage.setItem(voteKey, "voted");
        setVoteRefresh((value) => value + 1);
        setError(null);
      } catch (voteError) {
        setError(voteError instanceof Error ? voteError.message : "Could not register vote.");
      }
    },
    [session],
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const targetTag = target?.tagName.toLowerCase();
      const answerId = target?.getAttribute("data-answer-id") || undefined;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setComposerMode("message");
        messageInputRef.current?.focus();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "u") {
        event.preventDefault();
        setComposerMode((mode) => (mode === "poll" ? "message" : "poll"));
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        setComposerMode((mode) => (mode === "question" ? "message" : "question"));
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        if (answerId) {
          event.preventDefault();
          void submitAnswer(answerId);
          return;
        }

        if (targetTag === "input") {
          event.preventDefault();
          void submitComposer();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, submitAnswer, submitComposer]);

  function handleScroll() {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const threshold = 48;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setAutoScroll(isNearBottom);
  }

  function answerDraftFor(messageId: string): string {
    return answerDrafts[messageId] || "";
  }

  function hasVoted(messageId: string): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(buildVoteStorageKey(messageId)) === "voted";
  }

  function logout() {
    setMobileMenuOpen(false);
    clearSession();
    router.replace("/login");
  }

  if (!session) {
    return (
      <div className="App">
        <div style={{ paddingTop: "20vh" }}>Loading session...</div>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="container">
        <div id="chat-sidebar" className={`sideBar${mobileMenuOpen ? " mobileOpen" : ""}`}>
          <div className="sideBarHeader">
            <div className="userIconContainer">
              <img className="userIcon" src={session.profilePicture} alt="user icon" />
            </div>

            <div className="sideBarHeaderRight">
              {editingUsername ? (
                <>
                  <input
                    className="sideBarInlineInput"
                    value={usernameDraft}
                    onChange={(event) => setUsernameDraft(event.target.value)}
                  />
                  <button className="saveUserName" onClick={() => void renameCurrentUser()}>
                    Save Username
                  </button>
                  <button
                    className="cancelUserName"
                    onClick={() => {
                      setUsernameDraft(session.username);
                      setEditingUsername(false);
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div className="userName">{session.username}</div>
                  <button className="changeUserName" onClick={() => setEditingUsername(true)}>
                    Change Username
                  </button>
                </>
              )}

              {editingProfilePicture ? (
                <>
                  <input
                    className="sideBarInlineInput"
                    value={profilePictureDraft}
                    onChange={(event) => setProfilePictureDraft(event.target.value)}
                    placeholder="Profile picture URL"
                  />
                  <button className="saveProfilePicture" onClick={() => void saveProfilePicture()}>
                    Save Picture
                  </button>
                  <button
                    className="cancelProfilePicture"
                    onClick={() => {
                      setProfilePictureDraft(session.profilePicture);
                      setEditingProfilePicture(false);
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button className="changeProfilePicture" onClick={() => setEditingProfilePicture(true)}>
                  Change Profile Picture
                </button>
              )}
            </div>
          </div>

          <div className="seperator" />

          <div className="sideBarBody">
            <div className="sideBarBodyHeader">
              <div className="sideBarTitle">People Online: {onlineUsers.length}</div>
            </div>
            <div className="sideBarBodyContent" id="sideBarBodyContent">
              {onlineUsers.map((user) => (
                <div className="sideBarBodyContentItem" key={user.clientId}>
                  <div className="sideBarBodyContentItemLeft">
                    <img src={user.profilePicture} alt="Avatar" className="userIcon" />
                  </div>
                  <div className="sideBarBodyContentItemRight">
                    <div className="sideBarBodyUserName">{user.username}</div>
                    <div className="sideBarBodyUserStatus">{user.status || "Online"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <footer className="sideBarFooter">
            <div className="sideBarFooterLeft">
              <Link
                href="/impressum"
                className="sideBarFooterLeftItem"
                onClick={() => setMobileMenuOpen(false)}
              >
                Impressum
              </Link>
            </div>
            <div className="sideBarFooterRight">
              <button onClick={logout} className="sideBarFooterRightItem">
                Logout
              </button>
            </div>
          </footer>
        </div>
        <button
          className={`mobileMenuBackdrop${mobileMenuOpen ? " open" : ""}`}
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        />

        <div className="chatWindow">
          <div className="chatWindowHeader">
            <button
              className="mobileMenuButton"
              onClick={() => setMobileMenuOpen((current) => !current)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="chat-sidebar"
            >
              {mobileMenuOpen ? "✕" : "☰"}
            </button>
            <div className="chatWindowHeaderTitle">Chat PPC</div>
            <div className="chatWindowHeaderSubtitle">by ebayboy & cancelcloud</div>
          </div>

          <div id="chatWindowBody" ref={scrollRef} onScroll={handleScroll} className="chatWindowBody">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                answerDraft={answerDraftFor(message.id)}
                onAnswerDraftChange={(messageId, value) =>
                  setAnswerDrafts((current) => ({ ...current, [messageId]: value }))
                }
                onSubmitAnswer={submitAnswer}
                onVote={handleVote}
                hasVoted={hasVoted(message.id)}
              />
            ))}
          </div>

          <div className="chatWindowFooter">
            <div className="chatWindowFooterLeft">
              <button
                className="chatWindowFooterLeftItem"
                style={{ display: composerMode === "poll" ? "none" : "flex" }}
                onClick={() => setComposerMode("poll")}
              >
                P
              </button>
              <button
                className="chatWindowFooterLeftItemHidden"
                style={{ display: composerMode === "poll" ? "flex" : "none" }}
                onClick={() => setComposerMode("message")}
              >
                X
              </button>

              <button
                className="chatWindowFooterLeftItem"
                style={{ display: composerMode === "question" ? "none" : "flex" }}
                onClick={() => setComposerMode("question")}
              >
                Q
              </button>
              <button
                className="chatWindowFooterLeftItemHidden"
                style={{ display: composerMode === "question" ? "flex" : "none" }}
                onClick={() => setComposerMode("message")}
              >
                X
              </button>
            </div>

            <div className="chatWindowFooterCenter">
              <div className="chatWindowFooterCenterItem">
                <input
                  ref={messageInputRef}
                  className="chatWindowFooterCenterItemInput"
                  type="text"
                  style={{ display: composerMode === "message" ? "block" : "none" }}
                  placeholder="Type a message..."
                  value={messageDraft}
                  onFocus={() => {
                    if (session) {
                      postTyping(session.clientId, "typing...").catch(() => {});
                    }
                  }}
                  onBlur={() => {
                    if (session) {
                      postTyping(session.clientId, "").catch(() => {});
                    }
                  }}
                  onChange={(event) => setMessageDraft(event.target.value)}
                />

                <input
                  className="chatWindowFooterCenterItemInputHidden"
                  type="text"
                  style={{ display: composerMode === "question" ? "block" : "none" }}
                  placeholder="Enter a question..."
                  value={questionDraft}
                  onChange={(event) => setQuestionDraft(event.target.value)}
                />

                <input
                  className="chatWindowFooterCenterItemInputHidden"
                  type="text"
                  style={{ display: composerMode === "poll" ? "block" : "none" }}
                  placeholder="Enter a question..."
                  value={pollQuestion}
                  onChange={(event) => setPollQuestion(event.target.value)}
                />
                <input
                  className="chatWindowFooterCenterItemInputHidden"
                  type="text"
                  style={{ display: composerMode === "poll" ? "block" : "none" }}
                  placeholder="Enter option 1..."
                  value={pollOptionOne}
                  onChange={(event) => setPollOptionOne(event.target.value)}
                />
                <input
                  className="chatWindowFooterCenterItemInputHidden"
                  type="text"
                  style={{ display: composerMode === "poll" ? "block" : "none" }}
                  placeholder="Enter option 2..."
                  value={pollOptionTwo}
                  onChange={(event) => setPollOptionTwo(event.target.value)}
                />
              </div>
            </div>

            <div className="chatWindowFooterRight">
              <button
                className="chatWindowFooterRightItem"
                style={{ display: composerMode === "message" ? "flex" : "none" }}
                onClick={() => void submitComposer()}
              >
                ➤
              </button>
              <button
                className="chatWindowFooterRightItemHidden"
                style={{ display: composerMode === "message" ? "none" : "flex" }}
                onClick={() => void submitComposer()}
              >
                ✓
              </button>
            </div>
          </div>

          {error ? <div style={{ color: "#ff8c8c", marginBottom: "10px" }}>{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
