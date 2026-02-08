const SESSION_KEY = "chatppc.session";

export interface SessionState {
  clientId: string;
  username: string;
  profilePicture: string;
}

export function getDefaultProfilePicture(): string {
  return (
    process.env.NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE ||
    "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg"
  );
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
    if (!parsed.clientId || !parsed.username) {
      return null;
    }

    return {
      ...parsed,
      profilePicture: parsed.profilePicture || getDefaultProfilePicture(),
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
