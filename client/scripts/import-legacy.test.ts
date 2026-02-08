import { describe, expect, it } from "vitest";
import {
  buildFallbackCreatedAt,
  buildLegacyMessageKey,
  normalizeLegacyMessageType,
} from "./import-legacy";

describe("legacy import helpers", () => {
  it("maps unknown types to message", () => {
    expect(normalizeLegacyMessageType(undefined)).toBe("message");
    expect(normalizeLegacyMessageType("unexpected")).toBe("message");
  });

  it("keeps explicit message types", () => {
    expect(normalizeLegacyMessageType("votingPoll")).toBe("votingPoll");
    expect(normalizeLegacyMessageType("question")).toBe("question");
    expect(normalizeLegacyMessageType("answer")).toBe("answer");
  });

  it("builds deterministic legacy keys", () => {
    expect(buildLegacyMessageKey(12)).toBe("legacy:12");
  });

  it("builds monotonic fallback dates", () => {
    const first = buildFallbackCreatedAt(0).getTime();
    const second = buildFallbackCreatedAt(1).getTime();
    expect(second).toBeGreaterThan(first);
  });
});
