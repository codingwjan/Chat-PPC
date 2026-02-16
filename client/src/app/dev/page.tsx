"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/http";
import { clearSession, loadSession, type SessionState } from "@/lib/session";
import type {
  AdminActionRequest,
  AdminActionResponse,
  AdminOverviewDTO,
  AdminResetUserPasswordResponse,
  AdminUserListItemDTO,
  AdminUserListResponseDTO,
  DeveloperUserTasteListDTO,
  MemberRank,
  MessageDTO,
  MessagePageDTO,
} from "@/lib/types";

interface AdminLogEntry {
  id: string;
  createdAt: string;
  username: string;
  message: string;
}

const RANK_OPTIONS: MemberRank[] = ["BRONZE", "SILBER", "GOLD", "PLATIN"];

function memberLabel(rank: MemberRank): string {
  if (rank === "SILBER") return "Silber";
  if (rank === "GOLD") return "Gold";
  if (rank === "PLATIN") return "Platin";
  return "Bronze";
}

function toAdminLogEntries(messages: MessageDTO[]): AdminLogEntry[] {
  return messages
    .slice()
    .reverse()
    .filter((message) => message.username.trim().toLowerCase() === "system")
    .slice(0, 80)
    .map((message) => ({
      id: message.id,
      createdAt: message.createdAt,
      username: message.username,
      message: message.message,
    }));
}

