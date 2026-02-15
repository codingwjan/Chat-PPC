import { describe, expect, it } from "vitest";
import { resolveAuthRedirect } from "@/middleware";

describe("middleware auth routing", () => {
  it("redirects root to chat when auth cookie is present", () => {
    expect(resolveAuthRedirect("/", true)).toBe("/chat");
  });

  it("redirects root to login when auth cookie is missing", () => {
    expect(resolveAuthRedirect("/", false)).toBe("/login");
  });

  it("redirects chat routes to login when auth cookie is missing", () => {
    expect(resolveAuthRedirect("/chat", false)).toBe("/login");
    expect(resolveAuthRedirect("/chat/history", false)).toBe("/login");
  });

  it("allows chat routes when auth cookie is present", () => {
    expect(resolveAuthRedirect("/chat", true)).toBeNull();
    expect(resolveAuthRedirect("/chat/history", true)).toBeNull();
  });
});
