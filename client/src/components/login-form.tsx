"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, KeyboardEvent, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ProfileImageCropModal } from "@/components/profile-image-crop-modal";
import { apiJson } from "@/lib/http";
import { clearSession, getDefaultProfilePicture, loadSession, saveSession, type SessionState } from "@/lib/session";
import type { AuthSessionDTO, AuthSignInRequest, AuthSignUpRequest } from "@/lib/types";

interface UploadResponse {
  url: string;
}

const SUPPORTED_PROFILE_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type AuthMode = "signin" | "signup";

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

export function LoginForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<AuthMode>("signin");
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

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
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

    if (mode === "signup" && displayName.trim().length < 3) {
      setError("Der Anzeigename muss mindestens 3 Zeichen haben.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/signin";
      const payload: AuthSignUpRequest | AuthSignInRequest = mode === "signup"
        ? {
          loginName: normalizedLogin,
          password,
          displayName: displayName.trim(),
          profilePicture: profilePicture || getDefaultProfilePicture(),
        }
        : {
          loginName: normalizedLogin,
          password,
        };

      const session = await apiJson<AuthSessionDTO>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      saveSession(toSessionState(session));

      router.push("/chat");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Anmeldung fehlgeschlagen");
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

  function onProfileImagePaste(event: ClipboardEvent<HTMLElement>): void {
    const imageFiles = extractSupportedImageFiles(event.clipboardData);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void onUploadChange(imageFiles[0]);
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
    <main className="min-h-[100svh] bg-white">
      <div className="mx-auto flex min-h-[100svh] w-full max-w-5xl items-center px-4 py-8 sm:px-6">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">ChatPPC</p>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Konto verwenden</h1>
          <p className="mt-1 text-sm text-slate-500">
            Einfach anmelden oder neues Konto erstellen. Umlaute wie äöüß funktionieren überall.
          </p>

          <div className="mt-5 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === "signin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              onClick={() => setMode("signin")}
            >
              Anmelden
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === "signup" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              onClick={() => setMode("signup")}
            >
              Registrieren
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={submitAuth} onPaste={onProfileImagePaste}>
            <div>
              <label htmlFor="loginName" className="block text-sm font-medium text-slate-900">Login-Name</label>
              <input
                id="loginName"
                type="text"
                autoComplete="username"
                spellCheck={false}
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="z. B. max.mustermann"
                className="mt-1 block h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-900">Passwort</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={onKeyDown}
                className="mt-1 block h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                required
              />
              <p className="mt-1 text-xs text-slate-500">Mindestens 8 Zeichen.</p>
            </div>

            {mode === "signup" ? (
              <>
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium text-slate-900">Anzeigename</label>
                  <input
                    id="displayName"
                    type="text"
                    autoComplete="nickname"
                    spellCheck={false}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Name im Chat"
                    className="mt-1 block h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    required
                  />
                  <p className="mt-1 text-xs text-slate-500">Darf später jederzeit geändert werden.</p>
                </div>

                <div
                  className={`space-y-3 rounded-xl border border-dashed p-3 transition ${
                    profileDropActive ? "border-sky-400 bg-sky-50" : "border-slate-300 bg-slate-50/70"
                  }`}
                  tabIndex={0}
                  onDragOver={onProfileImageDragOver}
                  onDragEnter={onProfileImageDragOver}
                  onDragLeave={onProfileImageDragLeave}
                  onDrop={onProfileImageDrop}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="inline-flex h-10 items-center rounded-md bg-white px-4 text-sm font-semibold text-slate-700 shadow-xs ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
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
                    <span className="text-xs text-slate-500">Max. 6 MB</span>
                  </div>

                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
                    <img
                      src={profilePicture || getDefaultProfilePicture()}
                      alt="Vorschau Profilbild"
                      className="h-12 w-12 shrink-0 rounded-full border border-slate-200 object-cover [aspect-ratio:1/1]"
                      width={48}
                      height={48}
                      loading="lazy"
                    />
                    <p className="text-xs text-slate-500">Bild per Drag-and-drop oder Cmd/Ctrl + V einfügen.</p>
                  </div>
                </div>
              </>
            ) : null}

            {error ? (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-600" aria-live="polite">
                {error}
              </div>
            ) : null}

            <button
              className="flex h-11 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
              type="submit"
              disabled={loading || uploading}
            >
              {loading ? "Bitte warten…" : mode === "signup" ? "Konto erstellen" : "Anmelden"}
            </button>
          </form>
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
    </main>
  );
}
