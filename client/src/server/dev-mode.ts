import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

interface DevTokenPayload {
  clientId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

const DEV_UNLOCK_CODE_REGEX = /^\d{16}$/;
const DEV_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function getDevUnlockCode(): string | null {
  const value = process.env.CHAT_DEV_UNLOCK_CODE?.trim();
  if (!value || !DEV_UNLOCK_CODE_REGEX.test(value)) {
    return null;
  }
  return value;
}

function getDevTokenSecret(): string | null {
  const secret = process.env.CHAT_DEV_TOKEN_SECRET?.trim();
  if (secret) {
    return secret;
  }

  return getDevUnlockCode();
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function isDevUnlockUsername(username: string): boolean {
  const unlockCode = getDevUnlockCode();
  if (!unlockCode) {
    return false;
  }

  return username.trim() === unlockCode;
}

export function issueDevAuthToken(clientId: string): string | null {
  const secret = getDevTokenSecret();
  if (!secret) {
    return null;
  }

  const now = Date.now();
  const payload: DevTokenPayload = {
    clientId,
    issuedAt: now,
    expiresAt: now + DEV_TOKEN_TTL_MS,
    nonce: randomBytes(8).toString("hex"),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyDevAuthToken(token: string, clientId: string): boolean {
  const secret = getDevTokenSecret();
  if (!secret) {
    return false;
  }

  const [encodedPayload, signature] = token.split(".", 2);
  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!safeEquals(expectedSignature, signature)) {
    return false;
  }

  let payload: DevTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as DevTokenPayload;
  } catch {
    return false;
  }

  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.clientId !== clientId) {
    return false;
  }

  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) {
    return false;
  }

  return true;
}
