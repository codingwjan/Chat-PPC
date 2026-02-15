import { describe, expect, it } from "vitest";
import {
  parseAdminActionRequest,
  parseAdminOverviewRequest,
  parseAdminTasteQueryRequest,
  parseAuthSignInRequest,
  parseAuthSignUpRequest,
  parseCreateMessageRequest,
  parseExtendPollRequest,
  parseLoginRequest,
  parseMarkNotificationsReadRequest,
  parseReactMessageRequest,
  parseRenameUserRequest,
  parseTasteEventsQueryRequest,
  parseTasteProfileQueryRequest,
  parseUpdateChatBackgroundRequest,
  parseVotePollRequest,
} from "@/server/contracts";

describe("contracts", () => {
  it("parses valid restore session request", () => {
    const parsed = parseLoginRequest({
      clientId: "client-123",
      sessionToken: "token-123",
    });

    expect(parsed.clientId).toBe("client-123");
    expect(parsed.sessionToken).toBe("token-123");
  });

  it("parses valid sign-up request", () => {
    const parsed = parseAuthSignUpRequest({
      loginName: "max.mustermann",
      password: "geheimespasswort",
      displayName: "Max",
      profilePicture: "/default-avatar.svg",
    });
    expect(parsed.loginName).toBe("max.mustermann");
  });

  it("parses valid sign-in request", () => {
    const parsed = parseAuthSignInRequest({
      loginName: "max.mustermann",
      password: "geheimespasswort",
    });
    expect(parsed.loginName).toBe("max.mustermann");
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

  it("parses message reaction request", () => {
    const parsed = parseReactMessageRequest({
      clientId: "client-1",
      messageId: "msg-1",
      reaction: "LOL",
    });

    expect(parsed.reaction).toBe("LOL");
  });

  it("rejects invalid message reaction type", () => {
    expect(() =>
      parseReactMessageRequest({
        clientId: "client-1",
        messageId: "msg-1",
        reaction: "INVALID",
      }),
    ).toThrow();
  });

  it("parses mark-notifications-read request", () => {
    const parsed = parseMarkNotificationsReadRequest({
      clientId: "client-1",
      notificationIds: ["n1", "n2"],
    });

    expect(parsed.notificationIds).toEqual(["n1", "n2"]);
  });

  it("parses taste profile query request", () => {
    const parsed = parseTasteProfileQueryRequest({
      clientId: "client-1",
    });
    expect(parsed.clientId).toBe("client-1");
  });

  it("parses taste events query request", () => {
    const parsed = parseTasteEventsQueryRequest({
      clientId: "client-1",
      limit: "80",
      before: "2026-02-13T10:00:00.000Z",
    });
    expect(parsed.clientId).toBe("client-1");
    expect(parsed.limit).toBe(80);
    expect(parsed.before).toBe("2026-02-13T10:00:00.000Z");
  });

  it("parses admin overview request", () => {
    const parsed = parseAdminOverviewRequest({
      clientId: "client-1",
      devAuthToken: "dev-token",
    });

    expect(parsed.clientId).toBe("client-1");
  });

  it("parses admin taste query request", () => {
    const parsed = parseAdminTasteQueryRequest({
      clientId: "client-1",
      devAuthToken: "dev-token",
      limit: "20",
    });

    expect(parsed.limit).toBe(20);
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