export default function DevPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(() => loadSession());
  const [overview, setOverview] = useState<AdminOverviewDTO | null>(null);
  const [users, setUsers] = useState<AdminUserListItemDTO[]>([]);
  const [tastes, setTastes] = useState<DeveloperUserTasteListDTO["items"]>([]);
  const [logEntries, setLogEntries] = useState<AdminLogEntry[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
  const [rankDrafts, setRankDrafts] = useState<Record<string, MemberRank>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [messageIdDraft, setMessageIdDraft] = useState("");
  const [targetUsernameDraft, setTargetUsernameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [submittingPassword, setSubmittingPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canUseDevPage = Boolean(session?.clientId && session?.devMode && session?.devAuthToken);

  const mergedUsers = useMemo(() => {
    const tasteByUserId = new Map(tastes.map((item) => [item.userId, item]));
    return users
      .map((user) => ({
        ...user,
        taste: tasteByUserId.get(user.userId),
      }))
      .sort((a, b) => {
        const scoreA = a.member?.score ?? 0;
        const scoreB = b.member?.score ?? 0;
        return scoreB - scoreA || a.username.localeCompare(b.username, "de", { sensitivity: "base" });
      });
  }, [tastes, users]);

  const fetchOverview = useCallback(async (): Promise<void> => {
    if (!session?.clientId || !session.devAuthToken) return;
    const searchParams = new URLSearchParams({
      clientId: session.clientId,
      devAuthToken: session.devAuthToken,
    });
    const next = await apiJson<AdminOverviewDTO>(`/api/admin?${searchParams.toString()}`, { cache: "no-store" });
    setOverview(next);
  }, [session?.clientId, session?.devAuthToken]);

  const fetchUsers = useCallback(async (): Promise<void> => {
    if (!session?.clientId || !session.devAuthToken) return;
    const searchParams = new URLSearchParams({
      clientId: session.clientId,
      devAuthToken: session.devAuthToken,
    });
    const next = await apiJson<AdminUserListResponseDTO>(`/api/admin/users?${searchParams.toString()}`, {
      cache: "no-store",
    });
    setUsers(next.items);
    setScoreDrafts((current) => {
      const merged = { ...current };
      for (const item of next.items) {
        if (merged[item.userId] !== undefined) continue;
        merged[item.userId] = String(item.member?.score ?? 0);
      }
      return merged;
    });
    setRankDrafts((current) => {
      const merged = { ...current };
      for (const item of next.items) {
        if (merged[item.userId]) continue;
        merged[item.userId] = item.member?.rank ?? "BRONZE";
      }
      return merged;
    });
  }, [session?.clientId, session?.devAuthToken]);

  const fetchTastes = useCallback(async (): Promise<void> => {
    if (!session?.clientId || !session.devAuthToken) return;
    const searchParams = new URLSearchParams({
      clientId: session.clientId,
      devAuthToken: session.devAuthToken,
      limit: "200",
    });
    const next = await apiJson<DeveloperUserTasteListDTO>(`/api/admin/tastes?${searchParams.toString()}`, {
      cache: "no-store",
    });
    setTastes(next.items);
  }, [session?.clientId, session?.devAuthToken]);

  const fetchLogs = useCallback(async (): Promise<void> => {
    if (!session?.clientId) return;
    const searchParams = new URLSearchParams({
      clientId: session.clientId,
      limit: "120",
    });
    const next = await apiJson<MessagePageDTO>(`/api/messages?${searchParams.toString()}`, { cache: "no-store" });
    setLogEntries(toAdminLogEntries(next.messages));
  }, [session?.clientId]);

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([
      fetchOverview(),
      fetchUsers(),
      fetchTastes(),
      fetchLogs(),
    ]);
  }, [fetchLogs, fetchOverview, fetchTastes, fetchUsers]);

  useEffect(() => {
    const current = loadSession();
    setSession(current);

    if (!current) {
      router.replace("/login");
      return;
    }

    if (!current.devMode || !current.devAuthToken) {
      router.replace("/chat");
      return;
    }

    setLoading(true);
    setError(null);
    void refreshAll()
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : "Dev-Menü konnte nicht geladen werden.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [refreshAll, router]);

  const runAction = useCallback(
    async (
      action: AdminActionRequest["action"],
      options?: {
        targetUserId?: string;
        targetUsername?: string;
        targetMessageId?: string;
        targetScore?: number;
        targetRank?: MemberRank;
      },
    ): Promise<void> => {
      if (!session?.clientId || !session.devAuthToken) {
        setError("Entwicklermodus ist nicht aktiv.");
        return;
      }
      setSubmittingAction(action);
      setError(null);
      setNotice(null);
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
        };
        const response = await apiJson<AdminActionResponse>("/api/admin", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setOverview(response.overview);
        setNotice(response.message);
        await Promise.all([fetchUsers(), fetchTastes(), fetchLogs()]);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Admin-Aktion fehlgeschlagen.");
      } finally {
        setSubmittingAction(null);
      }
    },
    [fetchLogs, fetchTastes, fetchUsers, session?.clientId, session?.devAuthToken],
  );

  async function resetPassword(user: AdminUserListItemDTO): Promise<void> {
    if (!session?.clientId || !session.devAuthToken) {
      setError("Entwicklermodus ist nicht aktiv.");
      return;
    }
    const draft = (passwordDrafts[user.userId] || "").trim();
    if (draft.length < 8) {
      setError("Das neue Passwort muss mindestens 8 Zeichen haben.");
      return;
    }
    setSubmittingPassword(user.userId);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        clientId: session.clientId,
        devAuthToken: session.devAuthToken,
        targetUserId: user.userId,
        newPassword: draft,
      };
      const response = await apiJson<AdminResetUserPasswordResponse>("/api/admin/users/reset-password", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setPasswordDrafts((current) => ({ ...current, [user.userId]: "" }));
      setNotice(response.message);

      if (session.id === user.userId) {
        await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {
          // best effort
        });
        clearSession();
        router.replace("/login");
        return;
      }

      await refreshAll();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Passwort konnte nicht zurückgesetzt werden.");
    } finally {
      setSubmittingPassword(null);
    }
  }

  if (!canUseDevPage) {
    return (
      <main className="brand-surface min-h-[100svh] p-6">
        <div className="glass-panel-strong mx-auto max-w-6xl rounded-xl p-6">
          <p className="text-sm text-slate-700">Entwicklermodus ist nicht aktiv.</p>
          <Link href="/chat" className="mt-3 inline-block text-sm font-semibold text-sky-700">
            Zurück zum Chat
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="brand-surface min-h-[100svh] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="glass-panel-strong rounded-2xl p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Dev Menu</h1>
              <p className="text-sm text-slate-600">Admin-Bereich für Nutzer, Scores, Ränge, Interessen und Logs.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  void refreshAll()
                    .catch((refreshError) => {
                      setError(refreshError instanceof Error ? refreshError.message : "Aktualisieren fehlgeschlagen.");
                    })
                    .finally(() => {
                      setLoading(false);
                    });
                }}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Aktualisieren
              </button>
              <Link
                href="/chat"
                className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Zurück zu /chat
              </Link>
            </div>
          </div>
        </div>

        {error ? <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        {notice ? <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

        <section className="glass-panel-strong rounded-2xl p-4 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Übersicht</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Nutzer: <span className="font-semibold">{overview?.usersTotal ?? "-"}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Online: <span className="font-semibold">{overview?.usersOnline ?? "-"}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Nachrichten: <span className="font-semibold">{overview?.messagesTotal ?? "-"}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Umfragen: <span className="font-semibold">{overview?.pollsTotal ?? "-"}</span></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">Sperrliste: <span className="font-semibold">{overview?.blacklistTotal ?? "-"}</span></div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Alle Chat-Nachrichten und Umfragen löschen?")) return;
                void runAction("delete_all_messages");
              }}
              disabled={submittingAction !== null}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              Nachrichten löschen
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Alle Nutzer außer dir abmelden?")) return;
                void runAction("logout_all_users");
              }}
              disabled={submittingAction !== null}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              Nutzer abmelden
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Sperrliste leeren?")) return;
                void runAction("clear_blacklist");
              }}
              disabled={submittingAction !== null}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              Sperrliste leeren
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Alles zurücksetzen? Nachrichten, Nutzer und Sperrliste werden gelöscht.")) return;
                void runAction("reset_all");
              }}
              disabled={submittingAction !== null}
              className="h-10 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              Alles zurücksetzen
            </button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={targetUsernameDraft}
              onChange={(event) => setTargetUsernameDraft(event.target.value)}
              placeholder="Benutzername zum Löschen…"
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
            />
            <button
              type="button"
              onClick={() => {
                const target = targetUsernameDraft.trim();
                if (!target) return;
                if (!window.confirm(`Nutzer ${target} löschen?`)) return;
                void runAction("delete_user", { targetUsername: target });
              }}
              disabled={submittingAction !== null}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              Nutzer löschen
            </button>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={messageIdDraft}
              onChange={(event) => setMessageIdDraft(event.target.value)}
              placeholder="Nachrichten-ID zum Löschen…"
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
            />
            <button
              type="button"
              onClick={() => {
                const target = messageIdDraft.trim();
                if (!target) return;
                if (!window.confirm(`Nachricht ${target} löschen?`)) return;
                void runAction("delete_message", { targetMessageId: target });
              }}
              disabled={submittingAction !== null}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              Nachricht löschen
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Nutzerverwaltung</h2>
          <p className="mt-1 text-sm text-slate-600">Score, Rang, Passwort, Stats und Interessen in einer Ansicht.</p>
          {loading ? <p className="mt-3 text-sm text-slate-600">Lade Daten…</p> : null}

          <div className="mt-4 space-y-3">
            {mergedUsers.map((user) => (
              <article key={user.userId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={user.profilePicture}
                      alt={`Profilbild von ${user.username}`}
                      className="h-14 w-14 rounded-full border border-slate-200 object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-slate-900">{user.username}</p>
                      <p className="truncate text-xs text-slate-500">{user.loginName || "kein Login-Name"} · {user.clientId}</p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {user.member ? `${memberLabel(user.member.rank)} · Score ${user.member.score} (raw ${Math.round(user.memberRawScore)})` : "Kein PPC-Rang"}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${user.isOnline ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                    {user.isOnline ? "online" : "offline"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Posts: <span className="font-semibold">{user.stats.postsTotal}</span></div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Reaktionen erhalten: <span className="font-semibold">{user.stats.reactionsReceived}</span></div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Reaktionen gegeben: <span className="font-semibold">{user.stats.reactionsGiven}</span></div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Umfragen erstellt: <span className="font-semibold">{user.stats.pollsCreated}</span></div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Umfrage-Stimmen: <span className="font-semibold">{user.stats.pollVotes}</span></div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">Aktive Tage: <span className="font-semibold">{user.stats.activeDays}</span></div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    type="number"
                    value={scoreDrafts[user.userId] || "0"}
                    onChange={(event) => {
                      const value = event.target.value;
                      setScoreDrafts((current) => ({ ...current, [user.userId]: value }));
                    }}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
                    placeholder="Score"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const parsed = Number(scoreDrafts[user.userId] || "0");
                      if (!Number.isFinite(parsed)) {
                        setError("Bitte einen gültigen Score eingeben.");
                        return;
                      }
                      void runAction("set_user_score", {
                        targetUserId: user.userId,
                        targetScore: parsed,
                      });
                    }}
                    disabled={submittingAction !== null}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    Score setzen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void runAction("set_user_score", {
                        targetUserId: user.userId,
                        targetScore: 0,
                      });
                    }}
                    disabled={submittingAction !== null}
                    className="h-10 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 disabled:opacity-60"
                  >
                    Score entfernen
                  </button>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <select
                    value={rankDrafts[user.userId] || "BRONZE"}
                    onChange={(event) => {
                      const value = event.target.value as MemberRank;
                      setRankDrafts((current) => ({ ...current, [user.userId]: value }));
                    }}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-900"
                  >
                    {RANK_OPTIONS.map((rank) => (
                      <option key={`${user.userId}-${rank}`} value={rank}>
                        {memberLabel(rank)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const rank = rankDrafts[user.userId] || "BRONZE";
                      void runAction("set_user_rank", {
                        targetUserId: user.userId,
                        targetRank: rank,
                      });
                    }}
                    disabled={submittingAction !== null}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    Rang setzen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Nutzer ${user.username} löschen?`)) return;
                      void runAction("delete_user", { targetUsername: user.username });
                    }}
                    disabled={submittingAction !== null}
                    className="h-10 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 disabled:opacity-60"
                  >
                    Nutzer löschen
                  </button>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={passwordDrafts[user.userId] || ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPasswordDrafts((current) => ({ ...current, [user.userId]: value }));
                    }}
                    placeholder={user.canResetPassword ? "Neues Passwort (mind. 8 Zeichen)" : "Nicht verfügbar"}
                    disabled={!user.canResetPassword || submittingPassword === user.userId}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-900 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void resetPassword(user);
                    }}
                    disabled={!user.canResetPassword || submittingPassword === user.userId}
                    className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {submittingPassword === user.userId ? "Speichert…" : "Passwort setzen"}
                  </button>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Interessen</p>
                  {user.taste ? (
                    <>
                      <p className="mt-1 text-xs text-slate-500">
                        Aktualisiert: {new Date(user.taste.updatedAt).toLocaleString("de-DE")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {user.taste.topTags.slice(0, 16).map((tag) => (
                          <span
                            key={`${user.userId}-${tag.tag}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                          >
                            {tag.tag}
                          </span>
                        ))}
                        {user.taste.topTags.length === 0 ? (
                          <span className="text-xs text-slate-500">Noch keine Top-Tags.</span>
                        ) : null}
                      </div>
                      {user.taste.reactionDistribution.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {user.taste.reactionDistribution.map((entry) => (
                            <span
                              key={`${user.userId}-${entry.reaction}`}
                              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                            >
                              {entry.reaction}: {entry.count}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Keine Taste-Daten vorhanden.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Log (System)</h2>
          {logEntries.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Keine System-Einträge gefunden.</p>
          ) : (
            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {logEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-700">{new Date(entry.createdAt).toLocaleString("de-DE")}</p>
                  <p className="mt-1 text-sm text-slate-900">{entry.message}</p>
                  <p className="mt-1 text-[11px] text-slate-500">#{entry.id}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
