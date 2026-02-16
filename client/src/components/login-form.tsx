"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthWhatsNewPanel } from "@/components/auth-whats-new";
import { apiJson } from "@/lib/http";
import { clearSession, getDefaultProfilePicture, loadSession, saveSession, type SessionState } from "@/lib/session";
import type { AuthSessionDTO, AuthSignInRequest } from "@/lib/types";

async function clearAuthSessionCookie(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {
    // Best effort.
  });
}

function toSessionState(session: AuthSessionDTO): SessionState {
  return {
    id: session.id,
    clientId: session.clientId,
    loginName: session.loginName,
    username: session.username,
    profilePicture: session.profilePicture,
    sessionToken: session.sessionToken,
    sessionExpiresAt: session.sessionExpiresAt,
    devMode: session.devMode,
    devAuthToken: session.devAuthToken,
  };
}

export function LoginForm() {
  const router = useRouter();

  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const storedSession = loadSession();
      if (!storedSession || !storedSession.sessionToken) {
        if (storedSession && !storedSession.sessionToken) {
          clearSession();
        }
        await clearAuthSessionCookie();
        return;
      }

      try {
        const restored = await apiJson<AuthSessionDTO>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            clientId: storedSession.clientId,
            sessionToken: storedSession.sessionToken,
          }),
        });
        if (cancelled) return;

        saveSession(toSessionState(restored));
        router.replace("/chat");
      } catch {
        if (cancelled) return;
        clearSession();
        await clearAuthSessionCookie();
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submitSignin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLogin = loginName.trim().toLowerCase();
    if (!normalizedLogin) {
      setError("Bitte einen Login-Namen eingeben.");
      return;
    }
    if (password.trim().length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen haben.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: AuthSignInRequest = {
        loginName: normalizedLogin,
        password,
      };

      const session = await apiJson<AuthSessionDTO>("/api/auth/signin", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      saveSession({
        ...toSessionState(session),
        profilePicture: session.profilePicture || getDefaultProfilePicture(),
      });

      router.push("/chat");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Anmeldung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (loading) return;
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[radial-gradient(80%_100%_at_0%_0%,#d0f4f0_0%,#f4f6f8_35%,#f8fbfd_100%)] [font-family:var(--font-signup-sans)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl" />
        <div className="absolute right-[-120px] top-[28%] h-80 w-80 rounded-full bg-amber-200/45 blur-3xl" />
        <div className="absolute bottom-[-160px] left-[35%] h-96 w-96 rounded-full bg-sky-200/35 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-[100svh] w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_1.25fr] lg:items-center lg:py-10">
        <AuthWhatsNewPanel />

        <section className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_28px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl sm:p-8 lg:p-10">
          <nav className="mb-4 flex flex-wrap gap-2" aria-label="Auth-Modus">
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-full border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white"
            >
              Einloggen
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Account erstellen
            </Link>
          </nav>
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Login
          </div>
          <h1 className="mt-4 text-[clamp(1.7rem,3vw,2.4rem)] font-semibold leading-tight text-slate-900">Willkommen zurück</h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">Mit deinem Login-Namen und Passwort bist du direkt wieder im Chat.</p>

          <form className="mt-6 space-y-5" onSubmit={submitSignin}>
            <div>
              <label htmlFor="loginName" className="block text-sm font-medium text-slate-900">Login-Name</label>
              <input
                id="loginName"
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="z. B. vorname.nachname"
                className="mt-1.5 block h-12 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 text-base text-slate-900 outline-none ring-sky-300 transition focus-visible:ring-2"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-900">Passwort</label>
              <input
                id="password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={onKeyDown}
                className="mt-1.5 block h-12 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 text-base text-slate-900 outline-none ring-sky-300 transition focus-visible:ring-2"
                required
              />
              <p className="mt-1.5 text-xs font-medium text-sky-700">Tipp: Im Passwortmanager speichern, dann bleibst du dauerhaft schnell drin.</p>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" aria-live="polite">
                {error}
              </div>
            ) : null}

            <button
              className="flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.25)] hover:bg-slate-800 disabled:opacity-70"
              type="submit"
              disabled={loading}
            >
              {loading ? "Bitte warten..." : "Anmelden"}
            </button>
          </form>

          <p className="mt-5 text-sm text-slate-600">
            Noch kein Konto?{" "}
            <Link className="font-semibold text-sky-700 hover:text-sky-800" href="/signup">
              Zur Registrierung
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
