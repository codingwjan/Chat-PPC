"use client";
/* eslint-disable @next/next/no-img-element */

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthWhatsNewPanel } from "@/components/auth-whats-new";
import { apiJson } from "@/lib/http";
import { clearSession, getDefaultProfilePicture, loadSession, saveSession, type SessionState } from "@/lib/session";
import type { AuthSessionDTO, AuthSignUpRequest } from "@/lib/types";

interface UploadResponse {
  url: string;
}

const SUPPORTED_PROFILE_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const ProfileImageCropModal = dynamic(
  () => import("@/components/profile-image-crop-modal").then((module) => module.ProfileImageCropModal),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/55 p-4">
        <div className="glass-panel-strong w-full max-w-xl rounded-2xl p-5 animate-pulse">
          <div className="h-5 w-44 rounded bg-slate-200/70" />
          <div className="mt-4 aspect-square w-full rounded-2xl bg-slate-200/70" />
          <div className="mt-4 h-10 w-40 rounded-xl bg-slate-200/70" />
        </div>
      </div>
    ),
  },
);

async function uploadProfileImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch("/api/uploads/profile", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Upload fehlgeschlagen");
  }

  const payload = (await response.json()) as UploadResponse;
  return payload.url;
}

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

export function SignupWizard() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2>(1);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileDropActive, setProfileDropActive] = useState(false);

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

  function normalizeAndValidateStepOne(): string | null {
    const normalizedLogin = loginName.trim().toLowerCase();
    if (!normalizedLogin) {
      setError("Bitte einen Login-Namen eingeben.");
      return null;
    }

    if (password.trim().length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen haben.");
      return null;
    }

    return normalizedLogin;
  }

  function extractSupportedImageFiles(dataTransfer: DataTransfer | null | undefined): File[] {
    if (!dataTransfer) return [];

    const fromItems = Array.from(dataTransfer.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
      .filter((file) => SUPPORTED_PROFILE_UPLOAD_MIME_TYPES.has(file.type));
    if (fromItems.length > 0) return fromItems;

    return Array.from(dataTransfer.files).filter((file) => SUPPORTED_PROFILE_UPLOAD_MIME_TYPES.has(file.type));
  }

  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedLogin = normalizeAndValidateStepOne();
    if (!normalizedLogin) return;

    if (step === 1) {
      setStep(2);
      return;
    }

    if (displayName.trim().length < 3) {
      setError("Der Anzeigename muss mindestens 3 Zeichen haben.");
      return;
    }

    setLoading(true);
    try {
      const payload: AuthSignUpRequest = {
        loginName: normalizedLogin,
        password,
        displayName: displayName.trim(),
        profilePicture: profilePicture || getDefaultProfilePicture(),
      };

      const session = await apiJson<AuthSessionDTO>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      saveSession(toSessionState(session));
      router.push("/chat");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Registrierung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  async function onUploadChange(file: File | undefined) {
    if (!file) return;
    if (!SUPPORTED_PROFILE_UPLOAD_MIME_TYPES.has(file.type)) {
      setError("Nur jpg, png, webp oder gif werden unterstützt.");
      return;
    }

    setError(null);
    setCropFile(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function onProfileImageDragOver(event: DragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setProfileDropActive(true);
  }

  function onProfileImageDragLeave(event: DragEvent<HTMLElement>): void {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setProfileDropActive(false);
  }

  function onProfileImageDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setProfileDropActive(false);

    const imageFiles = extractSupportedImageFiles(event.dataTransfer);
    if (imageFiles.length === 0) {
      setError("Nur jpg, png, webp oder gif werden unterstützt.");
      return;
    }

    void onUploadChange(imageFiles[0]);
  }

  async function onCropConfirm(file: File) {
    setUploading(true);
    setError(null);

    try {
      const url = await uploadProfileImage(file);
      setProfilePicture(url);
      setCropFile(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (loading || uploading) return;
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <main className="brand-surface relative min-h-[100svh] overflow-hidden [font-family:var(--brand-font)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl" />
        <div className="absolute right-[-120px] top-[28%] h-80 w-80 rounded-full bg-amber-200/45 blur-3xl" />
        <div className="absolute bottom-[-160px] left-[35%] h-96 w-96 rounded-full bg-sky-200/35 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-[100svh] w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_1.25fr] lg:items-center lg:py-10">
        <AuthWhatsNewPanel />

        <section className="glass-panel-strong rounded-3xl p-6 sm:p-8 lg:p-10">
          <nav className="mb-4 flex flex-wrap gap-2" aria-label="Auth-Modus">
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Einloggen
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-10 items-center rounded-full border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white"
            >
              Account erstellen
            </Link>
          </nav>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${step === 1 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>01</div>
              <div className={`h-[2px] w-10 ${step === 2 ? "bg-slate-900" : "bg-slate-200"}`} />
              <div className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${step === 2 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>02</div>
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Signup Wizard</span>
          </div>

          <form className="mt-6 space-y-5" onSubmit={submitSignup}>
            {step === 1 ? (
              <div className="space-y-5 animate-[fade-up_280ms_ease-out]">
                <div>
                  <label htmlFor="signup-login-name" className="block text-sm font-medium text-slate-900">Login-Name</label>
                  <input
                    id="signup-login-name"
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
                  <p className="mt-1.5 text-xs text-slate-600">
                    Bitte merken: nur für Login, nicht im Chat sichtbar. Kann seriös sein wie vorname.nachname.
                  </p>
                </div>

                <div>
                  <label htmlFor="signup-password" className="block text-sm font-medium text-slate-900">Passwort</label>
                  <input
                    id="signup-password"
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={onKeyDown}
                    className="mt-1.5 block h-12 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 text-base text-slate-900 outline-none ring-sky-300 transition focus-visible:ring-2"
                    required
                  />
                  <p className="mt-1.5 text-xs text-slate-600">Mindestens 8 Zeichen.</p>
                  <p className="mt-1.5 text-xs font-medium text-sky-700">Tipp: Login-Name und Passwort direkt im Passwortmanager speichern.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5 animate-[fade-up_280ms_ease-out]">
                <div>
                  <label htmlFor="signup-display-name" className="block text-sm font-medium text-slate-900">Anzeigename</label>
                  <input
                    id="signup-display-name"
                    type="text"
                    name="nickname"
                    autoComplete="nickname"
                    spellCheck={false}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Name im Chat"
                    className="mt-1.5 block h-12 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 text-base text-slate-900 outline-none ring-sky-300 transition focus-visible:ring-2"
                    required
                  />
                  <p className="mt-1.5 text-xs text-slate-600">Das sehen alle im Chat.</p>
                </div>

                <div
                  className={`space-y-3 rounded-2xl border border-dashed p-4 transition ${
                    profileDropActive ? "border-cyan-400 bg-cyan-50" : "border-slate-300/80 bg-slate-50/70"
                  }`}
                  tabIndex={0}
                  onDragOver={onProfileImageDragOver}
                  onDragEnter={onProfileImageDragOver}
                  onDragLeave={onProfileImageDragLeave}
                  onDrop={onProfileImageDrop}
                >
                  <p className="text-sm font-medium text-slate-900">Profilbild (optional)</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? "Wird hochgeladen…" : "Profilbild hochladen"}
                    </button>
                    <input
                      ref={fileInputRef}
                      className="hidden"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => void onUploadChange(event.target.files?.[0])}
                    />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Max 6 MB</span>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-2.5">
                    <img
                      src={profilePicture || getDefaultProfilePicture()}
                      alt="Vorschau Profilbild"
                      className="h-12 w-12 shrink-0 rounded-full border border-slate-200 object-cover [aspect-ratio:1/1]"
                      width={48}
                      height={48}
                      loading="lazy"
                    />
                    <p className="text-xs text-slate-600">Unter dem Anzeigenamen kannst du optional ein Profilbild setzen.</p>
                  </div>
                </div>

                <div className="sr-only" aria-hidden="true">
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    readOnly
                    value={loginName.trim().toLowerCase()}
                    tabIndex={-1}
                  />
                  <input
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    readOnly
                    value={password}
                    tabIndex={-1}
                  />
                </div>
              </div>
            )}

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" aria-live="polite">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {step === 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (loading || uploading) return;
                    setStep(1);
                  }}
                  className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Zurück
                </button>
              ) : null}
              <button
                className="flex h-11 flex-1 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.25)] hover:bg-slate-800 disabled:opacity-70"
                type="submit"
                disabled={loading || uploading}
              >
                {loading ? "Bitte warten…" : step === 1 ? "Weiter" : "Konto erstellen"}
              </button>
            </div>
          </form>

          <p className="mt-5 text-sm text-slate-600">
            Bereits ein Konto?{" "}
            <Link className="font-semibold text-sky-700 hover:text-sky-800" href="/login">
              Zum Login
            </Link>
          </p>
        </section>
      </div>

      {cropFile ? (
        <ProfileImageCropModal
          key={`${cropFile.name}-${cropFile.size}-${cropFile.lastModified}`}
          file={cropFile}
          busy={uploading}
          onCancel={() => setCropFile(null)}
          onConfirm={onCropConfirm}
        />
      ) : null}

      <style jsx global>{`
        @keyframes fade-up {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 1ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 1ms !important;
          }
                }
      `}</style>
    </main>
  );
}
