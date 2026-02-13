import { describe, expect, it } from "vitest";
import {
  parseAdminActionRequest,
  parseAdminOverviewRequest,
  parseCreateMessageRequest,
  parseExtendPollRequest,
  parseLoginRequest,
  parseRenameUserRequest,
  parseUpdateChatBackgroundRequest,
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

  it("parses login request with app-relative profile picture", () => {
    const parsed = parseLoginRequest({
      username: "cancelcloud",
      clientId: "client-123",
      profilePicture: "/default-avatar.svg",
    });

    expect(parsed.profilePicture).toBe("/default-avatar.svg");
  });

  it("rejects too short usernames", () => {
    expect(() =>
      parseLoginRequest({
        username: "ab",
        clientId: "c-1",
      }),
    ).toThrow("username muss mindestens 3 Zeichen lang sein");
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

  it("parses profile-picture-only rename payload with app-relative path", () => {
    const parsed = parseRenameUserRequest({
      clientId: "client-123",
      profilePicture: "/default-avatar.svg",
    });

    expect(parsed.profilePicture).toBe("/default-avatar.svg");
    expect(parsed.newUsername).toBeUndefined();
  });

  it("rejects rename payload without username or profile picture", () => {
    expect(() =>
      parseRenameUserRequest({
        clientId: "client-123",
      }),
    ).toThrow("Entweder newUsername oder profilePicture ist erforderlich");
  });

  it("rejects data URLs for profilePicture updates", () => {
    expect(() =>
      parseRenameUserRequest({
        clientId: "client-123",
        profilePicture: "data:image/png;base64,abcd",
      }),
    ).toThrow("profilePicture darf keine data-URL sein");
  });

  it("rejects data URLs for chat background updates", () => {
    expect(() =>
      parseUpdateChatBackgroundRequest({
        clientId: "client-123",
        url: "data:image/png;base64,abcd",
      }),
    ).toThrow("url darf keine data-URL sein");
  });

  it("requires questionId for answers", () => {
    expect(() =>
      parseCreateMessageRequest({
        clientId: "client-1",
        type: "answer",
        message: "Hello",
      }),
    ).toThrow("questionId ist für Antworten erforderlich");
  });

  it("parses vote request", () => {
    const parsed = parseVotePollRequest({
      clientId: "client-1",
      pollMessageId: "poll-1",
      side: "left",
    });

    expect(parsed.side).toBe("left");
  });

  it("parses extend-poll request", () => {
    const parsed = parseExtendPollRequest({
      clientId: "client-1",
      pollMessageId: "poll-1",
      pollOptions: ["Neu 1", "Neu 2"],
    });

    expect(parsed.pollOptions).toEqual(["Neu 1", "Neu 2"]);
  });

  it("requires at least one new option for extend-poll", () => {
    expect(() =>
      parseExtendPollRequest({
        clientId: "client-1",
        pollMessageId: "poll-1",
        pollOptions: [],
      }),
    ).toThrow("Mindestens eine Umfrageoption ist erforderlich");
  });

  it("parses admin overview request", () => {
    const parsed = parseAdminOverviewRequest({
      clientId: "client-1",
      devAuthToken: "dev-token",
    });

    expect(parsed.clientId).toBe("client-1");
  });

  it("requires targetUsername for delete_user admin action", () => {
    expect(() =>
      parseAdminActionRequest({
        clientId: "client-1",
        devAuthToken: "dev-token",
        action: "delete_user",
      }),
    ).toThrow("targetUsername ist für delete_user erforderlich");
  });
});
