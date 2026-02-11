"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileImageCropModal } from "@/components/profile-image-crop-modal";
import { apiJson } from "@/lib/http";
import { getDefaultProfilePicture, saveSession } from "@/lib/session";
import type { LoginRequest, LoginResponseDTO } from "@/lib/types";

interface UploadResponse {
  url: string;
}

function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function uploadProfileImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch("/api/uploads/profile", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Upload failed");
  }

  const payload = (await response.json()) as UploadResponse;
  return payload.url;
}

export function LoginForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = username.trim();
    if (trimmed.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: LoginRequest = {
        username: trimmed,
        clientId: createClientId(),
        profilePicture: profilePicture || getDefaultProfilePicture(),
      };

      const user = await apiJson<LoginResponseDTO>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      saveSession({
        clientId: user.clientId,
        username: user.username,
        profilePicture: user.profilePicture,
        devMode: user.devMode,
        devAuthToken: user.devAuthToken,
      });

      router.push("/chat");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function onUploadChange(file: File | undefined) {
    if (!file) return;
    setError(null);
    setCropFile(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function onCropConfirm(file: File) {
    setUploading(true);
    setError(null);

    try {
      const url = await uploadProfileImage(file);
      setProfilePicture(url);
      setCropFile(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="h-[100dvh] w-screen overflow-y-auto bg-[radial-gradient(circle_at_top_left,_#dbeafe_0%,_#f8fafc_40%,_#eef2ff_100%)] px-4 py-6 sm:px-6 [padding-bottom:calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="mx-auto flex min-h-full max-w-4xl items-center">
        <section className="grid w-full overflow-hidden rounded-3xl border border-white/70 bg-white/70 shadow-2xl backdrop-blur md:grid-cols-[1.1fr_1fr]">
          <div className="bg-slate-900 p-8 text-white md:p-10">
            <p className="mb-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
              Chat PPC
            </p>
            <h1 className="text-3xl font-bold leading-tight">Jump into your group chat in seconds.</h1>
            <p className="mt-4 text-sm text-slate-200">
              Fast realtime chat, polls, questions, and fun social vibes built for small groups.
            </p>
            <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-4 text-xs text-slate-200">
              Tip: Upload an avatar and crop it before joining.
            </div>
          </div>

          <div className="p-6 sm:p-8 md:p-10">
            <h2 className="text-2xl font-bold text-slate-900 text-balance">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Pick a name and start chatting.</p>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <label className="block text-sm font-medium text-slate-700">
                Username
                <input
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm transition focus:border-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  type="text"
                  placeholder="e.g. jan_the_builder…"
                  name="username"
                  autoComplete="username"
                  spellCheck={false}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <p className="text-xs text-slate-500">
                Developer mode: enter your private 16-digit unlock code as username.
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Uploading…" : "Upload Image"}
                </button>
                <input
                  ref={fileInputRef}
                  className="hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => void onUploadChange(event.target.files?.[0])}
                />
                <div className="text-xs text-slate-500">Max 6MB</div>
              </div>

              <div className="flex items-center gap-3">
                <img
                  src={profilePicture || getDefaultProfilePicture()}
                  alt="Avatar preview"
                  className="h-12 w-12 rounded-full border border-slate-200 object-cover"
                  width={48}
                  height={48}
                  loading="lazy"
                />
                <p className="text-xs text-slate-500">Avatar preview</p>
              </div>

              {error ? (
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600" aria-live="polite">
                  {error}
                </div>
              ) : null}

              <button
                className="h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={loading || uploading}
              >
                {loading ? "Joining…" : "Enter Chat"}
              </button>
            </form>
          </div>
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
