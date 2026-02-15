import { describe, expect, it } from "vitest";
import {
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
});
