import { getDefaultProfilePicture as getDefaultAvatar } from "@/lib/default-avatar";

const SESSION_KEY = "chatppc.session";

export interface SessionState {
  id?: string;
  clientId: string;
  loginName?: string;
  username: string;
  profilePicture: string;
  sessionToken?: string;
  sessionExpiresAt?: string;
  devMode?: boolean;
  devAuthToken?: string;
}

export function getDefaultProfilePicture(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE || getDefaultAvatar();
}

export function loadSession(): SessionState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SessionState;
    if (!parsed.clientId || !parsed.username || !parsed.sessionToken || !parsed.sessionExpiresAt) {
      return null;
    }

    const expiresAt = new Date(parsed.sessionExpiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return {
      ...parsed,
      profilePicture: parsed.profilePicture || getDefaultProfilePicture(),
      devMode: Boolean(parsed.devMode && parsed.devAuthToken),
      devAuthToken: parsed.devAuthToken,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: SessionState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
}

export function buildVoteStorageKey(pollMessageId: string): string {
  return `chatppc.vote.${pollMessageId}`;
}
