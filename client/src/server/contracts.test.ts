import { describe, expect, it } from "vitest";
import {
  parseCreateMessageRequest,
  parseLoginRequest,
  parseRenameUserRequest,
  parseVotePollRequest,
} from "@/server/contracts";

describe("contracts", () => {
  it("parses valid login request", () => {
    const parsed = parseLoginRequest({
      username: "cancelcloud",
      clientId: "client-123",
    });

    expect(parsed.username).toBe("cancelcloud");
    expect(parsed.clientId).toBe("client-123");
  });

  it("rejects too short usernames", () => {
    expect(() =>
      parseLoginRequest({
        username: "ab",
        clientId: "c-1",
      }),
    ).toThrow("username must be at least 3 characters");
  });

  it("parses valid rename request", () => {
    const parsed = parseRenameUserRequest({
      clientId: "client-123",
      newUsername: "newname",
    });

    expect(parsed.newUsername).toBe("newname");
  });

  it("parses profile-picture-only rename payload", () => {
    const parsed = parseRenameUserRequest({
      clientId: "client-123",
      profilePicture: "https://example.com/avatar.png",
    });

    expect(parsed.profilePicture).toBe("https://example.com/avatar.png");
    expect(parsed.newUsername).toBeUndefined();
  });

  it("rejects rename payload without username or profile picture", () => {
    expect(() =>
      parseRenameUserRequest({
        clientId: "client-123",
      }),
    ).toThrow("Either newUsername or profilePicture is required");
  });

  it("requires questionId for answers", () => {
    expect(() =>
      parseCreateMessageRequest({
        clientId: "client-1",
        type: "answer",
        message: "Hello",
      }),
    ).toThrow("questionId is required for answer");
  });

  it("parses vote request", () => {
    const parsed = parseVotePollRequest({
      clientId: "client-1",
      pollMessageId: "poll-1",
      side: "left",
    });

    expect(parsed.side).toBe("left");
  });
});
