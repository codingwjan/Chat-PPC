import { describe, expect, it } from "vitest";
import {
  __resetLoginNameCryptoCacheForTests,
  decryptLoginName,
  encryptLoginName,
  hashLoginNameLookup,
  normalizeLoginName,
} from "@/server/login-name-crypto";

describe("login-name-crypto", () => {
  it("normalizes login names", () => {
    expect(normalizeLoginName("  Max.Mustermann ")).toBe("max.mustermann");
  });

  it("encrypts and decrypts login names", () => {
    const encrypted = encryptLoginName("Max.Mustermann");

    expect(encrypted).not.toContain("Max.Mustermann");
    expect(decryptLoginName(encrypted)).toBe("max.mustermann");
  });

  it("creates deterministic lookup hash", () => {
    const one = hashLoginNameLookup("Max.Mustermann");
    const two = hashLoginNameLookup(" max.mustermann ");
    const three = hashLoginNameLookup("anderer.name");

    expect(one).toBe(two);
    expect(one).not.toBe(three);
  });

  it("derives lookup secret from encryption key when lookup secret is missing", () => {
    const env = process.env as Record<string, string | undefined>;
    const previousLookup = process.env.CHAT_LOGIN_NAME_LOOKUP_SECRET;
    const previousEncryptionKey = process.env.CHAT_LOGIN_NAME_ENCRYPTION_KEY;
    const previousNodeEnv = process.env.NODE_ENV;
    env.NODE_ENV = "production";
    env.CHAT_LOGIN_NAME_LOOKUP_SECRET = "";
    env.CHAT_LOGIN_NAME_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    __resetLoginNameCryptoCacheForTests();

    try {
      const one = hashLoginNameLookup("Max.Mustermann");
      const two = hashLoginNameLookup(" max.mustermann ");
      expect(one).toBe(two);
      expect(one).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      env.CHAT_LOGIN_NAME_LOOKUP_SECRET = previousLookup;
      env.CHAT_LOGIN_NAME_ENCRYPTION_KEY = previousEncryptionKey;
      env.NODE_ENV = previousNodeEnv;
      __resetLoginNameCryptoCacheForTests();
    }
  });
});
