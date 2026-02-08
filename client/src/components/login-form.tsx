"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/http";
import { getDefaultProfilePicture, saveSession } from "@/lib/session";
import type { LoginRequest, UserPresenceDTO } from "@/lib/types";

function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = username.trim();
    if (trimmed.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    const avatarCandidate = profilePicture.trim();
    if (avatarCandidate) {
      try {
        // Validate URL format client-side for faster feedback.
        new URL(avatarCandidate);
      } catch {
        setError("Profile picture must be a valid URL.");
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const payload: LoginRequest = {
        username: trimmed,
        clientId: createClientId(),
        profilePicture: avatarCandidate || getDefaultProfilePicture(),
      };

      const user = await apiJson<UserPresenceDTO>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      saveSession({
        clientId: user.clientId,
        username: user.username,
        profilePicture: user.profilePicture,
      });

      router.push("/chat");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="App">
      <div className="loginTitle">Welcome to Chat PPC</div>
      <div className="loginContainer">
        <div className="loginContainerLeft">
          <form className="loginContainerInputBox" onSubmit={onSubmit}>
            <input
              className="loginContainerInput"
              type="text"
              placeholder="Username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              className="loginContainerInput"
              type="url"
              placeholder="Profile picture URL (optional)"
              value={profilePicture}
              onChange={(event) => setProfilePicture(event.target.value)}
            />
            {error ? <div className="loginError">{error}</div> : null}
            <button
              id="loginContainerSubmitButton"
              className="loginContainerSubmitButton"
              type="submit"
              disabled={loading}
            >
              {loading ? "Loading..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
