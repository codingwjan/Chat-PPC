"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, KeyboardEvent, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ProfileImageCropModal } from "@/components/profile-image-crop-modal";
import { apiJson } from "@/lib/http";
import { getDefaultProfilePicture, saveSession } from "@/lib/session";
import type { LoginRequest, LoginResponseDTO } from "@/lib/types";

interface UploadResponse {
  url: string;
}

const USERNAME_PLACEHOLDER = "Dein Benutzername";
const SUPPORTED_PROFILE_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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
    throw new Error(payload?.error || "Upload fehlgeschlagen");
  }

  const payload = (await response.json()) as UploadResponse;
  return payload.url;
}

export function LoginForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profilePicture, setProfilePicture] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileDropActive, setProfileDropActive] = useState(false);

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const submittedUsername = formData.get("username");
    const trimmed = typeof submittedUsername === "string" ? submittedUsername.trim() : "";
    if (trimmed.length < 3) {
      setError("Der Benutzername muss mindestens 3 Zeichen lang sein.");
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

  function onUsernameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (loading || uploading) return;
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <main className="min-h-[100svh] bg-white">
      <div className="flex min-h-[100svh]">
        <div className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-6 lg:flex-none lg:px-20 xl:px-24">
          <div className="mx-auto w-full max-w-sm lg:w-96">
            <p className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">ChatPPC</p>
            <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900">Anmelden</h1>
            <p className="mt-2 text-sm text-slate-500">Wähle einen Namen und starte den Chat.</p>

            <form className="mt-8 space-y-6" onSubmit={onSubmit} onPaste={onProfileImagePaste}>
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-slate-900">
                  Benutzername
                </label>
                <div className="mt-2">
                  <input
                    id="username"
                    className="block h-11 w-full rounded-md bg-white px-3 text-base text-slate-900 outline-1 -outline-offset-1 outline-slate-300 placeholder:text-slate-400 focus:outline-2 focus:-outline-offset-2 focus:outline-sky-600"
                    type="text"
                    placeholder={USERNAME_PLACEHOLDER}
                    name="username"
                    autoComplete="username"
                    spellCheck={false}
                    minLength={3}
                    required
                    onKeyDown={onUsernameKeyDown}
                  />
                </div>
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
                    className="inline-flex h-10 items-center rounded-md bg-white px-4 text-sm font-semibold text-slate-700 shadow-xs ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? "Wird hochgeladen…" : "Bild hochladen"}
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
                  <p className="text-xs text-slate-500">Profilbild-Vorschau</p>
                </div>
                <p className="text-xs text-slate-500">Bild per Drag-and-drop oder Cmd/Ctrl + V einfügen.</p>
              </div>

              {error ? (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-600" aria-live="polite">
                  {error}
                </div>
              ) : null}

              <button
                className="flex h-11 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-xs hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={loading || uploading}
              >
                {loading ? "Beitritt läuft…" : "Chat betreten"}
              </button>
            </form>
          </div>
        </div>

        <div className="relative hidden flex-1 lg:block">
          <img
            alt="Chat Hintergrund"
            src="https://images.unsplash.com/photo-1496917756835-20cb06e75b4e?auto=format&fit=crop&w=1908&q=80"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-slate-900/35" />
          <div className="absolute inset-x-8 bottom-8 rounded-2xl border border-white/20 bg-black/35 p-4 text-slate-100 backdrop-blur">
            <p className="text-sm font-semibold">In wenigen Sekunden im Gruppenchat.</p>
            <p className="mt-1 text-xs text-slate-200">Umfragen, Fragen und Bildfreigaben in einem Chat-Flow.</p>
          </div>
        </div>
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
