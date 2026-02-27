import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";

const serviceMock = vi.hoisted(() => ({
  restoreSession: vi.fn(),
  signUpAccount: vi.fn(),
  signInAccount: vi.fn(),
  renameUser: vi.fn(),
  updateOwnAccount: vi.fn(),
  createMessage: vi.fn(),
  getMessages: vi.fn(),
  reactToMessage: vi.fn(),
  getNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  getPublicUserProfile: vi.fn(),
  getManagedBots: vi.fn(),
  getTasteProfile: vi.fn(),
  getTasteProfileDetailed: vi.fn(),
  getTasteProfileEvents: vi.fn(),
  votePoll: vi.fn(),
  extendPoll: vi.fn(),
  getChatBackground: vi.fn(),
  getAppKillState: vi.fn(),
  setChatBackground: vi.fn(),
  getAdminOverview: vi.fn(),
  getDeveloperTasteProfiles: vi.fn(),
  getAdminTasteProfileDetailed: vi.fn(),
  getAdminTasteProfileEvents: vi.fn(),
  getAdminUsers: vi.fn(),
  adminResetUserPassword: vi.fn(),
  runAdminAction: vi.fn(),
  getMediaItems: vi.fn(),
  createBot: vi.fn(),
  updateBot: vi.fn(),
  deleteBot: vi.fn(),
  processAiQueue: vi.fn(),
  processTaggingQueue: vi.fn(),
}));

vi.mock("@/server/chat-service", () => serviceMock);

