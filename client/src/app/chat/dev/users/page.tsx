"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/http";
import { clearSession, loadSession, type SessionState } from "@/lib/session";
import type {
  AdminResetUserPasswordResponse,
  AdminUserListItemDTO,
  AdminUserListResponseDTO,
} from "@/lib/types";

export default function DevUsersPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(() => loadSession());
  const [items, setItems] = useState<AdminUserListItemDTO[]>([]);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canUseDevPage = Boolean(session?.clientId && session?.devMode && session?.devAuthToken);

  const fetchUsers = useCallback(async () => {
    if (!session?.clientId || !session.devAuthToken) return;

    const searchParams = new URLSearchParams({
      clientId: session.clientId,
      devAuthToken: session.devAuthToken,
    });

    const response = await apiJson<AdminUserListResponseDTO>(`/api/admin/users?${searchParams.toString()}`);
    setItems(response.items);
  }, [session?.clientId, session?.devAuthToken]);

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
    void fetchUsers()
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : "Dev-Userliste konnte nicht geladen werden.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [fetchUsers, router]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.username.localeCompare(b.username, "de", { sensitivity: "base" })),
    [items],
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

    setSubmitting(user.userId);
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

      if (session.id && session.id === user.userId) {
        await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {
          // Best effort.
        });
        clearSession();
        router.replace("/login");
        return;
      }

      await fetchUsers();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Passwort konnte nicht zurückgesetzt werden.");
    } finally {
      setSubmitting(null);
    }
  }

  if (!canUseDevPage) {
    return (
      <main className="brand-surface min-h-[100svh] p-6">
        <div className="glass-panel-strong mx-auto max-w-5xl rounded-xl p-6">
          <p className="text-sm text-slate-700">Entwicklermodus ist nicht aktiv.</p>
          <Link href="/chat" className="mt-3 inline-block text-sm font-semibold text-sky-700">Zurück zum Chat</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="brand-surface min-h-[100svh] p-6">
      <div className="glass-panel-strong mx-auto max-w-6xl space-y-4 rounded-xl p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Dev Users</h1>
          <Link href="/chat" className="text-sm font-semibold text-sky-700 hover:text-sky-800">Zurück zu /chat</Link>
        </div>

        {error ? <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        {notice ? <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 w-28 rounded bg-slate-200/70" />
            <div className="h-10 rounded-xl bg-slate-200/70" />
            <div className="h-10 rounded-xl bg-slate-200/70" />
            <div className="h-10 rounded-xl bg-slate-200/70" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="px-2 py-2">User</th>
                  <th className="px-2 py-2">Login-Name</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Passwort reset</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((user) => {
                  const resetDisabled = !user.canResetPassword || submitting === user.userId;
                  return (
                    <tr key={user.userId} className="border-b border-slate-100 align-top">
                      <td className="px-2 py-3">
                        <div className="font-medium text-slate-900">{user.username}</div>
                        <div className="text-xs text-slate-500">{user.clientId}</div>
                      </td>
                      <td className="px-2 py-3 font-mono text-xs text-slate-800">{user.loginName || "-"}</td>
                      <td className="px-2 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${user.isOnline ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                          {user.isOnline ? "online" : "offline"}
                        </span>
                        {!user.hasAccount ? (
                          <div className="mt-1 text-xs text-slate-500">Legacy-User ohne Account</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="password"
                            name={`new-password-${user.userId}`}
                            autoComplete="new-password"
                            value={passwordDrafts[user.userId] || ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setPasswordDrafts((current) => ({ ...current, [user.userId]: value }));
                            }}
                            placeholder={user.canResetPassword ? "Neues Passwort" : "Nicht verfügbar"}
                            disabled={!user.canResetPassword || submitting === user.userId}
                            className="h-9 min-w-56 rounded-md border border-slate-300 px-2 text-sm text-slate-900 disabled:bg-slate-100"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void resetPassword(user);
                            }}
                            disabled={resetDisabled}
                            className="h-9 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            {submitting === user.userId ? "Speichere…" : "Passwort setzen"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
