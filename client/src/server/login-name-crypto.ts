import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "node:crypto";

const LOGIN_NAME_ENCRYPTION_VERSION = "v1";
const LOGIN_NAME_ENCRYPTION_ALGORITHM = "aes-256-gcm";
const LOGIN_NAME_IV_BYTES = 12;
const LOGIN_NAME_KEY_BYTES = 32;

let cachedEncryptionKey: Buffer | null = null;
let cachedLookupSecret: string | null = null;

function decodeBase64Like(input: string): Buffer {
  const normalized = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey) return cachedEncryptionKey;

  const fromEnv = process.env.CHAT_LOGIN_NAME_ENCRYPTION_KEY?.trim();
  if (fromEnv) {
    const decoded = decodeBase64Like(fromEnv);
    if (decoded.length !== LOGIN_NAME_KEY_BYTES) {
      throw new Error("CHAT_LOGIN_NAME_ENCRYPTION_KEY muss 32 Byte (base64/base64url) ergeben");
    }
    cachedEncryptionKey = decoded;
    return decoded;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CHAT_LOGIN_NAME_ENCRYPTION_KEY fehlt");
  }

  const fallback = createHash("sha256").update("chatppc-dev-login-name-key", "utf8").digest();
  cachedEncryptionKey = fallback;
  return fallback;
}

function getLookupSecret(): string {
  if (cachedLookupSecret) return cachedLookupSecret;

  const fromEnv = process.env.CHAT_LOGIN_NAME_LOOKUP_SECRET?.trim();
  if (fromEnv) {
    cachedLookupSecret = fromEnv;
    return fromEnv;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CHAT_LOGIN_NAME_LOOKUP_SECRET fehlt");
  }

  const fallback = "chatppc-dev-login-name-lookup-secret";
  cachedLookupSecret = fallback;
  return fallback;
}

export function normalizeLoginName(loginName: string): string {
  return loginName.trim().toLowerCase();
}

export function hashLoginNameLookup(loginName: string): string {
  const normalized = normalizeLoginName(loginName);
  return createHmac("sha256", getLookupSecret()).update(normalized, "utf8").digest("hex");
}

export function encryptLoginName(loginName: string): string {
  const normalized = normalizeLoginName(loginName);
  const iv = randomBytes(LOGIN_NAME_IV_BYTES);
  const cipher = createCipheriv(LOGIN_NAME_ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    LOGIN_NAME_ENCRYPTION_VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

export function decryptLoginName(encrypted: string): string {
  const [version, ivEncoded, payloadEncoded, tagEncoded] = encrypted.split(".", 4);
  if (version !== LOGIN_NAME_ENCRYPTION_VERSION || !ivEncoded || !payloadEncoded || !tagEncoded) {
    throw new Error("Ungültiges loginNameEncrypted-Format");
  }

  const decipher = createDecipheriv(
    LOGIN_NAME_ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return normalizeLoginName(decrypted);
}