describe("api routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stellt eine Sitzung wieder her", async () => {
    serviceMock.restoreSession.mockResolvedValue({
      clientId: "c1",
      username: "alice",
      sessionToken: "token-1",
      sessionExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ clientId: "c1", sessionToken: "token-1" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.username).toBe("alice");
    expect(response.headers.get("set-cookie")).toContain("chatppc.auth=active");
  });

  it("rejects invalid login payloads", async () => {
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ clientId: "c1" }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("registriert neue Konten", async () => {
    serviceMock.signUpAccount.mockResolvedValue({
      clientId: "c1",
      username: "alice",
      sessionToken: "token-1",
      sessionExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    const { POST } = await import("@/app/api/auth/signup/route");
    const response = await POST(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          loginName: "alice",
          password: "supergeheim",
          displayName: "Alice",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("chatppc.auth=active");
  });

  it("meldet bestehende Konten an", async () => {
    serviceMock.signInAccount.mockResolvedValue({
      clientId: "c1",
      username: "alice",
      sessionToken: "token-1",
      sessionExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    const { POST } = await import("@/app/api/auth/signin/route");
    const response = await POST(
      new Request("http://localhost/api/auth/signin", {
        method: "POST",
        body: JSON.stringify({
          loginName: "alice",
          password: "supergeheim",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("chatppc.auth=active");
  });

  it("löscht auth-cookie bei ungültiger Sitzung", async () => {
    serviceMock.restoreSession.mockRejectedValue(new AppError("Sitzung ist abgelaufen. Bitte erneut anmelden.", 401));
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ clientId: "c1", sessionToken: "expired-token" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("chatppc.auth=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("clears auth cookie via session endpoint", async () => {
    const { DELETE } = await import("@/app/api/auth/session/route");
    const response = await DELETE();

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("chatppc.auth=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("handles username change", async () => {
    serviceMock.renameUser.mockResolvedValue({ clientId: "c1", username: "newname" });
    const { PATCH } = await import("@/app/api/users/me/route");

    const response = await PATCH(
      new Request("http://localhost/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ clientId: "c1", newUsername: "newname" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.username).toBe("newname");
  });

  it("handles profile picture update", async () => {
    serviceMock.renameUser.mockResolvedValue({
      clientId: "c1",
      username: "newname",
      profilePicture: "https://example.com/new-avatar.png",
    });
    const { PATCH } = await import("@/app/api/users/me/route");

    const response = await PATCH(
      new Request("http://localhost/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          clientId: "c1",
          profilePicture: "https://example.com/new-avatar.png",
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("liefert öffentliches Nutzerprofil", async () => {
    serviceMock.getPublicUserProfile.mockResolvedValue({
      userId: "u-target",
      clientId: "target-1",
      username: "alice",
      profilePicture: "/default-avatar.svg",
      status: "online",
      isOnline: true,
      lastSeenAt: null,
      memberSince: "2026-01-01T00:00:00.000Z",
      member: {
        brand: "PPC Score",
        score: 200,
        rank: "BRONZE",
      },
      stats: {
        postsTotal: 10,
        reactionsGiven: 6,
        reactionsReceived: 8,
        pollsCreated: 1,
        pollVotes: 4,
        activeDays: 5,
      },
    });

    const { GET } = await import("@/app/api/users/profile/route");
    const response = await GET(
      new Request("http://localhost/api/users/profile?viewerClientId=viewer-1&targetClientId=target-1"),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.username).toBe("alice");
    expect(payload.stats.postsTotal).toBe(10);
  });

  it("liefert Bot-Managementdaten", async () => {
    serviceMock.getManagedBots.mockResolvedValue({
      items: [],
      limit: 2,
      used: 1,
      remaining: 1,
    });

    const { GET } = await import("@/app/api/bots/route");
    const response = await GET(new Request("http://localhost/api/bots?clientId=c1"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.limit).toBe(2);
  });

  it("erstellt Bots", async () => {
    serviceMock.createBot.mockResolvedValue({
      id: "bot-1",
      displayName: "Peter Griffin",
      profilePicture: "/default-avatar.svg",
      mentionHandle: "peter-griffin",
      languagePreference: "en",
      instructions: "Sei lustig",
      catchphrases: ["hehe"],
      autonomousEnabled: false,
      autonomousMinIntervalMinutes: 60,
      autonomousMaxIntervalMinutes: 240,
      autonomousPrompt: "",
      autonomousNextAt: null,
      createdAt: "2026-02-27T12:00:00.000Z",
      updatedAt: "2026-02-27T12:00:00.000Z",
    });

    const { POST } = await import("@/app/api/bots/route");
    const response = await POST(
      new Request("http://localhost/api/bots", {
        method: "POST",
        body: JSON.stringify({
          clientId: "c1",
          displayName: "Peter Griffin",
          mentionHandle: "@Peter-Griffin",
          languagePreference: "en",
          instructions: "Sei lustig",
          catchphrases: ["hehe"],
        }),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("aktualisiert Bots", async () => {
    serviceMock.updateBot.mockResolvedValue({
      id: "bot-1",
      displayName: "Peter Griffin",
      profilePicture: "/default-avatar.svg",
      mentionHandle: "peter-griffin",
      languagePreference: "de",
      instructions: "Mehr Chaos",
      catchphrases: [],
      autonomousEnabled: false,
      autonomousMinIntervalMinutes: 60,
      autonomousMaxIntervalMinutes: 240,
      autonomousPrompt: "",
      autonomousNextAt: null,
      createdAt: "2026-02-27T12:00:00.000Z",
      updatedAt: "2026-02-27T12:05:00.000Z",
    });

    const { PATCH } = await import("@/app/api/bots/[botId]/route");
    const response = await PATCH(
      new Request("http://localhost/api/bots/bot-1", {
        method: "PATCH",
        body: JSON.stringify({
          clientId: "c1",
          displayName: "Peter Griffin",
          mentionHandle: "peter-griffin",
          languagePreference: "de",
          instructions: "Mehr Chaos",
          catchphrases: [],
        }),
      }),
      { params: Promise.resolve({ botId: "bot-1" }) },
    );

    expect(response.status).toBe(200);
  });

  it("löscht Bots", async () => {
    serviceMock.deleteBot.mockResolvedValue({ ok: true });

    const { DELETE } = await import("@/app/api/bots/[botId]/route");
    const response = await DELETE(
      new Request("http://localhost/api/bots/bot-1", {
        method: "DELETE",
        body: JSON.stringify({
          clientId: "c1",
        }),
      }),
      { params: Promise.resolve({ botId: "bot-1" }) },
    );

    expect(response.status).toBe(200);
  });

  it("rejects empty profile/username update payload", async () => {
    const { PATCH } = await import("@/app/api/users/me/route");

    const response = await PATCH(
      new Request("http://localhost/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          clientId: "c1",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("updates own account security settings and refreshes cookie", async () => {
    serviceMock.updateOwnAccount.mockResolvedValue({
      id: "u1",
      clientId: "c1",
      username: "newname",
      profilePicture: "/default-avatar.svg",
      status: "",
      isOnline: true,
      lastSeenAt: null,
      loginName: "alice.new",
      sessionToken: "token-new",
      sessionExpiresAt: "2030-01-01T00:00:00.000Z",
      devMode: false,
    });
    const { PATCH } = await import("@/app/api/users/me/account/route");

    const response = await PATCH(
      new Request("http://localhost/api/users/me/account", {
        method: "PATCH",
        body: JSON.stringify({
          clientId: "c1",
          currentPassword: "supersecure123",
          newLoginName: "alice.new",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("chatppc.auth=active");
    const payload = await response.json();
    expect(payload.loginName).toBe("alice.new");
  });

  it("rejects invalid own-account security payload", async () => {
    const { PATCH } = await import("@/app/api/users/me/account/route");

    const response = await PATCH(
      new Request("http://localhost/api/users/me/account", {
        method: "PATCH",
        body: JSON.stringify({
          clientId: "c1",
          currentPassword: "supersecure123",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("bubbles own-account security service errors", async () => {
    serviceMock.updateOwnAccount.mockRejectedValue(new AppError("Aktuelles Passwort ist falsch.", 401));
    const { PATCH } = await import("@/app/api/users/me/account/route");

    const response = await PATCH(
      new Request("http://localhost/api/users/me/account", {
        method: "PATCH",
        body: JSON.stringify({
          clientId: "c1",
          currentPassword: "falschespasswort",
          newPassword: "newsecure123",
        }),
      }),
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error).toBe("Aktuelles Passwort ist falsch.");
  });

  it("creates messages", async () => {
    serviceMock.createMessage.mockResolvedValue({ id: "m1", type: "message" });
    const { POST } = await import("@/app/api/messages/route");

    const response = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          clientId: "c1",
          type: "message",
          message: "hello",
        }),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("reacts to messages", async () => {
    serviceMock.reactToMessage.mockResolvedValue({ id: "m1", type: "message" });
    const { POST } = await import("@/app/api/messages/react/route");

    const response = await POST(
      new Request("http://localhost/api/messages/react", {
        method: "POST",
        body: JSON.stringify({
          clientId: "c1",
          messageId: "m1",
          reaction: "LOL",
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects invalid reaction payload", async () => {
    const { POST } = await import("@/app/api/messages/react/route");

    const response = await POST(
      new Request("http://localhost/api/messages/react", {
        method: "POST",
        body: JSON.stringify({
          clientId: "c1",
          messageId: "m1",
          reaction: "INVALID",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rate limits reactions endpoint", async () => {
    serviceMock.reactToMessage.mockResolvedValue({ id: "m1", type: "message" });
    const { POST } = await import("@/app/api/messages/react/route");

    let status = 0;
    for (let index = 0; index < 41; index += 1) {
      const response = await POST(
        new Request("http://localhost/api/messages/react", {
          method: "POST",
          body: JSON.stringify({
            clientId: "c-rate-limit",
            messageId: "m1",
            reaction: "LOL",
          }),
        }),
      );
      status = response.status;
    }

    expect(status).toBe(429);
  });

  it("liefert Benachrichtigungen", async () => {
    serviceMock.getNotifications.mockResolvedValue({
      items: [],
      unreadCount: 0,
    });
    const { GET } = await import("@/app/api/notifications/route");

    const response = await GET(new Request("http://localhost/api/notifications?clientId=c1"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.unreadCount).toBe(0);
  });

  it("markiert Benachrichtigungen als gelesen", async () => {
    serviceMock.markNotificationsRead.mockResolvedValue({
      items: [],
      unreadCount: 0,
    });
    const { POST } = await import("@/app/api/notifications/read/route");
    const response = await POST(
      new Request("http://localhost/api/notifications/read", {
        method: "POST",
        body: JSON.stringify({ clientId: "c1" }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("liefert Taste-Profil", async () => {
    serviceMock.getTasteProfile.mockResolvedValue({
      userId: "u1",
      windowDays: 30,
      updatedAt: "2026-02-13T16:00:00.000Z",
      reactionsReceived: 0,
      reactionDistribution: [],
      topTags: [],
    });
    const { GET } = await import("@/app/api/me/taste/route");
    const response = await GET(new Request("http://localhost/api/me/taste?clientId=c1"));
    expect(response.status).toBe(200);
  });

  it("liefert detailliertes Taste-Profil", async () => {
    serviceMock.getTasteProfileDetailed.mockResolvedValue({
      userId: "u1",
      generatedAt: "2026-02-13T16:00:00.000Z",
      memberBreakdown: {
        messagesCreated: 0,
        reactionsGiven: 0,
        reactionsReceived: 0,
        aiMentions: 0,
        pollsCreated: 0,
        pollsExtended: 0,
        pollVotes: 0,
        taggingCompleted: 0,
        usernameChanges: 0,
        rawScore: 0,
      },
      windows: {
        "7d": {
          reactions: { givenTotal: 0, receivedTotal: 0, givenByType: [], receivedByType: [] },
          interests: {
            topTags: [],
            topMessageCategories: { themes: [], humor: [], art: [], tone: [], topics: [] },
            topImageCategories: { themes: [], humor: [], art: [], tone: [], objects: [] },
          },
          activity: {
            postsTotal: 0,
            postsByType: [],
            postsWithImages: 0,
            pollVotesGiven: 0,
            pollsCreated: 0,
            pollsExtended: 0,
            aiMentions: { chatgpt: 0, grok: 0 },
            activeDays: 0,
            activityByWeekday: [],
            activityByHour: [],
            tagging: { completed: 0, failed: 0, pending: 0, coverage: 0 },
          },
          social: { topInteractedUsers: [] },
        },
        "30d": {
          reactions: { givenTotal: 0, receivedTotal: 0, givenByType: [], receivedByType: [] },
          interests: {
            topTags: [],
            topMessageCategories: { themes: [], humor: [], art: [], tone: [], topics: [] },
            topImageCategories: { themes: [], humor: [], art: [], tone: [], objects: [] },
          },
          activity: {
            postsTotal: 0,
            postsByType: [],
            postsWithImages: 0,
            pollVotesGiven: 0,
            pollsCreated: 0,
            pollsExtended: 0,
            aiMentions: { chatgpt: 0, grok: 0 },
            activeDays: 0,
            activityByWeekday: [],
            activityByHour: [],
            tagging: { completed: 0, failed: 0, pending: 0, coverage: 0 },
          },
          social: { topInteractedUsers: [] },
        },
        all: {
          reactions: { givenTotal: 0, receivedTotal: 0, givenByType: [], receivedByType: [] },
          interests: {
            topTags: [],
            topMessageCategories: { themes: [], humor: [], art: [], tone: [], topics: [] },
            topImageCategories: { themes: [], humor: [], art: [], tone: [], objects: [] },
          },
          activity: {
            postsTotal: 0,
            postsByType: [],
            postsWithImages: 0,
            pollVotesGiven: 0,
            pollsCreated: 0,
            pollsExtended: 0,
            aiMentions: { chatgpt: 0, grok: 0 },
            activeDays: 0,
            activityByWeekday: [],
            activityByHour: [],
            tagging: { completed: 0, failed: 0, pending: 0, coverage: 0 },
          },
          social: { topInteractedUsers: [] },
        },
      },
      transparency: {
        eventRetentionDays: 180,
        rawEventsAvailableSince: "2026-02-10T10:00:00.000Z",
        sources: [],
      },
    });

    const { GET } = await import("@/app/api/me/taste/profile/route");
    const response = await GET(new Request("http://localhost/api/me/taste/profile?clientId=c1"));
    expect(response.status).toBe(200);
  });

  it("liefert Taste-Rohdaten-Events", async () => {
    serviceMock.getTasteProfileEvents.mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null,
    });

    const { GET } = await import("@/app/api/me/taste/events/route");
    const response = await GET(new Request("http://localhost/api/me/taste/events?clientId=c1&limit=50"));
    expect(response.status).toBe(200);
  });

  it("validiert Taste-Rohdaten-Query", async () => {
    const { GET } = await import("@/app/api/me/taste/events/route");
    const response = await GET(new Request("http://localhost/api/me/taste/events?clientId=c1&limit=5000"));
    expect(response.status).toBe(400);
  });

  it("gets chat background", async () => {
    serviceMock.getChatBackground.mockResolvedValue({ url: "https://example.com/bg.png" });
    const { GET } = await import("@/app/api/chat/background/route");

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.url).toBe("https://example.com/bg.png");
  });

  it("updates chat background", async () => {
    serviceMock.setChatBackground.mockResolvedValue({ url: "https://example.com/bg-next.png" });
    const { POST } = await import("@/app/api/chat/background/route");

    const response = await POST(
      new Request("http://localhost/api/chat/background", {
        method: "POST",
        body: JSON.stringify({ clientId: "c1", url: "https://example.com/bg-next.png" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.url).toBe("https://example.com/bg-next.png");
  });

  it("gets app kill state", async () => {
    serviceMock.getAppKillState.mockResolvedValue({
      enabled: true,
      updatedAt: "2026-02-18T10:00:00.000Z",
      updatedBy: "admin",
    });
    const { GET } = await import("@/app/api/app/kill/route");

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.enabled).toBe(true);
    expect(payload.updatedBy).toBe("admin");
  });

  it("surfaces poll vote uniqueness errors", async () => {
    serviceMock.votePoll.mockRejectedValue(new AppError("You have already voted on this poll", 409));
    const { POST } = await import("@/app/api/polls/vote/route");

    const response = await POST(
      new Request("http://localhost/api/polls/vote", {
        method: "POST",
        body: JSON.stringify({ clientId: "c1", pollMessageId: "poll-1", side: "left" }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("extends existing polls", async () => {
    serviceMock.extendPoll.mockResolvedValue({ id: "poll-1", type: "votingPoll" });
    const { POST } = await import("@/app/api/polls/extend/route");

    const response = await POST(
      new Request("http://localhost/api/polls/extend", {
        method: "POST",
        body: JSON.stringify({
          clientId: "c1",
          pollMessageId: "poll-1",
          pollOptions: ["Option C"],
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("gets admin overview for developer mode", async () => {
    serviceMock.getAdminOverview.mockResolvedValue({
      usersTotal: 4,
      usersOnline: 3,
      messagesTotal: 120,
      pollsTotal: 8,
      blacklistTotal: 1,
    });
    const { GET } = await import("@/app/api/admin/route");

    const response = await GET(
      new Request("http://localhost/api/admin?clientId=c1&devAuthToken=token-1", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.usersOnline).toBe(3);
  });

  it("runs admin action for developer mode", async () => {
    serviceMock.runAdminAction.mockResolvedValue({
      ok: true,
      message: "Alles wurde zurückgesetzt.",
      overview: {
        usersTotal: 1,
        usersOnline: 1,
        messagesTotal: 1,
        pollsTotal: 0,
        blacklistTotal: 0,
      },
    });
    const { POST } = await import("@/app/api/admin/route");

    const response = await POST(
      new Request("http://localhost/api/admin", {
        method: "POST",
        body: JSON.stringify({
          clientId: "c1",
          devAuthToken: "token-1",
          action: "reset_all",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
  });

  it("liefert Interessenprofile für den Entwicklermodus", async () => {
    serviceMock.getDeveloperTasteProfiles.mockResolvedValue({
      items: [],
    });
    const { GET } = await import("@/app/api/admin/tastes/route");

    const response = await GET(
      new Request("http://localhost/api/admin/tastes?clientId=c1&devAuthToken=token-1&limit=25", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.items).toEqual([]);
  });

  it("liefert detailliertes Interessenprofil für einen Nutzer im Entwicklermodus", async () => {
    serviceMock.getAdminTasteProfileDetailed.mockResolvedValue({
      userId: "u-target",
      generatedAt: "2026-02-18T08:00:00.000Z",
      member: {
        brand: "PPC Score",
        score: 123,
        rank: "BRONZE",
      },
      memberBreakdown: {
        messagesCreated: 10,
        reactionsGiven: 5,
        reactionsReceived: 9,
        aiMentions: 1,
        pollsCreated: 2,
        pollsExtended: 1,
        pollVotes: 4,
        taggingCompleted: 3,
        usernameChanges: 0,
        rawScore: 123,
      },
      windows: {
        "7d": {
          reactions: { givenTotal: 0, receivedTotal: 0, givenByType: [], receivedByType: [] },
          interests: {
            topTags: [],
            topMessageCategories: { themes: [], humor: [], art: [], tone: [], topics: [] },
            topImageCategories: { themes: [], humor: [], art: [], tone: [], objects: [] },
          },
          activity: {
            postsTotal: 0,
            postsByType: [],
            postsWithImages: 0,
            pollVotesGiven: 0,
            pollsCreated: 0,
            pollsExtended: 0,
            aiMentions: { chatgpt: 0, grok: 0 },
            activeDays: 0,
            activityByWeekday: [],
            activityByHour: [],
            tagging: { completed: 0, failed: 0, pending: 0, coverage: 0 },
          },
          social: { topInteractedUsers: [] },
        },
        "30d": {
          reactions: { givenTotal: 0, receivedTotal: 0, givenByType: [], receivedByType: [] },
          interests: {
            topTags: [],
            topMessageCategories: { themes: [], humor: [], art: [], tone: [], topics: [] },
            topImageCategories: { themes: [], humor: [], art: [], tone: [], objects: [] },
          },
          activity: {
            postsTotal: 0,
            postsByType: [],
            postsWithImages: 0,
            pollVotesGiven: 0,
            pollsCreated: 0,
            pollsExtended: 0,
            aiMentions: { chatgpt: 0, grok: 0 },
            activeDays: 0,
            activityByWeekday: [],
            activityByHour: [],
            tagging: { completed: 0, failed: 0, pending: 0, coverage: 0 },
          },
          social: { topInteractedUsers: [] },
        },
        all: {
          reactions: { givenTotal: 0, receivedTotal: 0, givenByType: [], receivedByType: [] },
          interests: {
            topTags: [],
            topMessageCategories: { themes: [], humor: [], art: [], tone: [], topics: [] },
            topImageCategories: { themes: [], humor: [], art: [], tone: [], objects: [] },
          },
          activity: {
            postsTotal: 0,
            postsByType: [],
            postsWithImages: 0,
            pollVotesGiven: 0,
            pollsCreated: 0,
            pollsExtended: 0,
            aiMentions: { chatgpt: 0, grok: 0 },
            activeDays: 0,
            activityByWeekday: [],
            activityByHour: [],
            tagging: { completed: 0, failed: 0, pending: 0, coverage: 0 },
          },
          social: { topInteractedUsers: [] },
        },
      },
      transparency: {
        eventRetentionDays: 30,
        rawEventsAvailableSince: "2026-02-01T00:00:00.000Z",
        sources: [],
      },
    });
    const { GET } = await import("@/app/api/admin/tastes/profile/route");

    const response = await GET(
      new Request("http://localhost/api/admin/tastes/profile?clientId=c1&devAuthToken=token-1&targetClientId=target-1", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.userId).toBe("u-target");
  });

  it("liefert Interessen-Rohdaten-Events für einen Nutzer im Entwicklermodus", async () => {
    serviceMock.getAdminTasteProfileEvents.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    const { GET } = await import("@/app/api/admin/tastes/events/route");

    const response = await GET(
      new Request("http://localhost/api/admin/tastes/events?clientId=c1&devAuthToken=token-1&targetClientId=target-1&limit=50", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.items).toEqual([]);
    expect(payload.hasMore).toBe(false);
  });

  it("liefert Admin-Userliste für den Entwicklermodus", async () => {
    serviceMock.getAdminUsers.mockResolvedValue({
      items: [
        {
          userId: "u1",
          clientId: "c1",
          username: "alice",
          profilePicture: "/avatar.png",
          loginName: "alice.login",
          hasAccount: true,
          canResetPassword: true,
          isOnline: false,
        },
      ],
    });
    const { GET } = await import("@/app/api/admin/users/route");

    const response = await GET(
      new Request("http://localhost/api/admin/users?clientId=c1&devAuthToken=token-1", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.items[0]?.loginName).toBe("alice.login");
  });

  it("setzt Passwort über Admin-Route zurück", async () => {
    serviceMock.adminResetUserPassword.mockResolvedValue({
      ok: true,
      message: "Passwort für alice wurde zurückgesetzt.",
    });
    const { POST } = await import("@/app/api/admin/users/reset-password/route");

    const response = await POST(
      new Request("http://localhost/api/admin/users/reset-password", {
        method: "POST",
        body: JSON.stringify({
          clientId: "c1",
          devAuthToken: "token-1",
          targetUserId: "u1",
          newPassword: "supersecure123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
  });

  it("gets media from full chat history", async () => {
    serviceMock.getMediaItems.mockResolvedValue({
      items: [
        {
          id: "m1-0",
          url: "https://example.com/image.jpg",
          username: "alice",
          createdAt: "2026-02-11T12:00:00.000Z",
        },
      ],
      hasMore: false,
      nextCursor: null,
      total: 1,
    });
    const { GET } = await import("@/app/api/media/route");

    const response = await GET(new Request("http://localhost/api/media?limit=3"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.items[0]?.url).toBe("https://example.com/image.jpg");
  });

  it("runs ai worker for ai + tagging queues", async () => {
    serviceMock.processAiQueue.mockResolvedValue({ processed: 2, lockSkipped: false });
    serviceMock.processTaggingQueue.mockResolvedValue({ processed: 3, lockSkipped: false });
    const { POST } = await import("@/app/api/ai/worker/route");

    const response = await POST(
      new Request("http://localhost/api/ai/worker", {
        method: "POST",
        body: JSON.stringify({ maxJobs: 5 }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ai?.processed).toBe(2);
    expect(payload.tagging?.processed).toBe(3);
  });

  it("returns 503 for profile upload without blob token", async () => {
    const prevBlob = process.env.BLOB_READ_WRITE_TOKEN;
    const prevBlobAlias = process.env.BLOB;
    const prevInline = process.env.ALLOW_INLINE_UPLOADS;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB;
    delete process.env.ALLOW_INLINE_UPLOADS;

    try {
      const { POST } = await import("@/app/api/uploads/profile/route");
      const formData = new FormData();
      formData.set("file", new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" }));

      const response = await POST(
        new Request("http://localhost/api/uploads/profile", {
          method: "POST",
          body: formData,
        }),
      );

      expect(response.status).toBe(503);
    } finally {
      if (prevBlob) process.env.BLOB_READ_WRITE_TOKEN = prevBlob;
      else delete process.env.BLOB_READ_WRITE_TOKEN;
      if (prevBlobAlias) process.env.BLOB = prevBlobAlias;
      else delete process.env.BLOB;

      if (prevInline) process.env.ALLOW_INLINE_UPLOADS = prevInline;
      else delete process.env.ALLOW_INLINE_UPLOADS;
    }
  });

  it("returns 503 for chat upload without blob token", async () => {
    const prevBlob = process.env.BLOB_READ_WRITE_TOKEN;
    const prevBlobAlias = process.env.BLOB;
    const prevInline = process.env.ALLOW_INLINE_UPLOADS;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB;
    delete process.env.ALLOW_INLINE_UPLOADS;

    try {
      const { POST } = await import("@/app/api/uploads/chat/route");
      const formData = new FormData();
      formData.set("file", new File([new Uint8Array([1, 2, 3])], "chat.png", { type: "image/png" }));

      const response = await POST(
        new Request("http://localhost/api/uploads/chat", {
          method: "POST",
          body: formData,
        }),
      );

      expect(response.status).toBe(503);
    } finally {
      if (prevBlob) process.env.BLOB_READ_WRITE_TOKEN = prevBlob;
      else delete process.env.BLOB_READ_WRITE_TOKEN;
      if (prevBlobAlias) process.env.BLOB = prevBlobAlias;
      else delete process.env.BLOB;

      if (prevInline) process.env.ALLOW_INLINE_UPLOADS = prevInline;
      else delete process.env.ALLOW_INLINE_UPLOADS;
    }
  });
});
