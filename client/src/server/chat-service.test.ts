import { MessageType } from "@prisma/client";
import { scryptSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptLoginName, hashLoginNameLookup } from "@/server/login-name-crypto";

const prismaMock = vi.hoisted(() => ({
  blacklistEntry: { findUnique: vi.fn() },
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  bot: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  message: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
  },
  pollChoiceVote: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    groupBy: vi.fn(),
  },
  aiJob: {
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  messageTagJob: {
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  messageReaction: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  notification: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  userTasteProfile: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
  userBehaviorEvent: {
    create: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));

const publishMock = vi.hoisted(() => vi.fn());
const openAiCreateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/sse-bus", () => ({ publish: publishMock }));
vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: openAiCreateMock };
  },
}));

import {
  __extractAiPollPayloadForTests,
  __resetAiQueueForTests,
  createBot,
  createMessage,
  deleteBot,
  extendPoll,
  getAppKillState,
  getBotLimitForRank,
  getChatBackground,
  getManagedBots,
  getPublicUserProfile,
  getTasteProfileDetailed,
  getTasteProfileEvents,
  loginUser,
  markUserOffline,
  processTaggingQueue,
  processAiQueue,
  recomputePpcMemberForUser,
  pingPresence,
  reactToMessage,
  renameUser,
  restoreSession,
  signInAccount,
  setChatBackground,
  setAppKillState,
  updateBot,
  updateOwnAccount,
  votePoll,
} from "@/server/chat-service";

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    type: MessageType.MESSAGE,
    content: "hello",
    authorName: "tester",
    authorProfilePicture: "https://example.com/avatar.png",
    authorId: "user-id",
    optionOne: null,
    optionTwo: null,
    pollLeftCount: 0,
    pollRightCount: 0,
    pollMultiSelect: false,
    pollAllowVoteChange: false,
    questionMessageId: null,
    taggingStatus: null,
    taggingPayload: null,
    taggingUpdatedAt: null,
    taggingError: null,
    createdAt: new Date("2026-02-10T10:00:00.000Z"),
    questionMessage: null,
    pollOptions: [],
    reactions: [],
    author: null,
    ...overrides,
  };
}

function baseReaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "reaction-1",
    messageId: "m1",
    userId: "user-id",
    reaction: "LOL",
    createdAt: new Date("2026-02-10T10:00:00.000Z"),
    updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    user: {
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
      updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    },
    ...overrides,
  };
}

function makePasswordHash(password: string): string {
  const salt = "testsalt";
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function baseBot(overrides: Record<string, unknown> = {}) {
  return {
    id: "bot-1",
    displayName: "Peter Griffin",
    profilePicture: "https://example.com/bot.png",
    mentionHandle: "peter-griffin",
    languagePreference: "all",
    instructions: "Sei ein chaotischer Familienvater.",
    catchphrases: ["hehehehe", "Lois!"],
    deletedAt: null,
    createdAt: new Date("2026-02-10T10:00:00.000Z"),
    updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    owner: {
      id: "user-id",
      username: "tester",
    },
    ...overrides,
  };
}

describe("chat service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAiQueueForTests();
    prismaMock.blacklistEntry.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.update.mockResolvedValue({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.user.delete.mockResolvedValue({
      id: "deleted-user",
      clientId: "deleted-client",
      username: "deleted",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: false,
      lastSeenAt: null,
    });
    prismaMock.bot.count.mockResolvedValue(0);
    prismaMock.bot.findMany.mockResolvedValue([]);
    prismaMock.bot.findUnique.mockResolvedValue(null);
    prismaMock.bot.create.mockResolvedValue(baseBot());
    prismaMock.bot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.message.create.mockResolvedValue(baseMessage());
    prismaMock.message.findUnique.mockResolvedValue(null);
    prismaMock.message.findFirst.mockResolvedValue(null);
    prismaMock.message.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.message.count.mockResolvedValue(0);
    prismaMock.pollChoiceVote.findMany.mockResolvedValue([]);
    prismaMock.pollChoiceVote.createMany.mockResolvedValue({ count: 1 });
    prismaMock.pollChoiceVote.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.pollChoiceVote.groupBy.mockResolvedValue([]);
    prismaMock.aiJob.count.mockResolvedValue(0);
    prismaMock.aiJob.create.mockResolvedValue({ id: "job-1" });
    prismaMock.aiJob.update.mockResolvedValue({ id: "job-1" });
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.messageTagJob.count.mockResolvedValue(0);
    prismaMock.messageTagJob.create.mockResolvedValue({ id: "tag-job-1" });
    prismaMock.messageTagJob.update.mockResolvedValue({ id: "tag-job-1" });
    prismaMock.messageTagJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.messageReaction.findUnique.mockResolvedValue(null);
    prismaMock.messageReaction.findMany.mockResolvedValue([]);
    prismaMock.messageReaction.count.mockResolvedValue(0);
    prismaMock.messageReaction.create.mockResolvedValue({ id: "reaction-1" });
    prismaMock.messageReaction.update.mockResolvedValue({ id: "reaction-1" });
    prismaMock.messageReaction.delete.mockResolvedValue({ id: "reaction-1" });
    prismaMock.notification.create.mockResolvedValue({
      id: "notification-1",
      userId: "author-1",
      actorUserId: "user-id",
      actorUsernameSnapshot: "tester",
      messageId: "m1",
      reaction: "LOL",
      messagePreview: "hello",
      isRead: false,
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
      readAt: null,
      updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.notification.findMany.mockResolvedValue([]);
    prismaMock.notification.count.mockResolvedValue(0);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.userTasteProfile.upsert.mockResolvedValue({
      id: "taste-1",
      userId: "user-id",
      windowDays: 30,
      payload: {},
      updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.userTasteProfile.findUnique.mockResolvedValue({
      id: "taste-1",
      userId: "user-id",
      windowDays: 30,
      payload: {
        reactionsReceived: 0,
        reactionDistribution: [],
        topTags: [],
      },
      updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.userBehaviorEvent.create.mockResolvedValue({
      id: "behavior-1",
      userId: "user-id",
      type: "MESSAGE_CREATED",
      messageId: "m1",
      relatedUserId: null,
      reaction: null,
      preview: "hello",
      meta: null,
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
      expiresAt: new Date("2026-08-10T10:00:00.000Z"),
    });
    prismaMock.userBehaviorEvent.groupBy.mockResolvedValue([]);
    prismaMock.userBehaviorEvent.findMany.mockResolvedValue([]);
    prismaMock.userBehaviorEvent.findFirst.mockResolvedValue(null);
    prismaMock.userBehaviorEvent.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.$queryRaw.mockResolvedValue([{ locked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    openAiCreateMock.mockResolvedValue({ output_text: "", output: [] });
  });

  it("extracts valid AI poll payload from POLL_JSON block", () => {
    const payload = __extractAiPollPayloadForTests(
      '<POLL_JSON>{"question":"Welche Farbe?","options":["Rot","Blau"],"multiSelect":false}</POLL_JSON>',
    );
    expect(payload).toEqual({
      question: "Welche Farbe?",
      options: ["Rot", "Blau"],
      multiSelect: false,
    });
  });

  it("rejects malformed AI poll payloads", () => {
    expect(__extractAiPollPayloadForTests("<POLL_JSON>{invalid-json}</POLL_JSON>")).toBeNull();
    expect(
      __extractAiPollPayloadForTests(
        '<POLL_JSON>{"question":"Q","options":["A","A"],"multiSelect":false}</POLL_JSON>',
      ),
    ).toBeNull();
    expect(
      __extractAiPollPayloadForTests(
        '<POLL_JSON>{"question":"Q","options":["A"],"multiSelect":false}</POLL_JSON>',
      ),
    ).toBeNull();
    expect(
      __extractAiPollPayloadForTests(
        `<POLL_JSON>${JSON.stringify({
          question: "Q",
          options: Array.from({ length: 16 }, (_, i) => `Option ${i + 1}`),
          multiSelect: false,
        })}</POLL_JSON>`,
      ),
    ).toBeNull();
  });

  it("extracts AI poll payload from numbered survey text fallback", () => {
    const payload = __extractAiPollPayloadForTests(`
Alles klar, wir machen das sauber.

**Umfrage: Papa Kellerbar – was ist Phase?**

1. Familie geht vor. Kellerbar kann warten.
2. Erst kurz in die Kellerbar, dann maybe Familie.
3. Direkt Kellerbar. Kinder wachsen auch ohne mich auf.

Abstimmen und ehrlich sein.
`);

    expect(payload).toEqual({
      question: "Papa Kellerbar – was ist Phase?",
      options: [
        "Familie geht vor. Kellerbar kann warten.",
        "Erst kurz in die Kellerbar, dann maybe Familie.",
        "Direkt Kellerbar. Kinder wachsen auch ohne mich auf.",
      ],
      multiSelect: false,
    });
  });

  it("extracts AI poll payload from lettered markdown-style poll text", () => {
    const payload = __extractAiPollPayloadForTests(`
Alles klar, Reset gedrückt. Neue Umfrage, komplett clean.

UMFRAGE: Was ist das unnötigste Schulfach?

A) Mathe – Zahlen greifen mich persönlich an
B) Kunst – „Interpretation“ = ich hab einfach nix gekonnt
C) Sport – Ich schwitze nicht für Noten
D) Musik – Blockflöte war ein Fehler

Abstimmen und begründen.
`);

    expect(payload).toEqual({
      question: "Was ist das unnötigste Schulfach?",
      options: [
        "Mathe – Zahlen greifen mich persönlich an",
        "Kunst – „Interpretation“ = ich hab einfach nix gekonnt",
        "Sport – Ich schwitze nicht für Noten",
        "Musik – Blockflöte war ein Fehler",
      ],
      multiSelect: false,
    });
  });

  it("rejects blacklisted usernames on login", async () => {
    prismaMock.blacklistEntry.findUnique.mockResolvedValueOnce({
      id: "blocked",
      username: "badname",
    });

    await expect(loginUser({ username: "badname", clientId: "client-1" })).rejects.toThrow(
      "Dieser Benutzername ist nicht erlaubt",
    );
  });

  it('posts "ist dem Chat beigetreten" system message when legacy account is created', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.upsert.mockResolvedValue({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "sys-join",
        content: "tester ist dem Chat beigetreten",
        authorName: "System",
      }),
    );

    await loginUser({ username: "tester", clientId: "client-1" });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "tester ist dem Chat beigetreten",
          authorName: "System",
          authorId: "user-id",
        }),
      }),
    );
  });

  it("continues legacy login when system message columns are missing", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.message.create
      .mockRejectedValueOnce(new Error("The column `(not available)` does not exist in the current database."))
      .mockResolvedValueOnce({ id: "sys-join-fallback" });

    await expect(loginUser({ username: "tester", clientId: "client-1" })).resolves.toMatchObject({
      username: "tester",
      clientId: "client-1",
    });
    expect(prismaMock.message.create).toHaveBeenCalledTimes(2);
  });

  it("does not post system message on legacy login of an existing account", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      isOnline: false,
    });
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    await loginUser({ username: "tester", clientId: "client-1" });

    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("allows username reuse when previous owner is offline", async () => {
    prismaMock.user.findFirst.mockImplementationOnce(async (args: { where?: { isOnline?: boolean } }) => {
      if (args?.where?.isOnline === true) {
        return null;
      }

      return {
        id: "offline-user",
        clientId: "offline-client",
        username: "tester",
        profilePicture: "https://example.com/avatar.png",
        status: "",
        isOnline: false,
        lastSeenAt: new Date("2026-02-10T09:00:00.000Z"),
      };
    });
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "new-user",
      clientId: "client-2",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    await expect(loginUser({ username: "tester", clientId: "client-2" })).resolves.toMatchObject({
      username: "tester",
      clientId: "client-2",
    });

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isOnline: true,
        }),
      }),
    );
  });

  it("blocks username reuse when another user is online", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: "online-user",
      clientId: "client-online",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    await expect(loginUser({ username: "tester", clientId: "client-2" })).rejects.toThrow(
      "Dieser Benutzername ist bereits vergeben",
    );
  });

  it("signs in with encrypted login lookup", async () => {
    const encrypted = encryptLoginName("alice.login");
    const lookup = hashLoginNameLookup("alice.login");
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: null,
      loginNameEncrypted: encrypted,
      loginNameLookup: lookup,
      passwordHash: makePasswordHash("supersecure123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: false,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: null,
      loginNameEncrypted: encrypted,
      loginNameLookup: lookup,
      passwordHash: makePasswordHash("supersecure123"),
      sessionToken: "new-token",
      sessionExpiresAt: new Date("2026-02-10T11:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:30:00.000Z"),
      createdAt: new Date("2026-02-10T09:00:00.000Z"),
      updatedAt: new Date("2026-02-10T10:30:00.000Z"),
    });

    const result = await signInAccount({
      loginName: "alice.login",
      password: "supersecure123",
    });

    expect(result.clientId).toBe("client-1");
    expect(result.loginName).toBe("alice.login");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          loginName: null,
        }),
      }),
    );
  });

  it("falls back to legacy sign-in when encrypted login columns are missing", async () => {
    prismaMock.user.findFirst
      .mockRejectedValueOnce(new Error("The column `(not available)` does not exist in the current database."))
      .mockResolvedValueOnce({
        id: "legacy-account-user",
        clientId: "client-legacy-2",
        loginName: "legacy.only",
        passwordHash: makePasswordHash("supersecure123"),
        sessionToken: "old-token",
        sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
        username: "Legacy Only",
        profilePicture: "https://example.com/avatar.png",
        status: "",
        isOnline: false,
        lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
      });

    prismaMock.user.update.mockResolvedValueOnce({
      id: "legacy-account-user",
      clientId: "client-legacy-2",
      loginName: "legacy.only",
      passwordHash: makePasswordHash("supersecure123"),
      sessionToken: "new-token",
      sessionExpiresAt: new Date("2026-02-10T11:00:00.000Z"),
      username: "Legacy Only",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:30:00.000Z"),
      createdAt: new Date("2026-02-10T09:00:00.000Z"),
      updatedAt: new Date("2026-02-10T10:30:00.000Z"),
    });

    const result = await signInAccount({
      loginName: "legacy.only",
      password: "supersecure123",
    });

    expect(result.clientId).toBe("client-legacy-2");
    expect(result.loginName).toBe("legacy.only");
  });

  it("falls back to legacy update when encrypted columns are missing during sign-in update", async () => {
    const encrypted = encryptLoginName("legacy.update");
    const lookup = hashLoginNameLookup("legacy.update");
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: "legacy-update-user",
      clientId: "client-legacy-update",
      loginName: "legacy.update",
      loginNameEncrypted: encrypted,
      loginNameLookup: lookup,
      passwordHash: makePasswordHash("supersecure123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Legacy Update",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: false,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.update
      .mockRejectedValueOnce(new Error("The column `(not available)` does not exist in the current database."))
      .mockResolvedValueOnce({
        id: "legacy-update-user",
        clientId: "client-legacy-update",
        loginName: "legacy.update",
        passwordHash: makePasswordHash("supersecure123"),
        sessionToken: "new-token",
        sessionExpiresAt: new Date("2026-02-10T11:00:00.000Z"),
        username: "Legacy Update",
        profilePicture: "https://example.com/avatar.png",
        status: "",
        isOnline: true,
        lastSeenAt: new Date("2026-02-10T10:30:00.000Z"),
        createdAt: new Date("2026-02-10T09:00:00.000Z"),
        updatedAt: new Date("2026-02-10T10:30:00.000Z"),
      });

    const result = await signInAccount({
      loginName: "legacy.update",
      password: "supersecure123",
    });

    expect(result.clientId).toBe("client-legacy-update");
    expect(result.loginName).toBe("legacy.update");
    expect(prismaMock.user.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.not.objectContaining({
          loginNameEncrypted: expect.any(String),
          loginNameLookup: expect.any(String),
          loginName: null,
        }),
      }),
    );
  });

  it("migrates legacy plain loginName to encrypted fields on sign-in", async () => {
    const migratedEncrypted = encryptLoginName("legacy.user");
    const migratedLookup = hashLoginNameLookup("legacy.user");
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: "legacy-account-user",
      clientId: "client-legacy-1",
      loginName: "legacy.user",
      loginNameEncrypted: null,
      loginNameLookup: null,
      passwordHash: makePasswordHash("supersecure123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Legacy User",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: false,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: "legacy-account-user",
      clientId: "client-legacy-1",
      loginName: null,
      loginNameEncrypted: migratedEncrypted,
      loginNameLookup: migratedLookup,
      passwordHash: makePasswordHash("supersecure123"),
      sessionToken: "new-token",
      sessionExpiresAt: new Date("2026-02-10T11:00:00.000Z"),
      username: "Legacy User",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:30:00.000Z"),
      createdAt: new Date("2026-02-10T09:00:00.000Z"),
      updatedAt: new Date("2026-02-10T10:30:00.000Z"),
    });

    await signInAccount({
      loginName: "legacy.user",
      password: "supersecure123",
    });

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loginName: null,
          loginNameEncrypted: expect.any(String),
          loginNameLookup: expect.any(String),
        }),
      }),
    );
  });

  it("rejects own-account security update when current password is wrong", async () => {
    const encrypted = encryptLoginName("alice.login");
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: "alice.login",
      loginNameEncrypted: encrypted,
      passwordHash: makePasswordHash("correctpass123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    await expect(updateOwnAccount({
      clientId: "client-1",
      currentPassword: "wrongpass123",
      newPassword: "newsecure123",
    })).rejects.toThrow("Aktuelles Passwort ist falsch.");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects own-account security update when login-name is already used", async () => {
    const encrypted = encryptLoginName("alice.login");
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: "alice.login",
      loginNameEncrypted: encrypted,
      passwordHash: makePasswordHash("correctpass123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: "other-user" });

    await expect(updateOwnAccount({
      clientId: "client-1",
      currentPassword: "correctpass123",
      newLoginName: "alice.new",
    })).rejects.toThrow("Dieser Login-Name ist bereits vergeben");
  });

  it("updates own-account login-name only", async () => {
    const encryptedCurrent = encryptLoginName("alice.login");
    const encryptedNext = encryptLoginName("alice.new");
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: "alice.login",
      loginNameEncrypted: encryptedCurrent,
      passwordHash: makePasswordHash("correctpass123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: null,
      loginNameEncrypted: encryptedNext,
      sessionToken: "new-token",
      sessionExpiresAt: new Date("2026-02-10T11:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:30:00.000Z"),
    });

    const result = await updateOwnAccount({
      clientId: "client-1",
      currentPassword: "correctpass123",
      newLoginName: "alice.new",
    });

    expect(result.loginName).toBe("alice.new");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loginName: null,
          loginNameEncrypted: expect.any(String),
          loginNameLookup: expect.any(String),
        }),
      }),
    );
  });

  it("updates own-account password only", async () => {
    const encryptedCurrent = encryptLoginName("alice.login");
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: "alice.login",
      loginNameEncrypted: encryptedCurrent,
      passwordHash: makePasswordHash("correctpass123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: null,
      loginNameEncrypted: encryptedCurrent,
      sessionToken: "new-token",
      sessionExpiresAt: new Date("2026-02-10T11:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:30:00.000Z"),
    });

    const result = await updateOwnAccount({
      clientId: "client-1",
      currentPassword: "correctpass123",
      newPassword: "newsecure123",
    });

    expect(result.loginName).toBe("alice.login");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordHash: expect.any(String),
        }),
      }),
    );
  });

  it("updates own-account login-name and password together", async () => {
    const encryptedCurrent = encryptLoginName("alice.login");
    const encryptedNext = encryptLoginName("alice.next");
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: "alice.login",
      loginNameEncrypted: encryptedCurrent,
      passwordHash: makePasswordHash("correctpass123"),
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValueOnce({
      id: "account-user",
      clientId: "client-1",
      loginName: null,
      loginNameEncrypted: encryptedNext,
      sessionToken: "new-token",
      sessionExpiresAt: new Date("2026-02-10T11:00:00.000Z"),
      username: "Alice",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:30:00.000Z"),
    });

    const result = await updateOwnAccount({
      clientId: "client-1",
      currentPassword: "correctpass123",
      newLoginName: "alice.next",
      newPassword: "newsecure123",
    });

    expect(result.loginName).toBe("alice.next");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loginNameEncrypted: expect.any(String),
          loginNameLookup: expect.any(String),
          passwordHash: expect.any(String),
        }),
      }),
    );
  });

  it("rejects own-account security update for passwordless legacy users", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "legacy-user",
      clientId: "client-legacy",
      loginName: "legacy-client-legacy",
      loginNameEncrypted: null,
      passwordHash: null,
      sessionToken: "old-token",
      sessionExpiresAt: new Date("2026-02-10T10:00:00.000Z"),
      username: "Legacy User",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    await expect(updateOwnAccount({
      clientId: "client-legacy",
      currentPassword: "doesnotmatter123",
      newPassword: "newsecure123",
    })).rejects.toThrow("Für diesen Nutzer ist kein Konto-Passwort hinterlegt.");
  });

  it("returns the configured bot limits per rank", () => {
    expect(getBotLimitForRank("BRONZE")).toBe(1);
    expect(getBotLimitForRank("PLATIN")).toBe(2);
    expect(getBotLimitForRank("TITAN")).toBe(5);
  });

  it("creates a bot within the user quota and publishes bot.updated", async () => {
    prismaMock.bot.count.mockResolvedValueOnce(0);
    prismaMock.bot.create.mockResolvedValueOnce(baseBot());

    const result = await createBot({
      clientId: "client-1",
      displayName: "Peter Griffin",
      mentionHandle: "@Peter-Griffin",
      languagePreference: "en",
      instructions: "Sei Peter Griffin als lustiger Charakter.",
      catchphrases: ["hehehehe", "Lois!"],
    });

    expect(prismaMock.bot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerUserId: "user-id",
          displayName: "Peter Griffin",
          mentionHandle: "peter-griffin",
          languagePreference: "en",
          instructions: "Sei Peter Griffin als lustiger Charakter.",
          catchphrases: ["hehehehe", "Lois!"],
        }),
      }),
    );
    expect(result.mentionHandle).toBe("peter-griffin");
    expect(result.languagePreference).toBe("all");
    expect(publishMock).toHaveBeenCalledWith(
      "bot.updated",
      expect.objectContaining({
        clientId: "bot:bot-1",
        username: "Peter Griffin",
      }),
    );
  });

  it("rejects bot creation when the rank quota is exhausted", async () => {
    prismaMock.bot.count.mockResolvedValueOnce(1);

    await expect(createBot({
      clientId: "client-1",
      displayName: "Peter Griffin",
      mentionHandle: "peter-griffin",
      instructions: "Sei Peter Griffin.",
      catchphrases: [],
    })).rejects.toThrow("Dein Bot-Limit für diesen Rang ist erreicht.");
    expect(prismaMock.bot.create).not.toHaveBeenCalled();
  });

  it("returns managed bots with quota usage", async () => {
    prismaMock.bot.count.mockResolvedValueOnce(1);
    prismaMock.bot.findMany.mockResolvedValueOnce([baseBot()]);

    const result = await getManagedBots({ clientId: "client-1" });

    expect(result).toMatchObject({
      limit: 1,
      used: 1,
      remaining: 0,
    });
    expect(result.items[0]).toMatchObject({
      id: "bot-1",
      displayName: "Peter Griffin",
      mentionHandle: "peter-griffin",
      languagePreference: "all",
      catchphrases: ["hehehehe", "Lois!"],
    });
  });

  it("rejects bot updates for non-owners", async () => {
    prismaMock.bot.findUnique.mockResolvedValueOnce({
      ownerUserId: "other-user",
      deletedAt: null,
    });

    await expect(updateBot({
      botId: "bot-1",
      clientId: "client-1",
      displayName: "Peter Griffin",
      mentionHandle: "peter-griffin",
      instructions: "Bleib chaotisch.",
      catchphrases: [],
    })).rejects.toThrow("Du darfst diesen Bot nicht bearbeiten.");
    expect(prismaMock.bot.updateMany).not.toHaveBeenCalled();
  });

  it("soft-deletes owned bots and publishes bot.deleted", async () => {
    prismaMock.bot.findUnique.mockResolvedValueOnce({
      ownerUserId: "user-id",
      deletedAt: null,
    });
    prismaMock.bot.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(deleteBot({
      botId: "bot-1",
      clientId: "client-1",
    })).resolves.toEqual({ ok: true });

    expect(prismaMock.bot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bot-1" },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith("bot.deleted", {
      clientId: "bot:bot-1",
      botId: "bot-1",
    });
  });

  it("enables developer mode when unlock code is used as username", async () => {
    const previousUnlock = process.env.CHAT_DEV_UNLOCK_CODE;
    const previousSecret = process.env.CHAT_DEV_TOKEN_SECRET;
    process.env.CHAT_DEV_UNLOCK_CODE = "1234567890123456";
    process.env.CHAT_DEV_TOKEN_SECRET = "test-dev-secret";

    try {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.findFirst.mockResolvedValueOnce(null);
      prismaMock.user.upsert.mockResolvedValueOnce({
        id: "dev-user",
        clientId: "dev-client",
        username: "1234567890123456",
        profilePicture: "https://example.com/avatar.png",
        status: "",
        isOnline: true,
        lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
      });

      const result = await loginUser({
        username: "1234567890123456",
        clientId: "dev-client",
      });

      expect(result.devMode).toBe(true);
      expect(result.devAuthToken).toBeTruthy();
      expect(result.username).toBe("1234567890123456");
    } finally {
      process.env.CHAT_DEV_UNLOCK_CODE = previousUnlock;
      process.env.CHAT_DEV_TOKEN_SECRET = previousSecret;
    }
  });

  it("enables developer mode on restore when login-name matches unlock code without renaming user", async () => {
    const previousUnlock = process.env.CHAT_DEV_UNLOCK_CODE;
    const previousSecret = process.env.CHAT_DEV_TOKEN_SECRET;
    process.env.CHAT_DEV_UNLOCK_CODE = "1234567890123456";
    process.env.CHAT_DEV_TOKEN_SECRET = "test-dev-secret";

    try {
      const now = new Date("2026-02-10T10:00:00.000Z");
      const refreshed = new Date("2026-02-10T11:00:00.000Z");

      prismaMock.user.findFirst.mockResolvedValueOnce({
        id: "dev-user",
        clientId: "dev-client",
        loginName: "1234567890123456",
        passwordHash: "hash",
        sessionToken: "session-token",
        sessionExpiresAt: now,
        username: "Chosen Display Name",
        profilePicture: "https://example.com/avatar.png",
        status: "",
        isOnline: true,
        lastSeenAt: now,
      });
      prismaMock.user.update.mockResolvedValueOnce({
        id: "dev-user",
        clientId: "dev-client",
        loginName: "1234567890123456",
        passwordHash: "hash",
        sessionToken: "session-token",
        sessionExpiresAt: refreshed,
        username: "Chosen Display Name",
        profilePicture: "https://example.com/avatar.png",
        status: "",
        isOnline: true,
        lastSeenAt: refreshed,
      });

      const result = await restoreSession({
        clientId: "dev-client",
        sessionToken: "session-token",
      });

      expect(result.devMode).toBe(true);
      expect(result.devAuthToken).toBeTruthy();
      expect(result.username).toBe("Chosen Display Name");
    } finally {
      process.env.CHAT_DEV_UNLOCK_CODE = previousUnlock;
      process.env.CHAT_DEV_TOKEN_SECRET = previousSecret;
    }
  });

  it("returns empty chat background when unset", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const background = await getChatBackground();
    expect(background.url).toBeNull();
    expect(background.updatedBy).toBeNull();
  });

  it("updates global chat background", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "bg-row",
      clientId: "__chatppc_chat_background__",
      username: "__chatppc_chat_background__",
      profilePicture: "https://example.com/bg.png",
      status: "tester",
      isOnline: false,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    const result = await setChatBackground({
      clientId: "client-1",
      url: "https://example.com/bg.png",
    });

    expect(result.url).toBe("https://example.com/bg.png");
    expect(result.updatedBy).toBe("tester");
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          profilePicture: "https://example.com/bg.png",
          status: "tester",
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      "chat.background.updated",
      expect.objectContaining({
        url: "https://example.com/bg.png",
        updatedBy: "tester",
      }),
    );
  });

  it("returns disabled app kill state when no kill row exists", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const killState = await getAppKillState();

    expect(killState).toEqual({
      enabled: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("updates app kill state and publishes realtime event", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
      ppcMemberScoreRaw: 0,
      ppcMemberLastActiveAt: null,
    });
    prismaMock.user.upsert.mockResolvedValueOnce({
      id: "kill-row",
      clientId: "__chatppc_app_kill__",
      username: "__chatppc_app_kill__",
      profilePicture: "__enabled__",
      status: "tester",
      isOnline: false,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    const state = await setAppKillState({
      clientId: "client-1",
      enabled: true,
    });

    expect(state.enabled).toBe(true);
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          profilePicture: "__enabled__",
          status: "tester",
          isOnline: false,
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      "app.kill.updated",
      expect.objectContaining({
        enabled: true,
        updatedBy: "tester",
      }),
    );
  });

  it("creates poll with up to 15 options and settings", async () => {
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        type: MessageType.VOTING_POLL,
        content: "Which topic next?",
        optionOne: "Math",
        optionTwo: "Physics",
        pollMultiSelect: true,
        pollAllowVoteChange: true,
        pollOptions: [
          { id: "o1", label: "Math", sortOrder: 0, votes: [] },
          { id: "o2", label: "Physics", sortOrder: 1, votes: [] },
          { id: "o3", label: "Chemistry", sortOrder: 2, votes: [] },
        ],
      }),
    );

    const created = await createMessage({
      clientId: "client-1",
      type: "votingPoll",
      message: "Which topic next?",
      pollOptions: ["Math", "Physics", "Chemistry"],
      pollMultiSelect: true,
      pollAllowVoteChange: true,
    });

    expect(created.poll?.options.length).toBe(3);
    expect(created.poll?.settings.multiSelect).toBe(true);
    expect(created.poll?.settings.allowVoteChange).toBe(true);
  });

  it("forces vote-change support even if payload disables it", async () => {
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        type: MessageType.VOTING_POLL,
        content: "Choose one",
        pollMultiSelect: false,
        pollAllowVoteChange: false,
        pollOptions: [
          { id: "o1", label: "A", sortOrder: 0, votes: [] },
          { id: "o2", label: "B", sortOrder: 1, votes: [] },
        ],
      }),
    );

    const created = await createMessage({
      clientId: "client-1",
      type: "votingPoll",
      message: "Choose one",
      pollOptions: ["A", "B"],
      pollAllowVoteChange: false,
    });

    expect(created.poll?.settings.allowVoteChange).toBe(true);
    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pollAllowVoteChange: true,
        }),
      }),
    );
  });

  it("threads newly created polls to a referenced message", async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(
      baseMessage({
        id: "parent-1",
        type: MessageType.MESSAGE,
        content: "Original thread start",
        authorName: "alice",
      }),
    );
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "poll-reply-1",
        type: MessageType.VOTING_POLL,
        content: "Was sollen wir machen?",
        questionMessageId: "parent-1",
        questionMessage: baseMessage({
          id: "parent-1",
          type: MessageType.MESSAGE,
          content: "Original thread start",
          authorName: "alice",
        }),
        pollMultiSelect: false,
        pollAllowVoteChange: true,
        pollOptions: [
          { id: "o1", label: "Option A", sortOrder: 0, votes: [] },
          { id: "o2", label: "Option B", sortOrder: 1, votes: [] },
        ],
      }),
    );

    const created = await createMessage({
      clientId: "client-1",
      type: "votingPoll",
      message: "Was sollen wir machen?",
      pollOptions: ["Option A", "Option B"],
      questionId: "parent-1",
    });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          questionMessageId: "parent-1",
        }),
      }),
    );
    expect(created.questionId).toBe("parent-1");
    expect(created.oldusername).toBe("alice");
    expect(created.oldmessage).toBe("Original thread start");
  });

  it('posts "new_name ist dem Chat beigetreten" system message on rename', async () => {
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "newname",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "sys-rename",
        content: "newname ist dem Chat beigetreten",
        authorName: "System",
      }),
    );

    await renameUser({ clientId: "client-1", newUsername: "newname" });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "newname ist dem Chat beigetreten",
          authorName: "System",
          authorId: "user-id",
        }),
      }),
    );
    expect(prismaMock.userBehaviorEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "USERNAME_CHANGED",
          userId: "user-id",
        }),
      }),
    );
  });

  it("queues @chatgpt mention without blocking response", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-user", content: "@chatgpt explain gravity" }),
    );

    try {
      const result = await Promise.race([
        createMessage({
          clientId: "client-1",
          type: "message",
          message: "@chatgpt explain gravity",
        }).then(() => "resolved"),
        new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 80)),
      ]);

      expect(result).toBe("resolved");
      expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-user",
            username: "tester",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("queues @grok mention without blocking response", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-user", content: "@grok explain gravity" }),
    );

    try {
      const result = await Promise.race([
        createMessage({
          clientId: "client-1",
          type: "message",
          message: "@grok explain gravity",
        }).then(() => "resolved"),
        new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 80)),
      ]);

      expect(result).toBe("resolved");
      expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-user",
            username: "tester",
            message: "@grok explain gravity",
          }),
        }),
      );
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("queues one AI job per provider when both @chatgpt and @grok are mentioned", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-user", content: "@chatgpt vs @grok explain gravity" }),
    );

    try {
      const result = await Promise.race([
        createMessage({
          clientId: "client-1",
          type: "message",
          message: "@chatgpt vs @grok explain gravity",
        }).then(() => "resolved"),
        new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 80)),
      ]);

      expect(result).toBe("resolved");
      expect(prismaMock.aiJob.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.aiJob.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-user",
            targetKey: "provider:chatgpt",
            provider: "chatgpt",
            message: "@chatgpt vs @grok explain gravity",
          }),
        }),
      );
      expect(prismaMock.aiJob.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-user",
            targetKey: "provider:grok",
            provider: "grok",
            message: "@chatgpt vs @grok explain gravity",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("enqueues message tagging job for new user posts", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-tag-1", content: "hello world" }),
    );

    try {
      await createMessage({
        clientId: "client-1",
        type: "message",
        message: "hello world",
      });

      expect(prismaMock.messageTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-tag-1",
            username: "tester",
            message: "hello world",
            status: "PENDING",
          }),
        }),
      );
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("processes tagging jobs and publishes message.updated", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-1",
        sourceMessageId: "msg-tag-1",
        username: "tester",
        message: "hello world",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    prismaMock.message.findUnique.mockResolvedValue(
      baseMessage({
        id: "msg-tag-1",
        content: "hello world",
        taggingStatus: "COMPLETED",
        taggingPayload: {
          provider: "grok",
          model: "grok-4-1-fast-non-reasoning",
          language: "en",
          generatedAt: "2026-02-10T10:00:00.000Z",
          messageTags: [{ tag: "casual", score: 0.9 }],
          categories: {
            themes: [{ tag: "chat", score: 0.8 }],
            humor: [],
            art: [],
            tone: [{ tag: "neutral", score: 0.7 }],
            topics: [{ tag: "greeting", score: 0.8 }],
          },
          images: [],
        },
      }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [{ tag: "casual", score: 0.9 }],
        categories: {
          themes: [{ tag: "chat", score: 0.8 }],
          humor: [],
          art: [],
          tone: [{ tag: "neutral", score: 0.7 }],
          topics: [{ tag: "greeting", score: 0.8 }],
        },
        images: [],
      }),
      output: [],
    });

    try {
      const result = await processTaggingQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(prismaMock.messageTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "tag-job-1" },
          data: expect.objectContaining({
            status: "COMPLETED",
          }),
        }),
      );
      expect(publishMock).toHaveBeenCalledWith("message.updated", expect.objectContaining({ id: "msg-tag-1" }));
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("includes input_image and stores per-image tags for tagging jobs", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-img-1",
        sourceMessageId: "msg-tag-img-1",
        username: "tester",
        message: "tag this image",
        imageUrls: ["https://example.com/picture.png"],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [{ tag: "visual", score: 0.9 }],
        categories: {
          themes: [{ tag: "photo", score: 0.8 }],
          humor: [],
          art: [{ tag: "portrait", score: 0.7 }],
          tone: [{ tag: "neutral", score: 0.6 }],
          topics: [{ tag: "person", score: 0.8 }],
        },
        images: [
          {
            imageUrl: "https://example.com/picture.png",
            tags: [{ tag: "face", score: 0.95 }],
            categories: {
              themes: [{ tag: "portrait", score: 0.8 }],
              humor: [],
              art: [{ tag: "photo", score: 0.75 }],
              tone: [{ tag: "clean", score: 0.6 }],
              objects: [{ tag: "face", score: 0.95 }],
            },
          },
        ],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });

      const request = openAiCreateMock.mock.calls[0]?.[0] as
        | { input?: Array<{ content?: Array<{ type?: string; image_url?: string }> }> }
        | undefined;
      expect(request?.input?.[0]?.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "input_image",
            image_url: "https://example.com/picture.png",
          }),
        ]),
      );

      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      expect(completedUpdateCall?.[0]?.data?.taggingPayload).toEqual(
        expect.objectContaining({
          images: expect.arrayContaining([
            expect.objectContaining({
              imageUrl: "https://example.com/picture.png",
            }),
          ]),
        }),
      );
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("converts gif inputs to three png frames for tagging", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    const gifDataUrl = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-gif-1",
        sourceMessageId: "msg-tag-gif-1",
        username: "tester",
        message: "tag this gif",
        imageUrls: [gifDataUrl],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [{ tag: "animated", score: 0.9 }],
        categories: {
          themes: [{ tag: "loop", score: 0.8 }],
          humor: [],
          art: [{ tag: "minimal", score: 0.7 }],
          tone: [{ tag: "neutral", score: 0.6 }],
          topics: [{ tag: "gif", score: 0.9 }],
        },
        images: [
          {
            imageUrl: gifDataUrl,
            tags: [{ tag: "pixel", score: 0.8 }],
            categories: {
              themes: [{ tag: "animation", score: 0.7 }],
              humor: [],
              art: [{ tag: "retro", score: 0.75 }],
              tone: [{ tag: "simple", score: 0.6 }],
              objects: [{ tag: "pixel", score: 0.8 }],
            },
          },
        ],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });

      const request = openAiCreateMock.mock.calls[0]?.[0] as
        | { input?: Array<{ content?: Array<{ type?: string; image_url?: string }> }> }
        | undefined;
      const imageInputs = (request?.input?.[0]?.content ?? []).filter((entry) => entry.type === "input_image");
      expect(imageInputs).toHaveLength(3);
      expect(imageInputs.every((entry) => entry.image_url?.startsWith("data:image/png;base64,"))).toBe(true);

      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      expect(completedUpdateCall?.[0]?.data?.taggingPayload).toEqual(
        expect.objectContaining({
          images: expect.arrayContaining([
            expect.objectContaining({
              imageUrl: gifDataUrl,
            }),
          ]),
        }),
      );
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("derives precise structured message categories from messageTags", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-1",
        sourceMessageId: "msg-tag-cats-1",
        username: "tester",
        message: "categorize me",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [
          { tag: "survey", score: 0.9 },
          { tag: "sarcasm", score: 0.88 },
          { tag: "illustration", score: 0.85 },
          { tag: "german", score: 0.81 },
          { tag: "schweine", score: 0.8 },
        ],
        categories: {
          themes: [],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        categories?: Record<string, Array<{ tag: string; score: number }>>;
      } | undefined;
      expect(payload?.categories?.themes?.some((entry) => entry.tag === "theme:poll")).toBe(true);
      expect(payload?.categories?.humor?.some((entry) => entry.tag === "humor:sarcasm")).toBe(true);
      expect(payload?.categories?.art?.some((entry) => entry.tag === "art:illustration")).toBe(true);
      expect(payload?.categories?.tone?.some((entry) => entry.tag === "language:german")).toBe(true);
      expect(payload?.categories?.tone?.some((entry) => entry.tag.startsWith("complexity:"))).toBe(true);
      expect(payload?.categories?.topics?.some((entry) => entry.tag === "topic:animals")).toBe(true);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("allows empty non-tone message categories when no reliable evidence exists", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-empty-1",
        sourceMessageId: "msg-tag-cats-empty-1",
        username: "tester",
        message: "Nur ein kurzer Text ohne viele Signale",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [],
        categories: {
          themes: [],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        categories?: Record<string, Array<{ tag: string; score: number }>>;
      } | undefined;
      expect(payload?.categories?.themes || []).toEqual([]);
      expect(payload?.categories?.humor || []).toEqual([]);
      expect(payload?.categories?.art || []).toEqual([]);
      expect(payload?.categories?.topics || []).toEqual([]);
      expect(payload?.categories?.tone?.some((entry) => entry.tag === "language:german")).toBe(true);
      expect(payload?.categories?.tone?.some((entry) => entry.tag.startsWith("complexity:"))).toBe(true);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("assigns synthesized message tags to at most one category", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-exclusive-1",
        sourceMessageId: "msg-tag-cats-exclusive-1",
        username: "tester",
        message: "exclusive categories",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [
          { tag: "poll", score: 0.95 },
          { tag: "sarcasm", score: 0.9 },
          { tag: "illustration", score: 0.85 },
          { tag: "pigs", score: 0.8 },
        ],
        categories: {
          themes: [],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        categories?: Record<string, Array<{ tag: string; score: number }>>;
      } | undefined;
      const categories = payload?.categories;
      const allCategoryTags = [
        ...(categories?.themes || []),
        ...(categories?.humor || []),
        ...(categories?.art || []),
        ...(categories?.tone || []),
        ...(categories?.topics || []),
      ].map((entry) => entry.tag);

      expect(new Set(allCategoryTags).size).toBe(allCategoryTags.length);
      expect(categories?.themes.some((entry) => entry.tag === "theme:poll")).toBe(true);
      expect(categories?.humor.some((entry) => entry.tag === "humor:sarcasm")).toBe(true);
      expect(categories?.art.some((entry) => entry.tag === "art:illustration")).toBe(true);
      expect(categories?.topics.some((entry) => entry.tag === "topic:animals")).toBe(true);
      expect(categories?.topics.some((entry) => entry.tag === "theme:poll")).toBe(false);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("fills empty image categories and objects from image tags", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-img-1",
        sourceMessageId: "msg-tag-cats-img-1",
        username: "tester",
        message: "categorize image",
        imageUrls: ["https://example.com/scene.png"],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [{ tag: "visual", score: 0.8 }],
        categories: {
          themes: [],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [
          {
            imageUrl: "https://example.com/scene.png",
            tags: [
              { tag: "person", score: 0.95 },
              { tag: "meme", score: 0.8 },
              { tag: "cinematic", score: 0.84 },
              { tag: "dark", score: 0.71 },
            ],
            categories: {
              themes: [],
              humor: [],
              art: [],
              tone: [],
              objects: [],
            },
          },
        ],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        images?: Array<{ categories?: Record<string, Array<{ tag: string; score: number }>> }>;
      } | undefined;
      const imageCategories = payload?.images?.[0]?.categories;
      expect(imageCategories?.objects?.length || 0).toBeGreaterThan(0);
      expect(imageCategories?.art?.length || 0).toBeGreaterThan(0);
      expect(imageCategories?.tone?.length || 0).toBeGreaterThan(0);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("fills all image categories including objects when image tags are empty", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-img-empty-1",
        sourceMessageId: "msg-tag-cats-img-empty-1",
        username: "tester",
        message: "Image mit wenig Infos",
        imageUrls: ["https://example.com/empty-scene.png"],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [],
        categories: {
          themes: [],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [
          {
            imageUrl: "https://example.com/empty-scene.png",
            tags: [],
            categories: {
              themes: [],
              humor: [],
              art: [],
              tone: [],
              objects: [],
            },
          },
        ],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        images?: Array<{ categories?: Record<string, Array<{ tag: string; score: number }>> }>;
      } | undefined;
      const imageCategories = payload?.images?.[0]?.categories;
      expect(imageCategories?.themes?.length || 0).toBeGreaterThan(0);
      expect(imageCategories?.humor?.length || 0).toBeGreaterThan(0);
      expect(imageCategories?.art?.length || 0).toBeGreaterThan(0);
      expect(imageCategories?.tone?.length || 0).toBeGreaterThan(0);
      expect(imageCategories?.objects?.length || 0).toBeGreaterThan(0);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("assigns image tags only once across image categories", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-img-exclusive-1",
        sourceMessageId: "msg-tag-cats-img-exclusive-1",
        username: "tester",
        message: "image exclusive categories",
        imageUrls: ["https://example.com/scene.png"],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [{ tag: "visual", score: 0.8 }],
        categories: {
          themes: [],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [
          {
            imageUrl: "https://example.com/scene.png",
            tags: [
              { tag: "meme cinematic", score: 0.95 },
              { tag: "person", score: 0.92 },
              { tag: "dark", score: 0.86 },
            ],
            categories: {
              themes: [],
              humor: [],
              art: [],
              tone: [],
              objects: [],
            },
          },
        ],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        images?: Array<{ categories?: Record<string, Array<{ tag: string; score: number }>> }>;
      } | undefined;
      const categories = payload?.images?.[0]?.categories;
      const allImageCategoryTags = [
        ...(categories?.themes || []),
        ...(categories?.humor || []),
        ...(categories?.art || []),
        ...(categories?.tone || []),
        ...(categories?.objects || []),
      ].map((entry) => entry.tag);

      expect(new Set(allImageCategoryTags).size).toBe(allImageCategoryTags.length);
      expect(categories?.themes.some((entry) => entry.tag === "meme cinematic")).toBe(true);
      expect(categories?.art.some((entry) => entry.tag === "meme cinematic")).toBe(false);
      expect(categories?.objects.some((entry) => entry.tag === "person")).toBe(true);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("keeps model-provided categories and only fills missing ones", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-model-1",
        sourceMessageId: "msg-tag-cats-model-1",
        username: "tester",
        message: "preserve model categories",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [
          { tag: "school", score: 0.9 },
          { tag: "sarcasm", score: 0.88 },
        ],
        categories: {
          themes: [{ tag: "theme:poll", score: 0.93 }],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        categories?: Record<string, Array<{ tag: string; score: number }>>;
      } | undefined;
      expect(payload?.categories?.themes?.[0]?.tag).toBe("theme:poll");
      expect(payload?.categories?.humor?.some((entry) => entry.tag === "humor:sarcasm")).toBe(true);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("handles umlauts while mapping to broad topics", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-cats-umlaut-1",
        sourceMessageId: "msg-tag-cats-umlaut-1",
        username: "tester",
        message: "umlaut tags",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [
          { tag: "Frühstück ÄÖÜß", score: 0.9 },
          { tag: "schweine", score: 0.8 },
        ],
        categories: {
          themes: [],
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [],
      }),
      output: [],
    });

    try {
      const result = await processTaggingQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        categories?: Record<string, Array<{ tag: string; score: number }>>;
      } | undefined;
      const topicTags = payload?.categories?.topics?.map((entry) => entry.tag) || [];
      expect(topicTags).toContain("topic:food");
      expect(topicTags).toContain("topic:animals");
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("filters meta noise, applies confidence floors, and caps messageTags at 16", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-quality-1",
        sourceMessageId: "msg-tag-quality-1",
        username: "tester",
        message: "Bitte mach eine Umfrage über Schweine auf Deutsch",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: JSON.stringify({
        messageTags: [
          { tag: "request", score: 0.95 },
          { tag: "create", score: 0.95 },
          { tag: "command", score: 0.95 },
          { tag: "no image", score: 0.95 },
          { tag: "username", score: 0.95 },
          { tag: "funny", score: 0.95 },
          { tag: "neutral", score: 0.95 },
          { tag: "poll", score: 0.92 },
          { tag: "sarcasm", score: 0.9 },
          { tag: "illustration", score: 0.88 },
          { tag: "deutsch", score: 0.87 },
          { tag: "schweine", score: 0.86 },
          { tag: "technology", score: 0.85 },
          { tag: "school", score: 0.84 },
          { tag: "entertainment", score: 0.83 },
          { tag: "relationships", score: 0.82 },
          { tag: "food", score: 0.81 },
          { tag: "animals", score: 0.8 },
          { tag: "travel", score: 0.79 },
          { tag: "gaming", score: 0.78 },
        ],
        categories: {
          themes: [{ tag: "theme:request", score: 0.4 }],
          humor: [{ tag: "humor:sarcasm", score: 0.4 }],
          art: [],
          tone: [],
          topics: [{ tag: "topic:food", score: 0.4 }],
        },
        images: [],
      }),
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      const completedUpdateCall = prismaMock.message.updateMany.mock.calls.find(
        (call) => call[0]?.data?.taggingStatus === "COMPLETED",
      );
      const payload = completedUpdateCall?.[0]?.data?.taggingPayload as {
        messageTags?: Array<{ tag: string; score: number }>;
        categories?: Record<string, Array<{ tag: string; score: number }>>;
      } | undefined;
      const messageTags = payload?.messageTags?.map((entry) => entry.tag) || [];
      expect(messageTags.length).toBeLessThanOrEqual(16);
      expect(messageTags).not.toContain("request");
      expect(messageTags).not.toContain("create");
      expect(messageTags).not.toContain("command");
      expect(messageTags).not.toContain("no image");
      expect(messageTags).not.toContain("username");
      expect(messageTags).not.toContain("funny");
      expect(messageTags).not.toContain("neutral");
      expect((payload?.categories?.themes || []).every((entry) => entry.score >= 0.55)).toBe(true);
      expect((payload?.categories?.humor || []).every((entry) => entry.score >= 0.55)).toBe(true);
      expect((payload?.categories?.topics || []).every((entry) => entry.score >= 0.55)).toBe(true);
      expect(payload?.categories?.tone?.some((entry) => entry.tag === "language:german")).toBe(true);
      expect(payload?.categories?.tone?.some((entry) => entry.tag.startsWith("complexity:"))).toBe(true);
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("marks tagging job as failed when invalid JSON is returned on last attempt", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "tag-job-fail-1",
        sourceMessageId: "msg-tag-fail-1",
        username: "tester",
        message: "bad json please",
        imageUrls: [],
        attempts: 4,
      },
    ]);
    prismaMock.messageTagJob.count.mockResolvedValueOnce(0);
    openAiCreateMock.mockResolvedValueOnce({
      output_text: "{invalid-json}",
      output: [],
    });

    try {
      await processTaggingQueue({ maxJobs: 1 });
      expect(prismaMock.messageTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "tag-job-fail-1" },
          data: expect.objectContaining({
            status: "FAILED",
          }),
        }),
      );
      expect(prismaMock.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg-tag-fail-1" },
          data: expect.objectContaining({
            taggingStatus: "FAILED",
          }),
        }),
      );
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("emits busy notice when pending AI queue is full", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.aiJob.count.mockResolvedValueOnce(40);
    prismaMock.message.create
      .mockResolvedValueOnce(baseMessage({ id: "msg-user", content: "@chatgpt explain gravity" }))
      .mockResolvedValueOnce(baseMessage({ id: "msg-busy", content: "busy", authorName: "ChatGPT" }));

    try {
      await createMessage({
        clientId: "client-1",
        type: "message",
        message: "@chatgpt explain gravity",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
      expect(prismaMock.message.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.message.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "ChatGPT",
            content: expect.stringContaining("Zu viele @chatgpt"),
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("processes queued AI jobs via DB worker", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt explain gravity",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-ai", content: "AI answer", authorName: "ChatGPT" }),
    );
    openAiCreateMock.mockResolvedValueOnce({ output_text: "AI answer", output: [] });

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).toHaveBeenCalledTimes(1);
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "ChatGPT",
            questionMessageId: "msg-user",
          }),
        }),
      );
      expect(prismaMock.aiJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-1" },
          data: expect.objectContaining({
            status: "COMPLETED",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("enqueues tagging jobs for AI-generated responses", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-ai-no-tagging-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt explain gravity",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-ai-generated", content: "AI answer", authorName: "ChatGPT" }),
    );
    openAiCreateMock.mockResolvedValueOnce({ output_text: "AI answer", output: [] });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.messageTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-ai-generated",
            username: "ChatGPT",
            message: "AI answer",
            status: "PENDING",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("processes queued @grok jobs via DB worker", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok explain gravity",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok", content: "Grok answer", authorName: "Grok" }),
    );
    openAiCreateMock.mockResolvedValueOnce({ output_text: "Grok answer", output: [] });

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).toHaveBeenCalledTimes(1);
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
          }),
        }),
      );
    } finally {
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("strips leading AI mentions from Grok output", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-strip-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok explain gravity",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-strip", content: "cleaned", authorName: "Grok" }),
    );
    openAiCreateMock.mockResolvedValueOnce({ output_text: "@grok @chatgpt cleaned", output: [] });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            content: "cleaned",
          }),
        }),
      );
    } finally {
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("creates native poll message from Grok POLL_JSON output", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-poll-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok erstelle eine umfrage",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "msg-grok-poll",
        type: MessageType.VOTING_POLL,
        content: "Welche Farbe?",
        authorName: "Grok",
        pollMultiSelect: true,
        pollAllowVoteChange: true,
        pollOptions: [
          { id: "o1", label: "Rot", sortOrder: 0, votes: [] },
          { id: "o2", label: "Blau", sortOrder: 1, votes: [] },
        ],
      }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: '<POLL_JSON>{"question":"Welche Farbe?","options":["Rot","Blau"],"multiSelect":true}</POLL_JSON>',
      output: [],
    });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: MessageType.VOTING_POLL,
            content: "Welche Farbe?",
            pollMultiSelect: true,
            authorName: "Grok",
          }),
        }),
      );
    } finally {
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("creates native poll message from ChatGPT POLL_JSON output", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-chatgpt-poll-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt create a poll",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "msg-chatgpt-poll",
        type: MessageType.VOTING_POLL,
        content: "Best day?",
        authorName: "ChatGPT",
        pollMultiSelect: false,
        pollAllowVoteChange: true,
        pollOptions: [
          { id: "o1", label: "Mon", sortOrder: 0, votes: [] },
          { id: "o2", label: "Fri", sortOrder: 1, votes: [] },
        ],
      }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: '<POLL_JSON>{"question":"Best day?","options":["Mon","Fri"],"multiSelect":false}</POLL_JSON>',
      output: [],
    });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: MessageType.VOTING_POLL,
            content: "Best day?",
            pollMultiSelect: false,
            authorName: "ChatGPT",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("threads AI-created polls to the root message when mention is inside a reply", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-chatgpt-poll-thread-1",
        sourceMessageId: "msg-reply",
        username: "tester",
        message: "@chatgpt create a poll",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.message.findUnique
      .mockResolvedValueOnce({ id: "msg-reply", questionMessageId: "msg-root" })
      .mockResolvedValueOnce({ id: "msg-root", questionMessageId: null });
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "msg-chatgpt-poll-threaded",
        type: MessageType.VOTING_POLL,
        content: "Root poll question?",
        authorName: "ChatGPT",
        questionMessageId: "msg-root",
        pollMultiSelect: false,
        pollAllowVoteChange: true,
        pollOptions: [
          { id: "o1", label: "Yes", sortOrder: 0, votes: [] },
          { id: "o2", label: "No", sortOrder: 1, votes: [] },
        ],
      }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: '<POLL_JSON>{"question":"Root poll question?","options":["Yes","No"],"multiSelect":false}</POLL_JSON>',
      output: [],
    });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: MessageType.VOTING_POLL,
            questionMessageId: "msg-root",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("enqueues tagging for AI-generated poll messages", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-chatgpt-poll-tagging-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt create a poll",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "msg-chatgpt-poll-tagging",
        type: MessageType.VOTING_POLL,
        content: "Best day?",
        authorName: "ChatGPT",
        pollMultiSelect: false,
        pollAllowVoteChange: true,
        pollOptions: [
          { id: "o1", label: "Mon", sortOrder: 0, votes: [] },
          { id: "o2", label: "Fri", sortOrder: 1, votes: [] },
        ],
      }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: '<POLL_JSON>{"question":"Best day?","options":["Mon","Fri"],"multiSelect":false}</POLL_JSON>',
      output: [],
    });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.messageTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-chatgpt-poll-tagging",
            username: "ChatGPT",
            message: expect.stringContaining("Best day?"),
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("falls back to normal text response when POLL_JSON output is invalid", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-chatgpt-poll-invalid-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt create a poll",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-chatgpt-fallback", content: "fallback", authorName: "ChatGPT" }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: "<POLL_JSON>{broken-json}</POLL_JSON>",
      output: [],
    });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: MessageType.MESSAGE,
            authorName: "ChatGPT",
            content: "Ich wurde erwähnt, konnte aber keine Antwort erzeugen. Bitte versuche es noch einmal.",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("creates native poll message from ChatGPT numbered survey text fallback", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-chatgpt-poll-fallback-text-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt create a poll",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "msg-chatgpt-poll-fallback-text",
        type: MessageType.VOTING_POLL,
        content: "Papa Kellerbar – was ist Phase?",
        authorName: "ChatGPT",
        pollMultiSelect: false,
        pollAllowVoteChange: true,
        pollOptions: [
          { id: "o1", label: "Familie geht vor. Kellerbar kann warten.", sortOrder: 0, votes: [] },
          { id: "o2", label: "Erst kurz in die Kellerbar, dann maybe Familie.", sortOrder: 1, votes: [] },
        ],
      }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: `
Alles klar, wir machen das sauber.

**Umfrage: Papa Kellerbar – was ist Phase?**

1. Familie geht vor. Kellerbar kann warten.
2. Erst kurz in die Kellerbar, dann maybe Familie.
`,
      output: [],
    });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: MessageType.VOTING_POLL,
            content: "Papa Kellerbar – was ist Phase?",
            authorName: "ChatGPT",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("processes one queued job for both mentioned providers", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-both-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt and @grok explain gravity",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create
      .mockResolvedValueOnce(baseMessage({ id: "msg-chatgpt", content: "ChatGPT answer", authorName: "ChatGPT" }))
      .mockResolvedValueOnce(baseMessage({ id: "msg-grok", content: "Grok answer", authorName: "Grok" }));
    openAiCreateMock
      .mockResolvedValueOnce({ output_text: "ChatGPT answer", output: [] })
      .mockResolvedValueOnce({ output_text: "Grok answer", output: [] });

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).toHaveBeenCalledTimes(2);
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "ChatGPT",
            questionMessageId: "msg-user",
          }),
        }),
      );
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("answers with disabled notice for @grok image-edit prompts", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-image-disabled-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok modify this image",
        imageUrls: ["https://example.com/input.png"],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-image-disabled", content: "disabled", authorName: "Grok" }),
    );

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).not.toHaveBeenCalled();
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "Bildgenerierung und Bildbearbeitung sind für @grok deaktiviert. Nutze dafür bitte @chatgpt.",
          }),
        }),
      );
    } finally {
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("allows @grok image analysis prompts with image input", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-image-analysis-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok beschreibe dieses bild",
        imageUrls: ["https://example.com/input.png"],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-image-analysis", content: "analysis", authorName: "Grok" }),
    );
    openAiCreateMock.mockResolvedValueOnce({
      output_text: "Das Bild zeigt eine Person vor einer Wand.",
      output: [],
    });

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).toHaveBeenCalledTimes(1);
      const request = openAiCreateMock.mock.calls.at(0)?.[0] as
        | { input?: Array<{ content?: Array<{ type?: string; image_url?: string }> }> }
        | undefined;
      expect(request?.input?.[0]?.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "input_image",
            image_url: "https://example.com/input.png",
          }),
        ]),
      );
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "Das Bild zeigt eine Person vor einer Wand.",
          }),
        }),
      );
    } finally {
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("returns only a gif link for @grok matching gif requests", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-gif-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok please find a matching gif for monday mood",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-gif", content: "gif", authorName: "Grok" }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                itemurl: "https://tenor.com/view/monday-mood-cat-12345",
                media_formats: {
                  gif: {
                    url: "https://media.tenor.com/Rxjea6sMa1oAAAAC/monday-mood-cat.gif",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "content-type": "image/gif" } }),
      );

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).not.toHaveBeenCalled();

      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "![monday-mood-cat.gif](https://media.tenor.com/Rxjea6sMa1oAAAAC/monday-mood-cat.gif)",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("returns fallback text when no embeddable gif url can be validated", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-gif-page-url-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok please find a matching gif for monday mood",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-gif-page-url", content: "gif", authorName: "Grok" }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                itemurl: "https://tenor.com/view/monday-cat-12345",
                media_formats: {
                  gif: {
                    url: "https://media.tenor.com/invalid-id/monday-cat.gif",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 404, headers: { "content-type": "image/gif" } }),
      );

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).not.toHaveBeenCalled();
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "Ich konnte gerade kein passendes GIF finden. Versuch es mit einem konkreteren Suchbegriff.",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("rejects fake .gif urls when signature is not GIF", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-gif-format-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok please find a matching gif for monday mood",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-gif-format", content: "gif", authorName: "Grok" }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                itemurl: "https://tenor.com/view/monday-mood-cat-12345",
                media_formats: {
                  gif: {
                    url: "https://media.tenor.com/Rxjea6sMa1oAAAAC/monday-mood-cat.gif",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "content-type": "text/plain" } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "text/plain" } }),
      );

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).not.toHaveBeenCalled();
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "Ich konnte gerade kein passendes GIF finden. Versuch es mit einem konkreteren Suchbegriff.",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("detects german 'suche ... gif raus' intent and prefers funny query terms", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-gif-german-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok suche mir ein lustiges gif raus von 3000€ Baden Baden Urlaub",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-gif-german", content: "gif", authorName: "Grok" }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                itemurl: "https://tenor.com/view/funny-vacation-meme-12345",
                content_description: "Funny vacation reaction",
                media_formats: {
                  gif: {
                    url: "https://media.tenor.com/funny-vacation-abc123AAAAC/funny-vacation.gif",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "content-type": "image/gif" } }),
      );

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).not.toHaveBeenCalled();

      const searchUrl = new URL(String(fetchMock.mock.calls[0]?.[0] || ""));
      expect(searchUrl.hostname).toBe("g.tenor.com");
      expect(searchUrl.pathname).toBe("/v1/search");
      const searchQuery = searchUrl.searchParams.get("q") || "";
      expect(searchQuery).toContain("funny");

      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "![funny-vacation.gif](https://media.tenor.com/funny-vacation-abc123AAAAC/funny-vacation.gif)",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("treats direct ask phrasing ('a gif') as strict gif lookup intent", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-gif-direct-ask-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok a gif for monday mood please",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-gif-direct-ask", content: "gif", authorName: "Grok" }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                itemurl: "https://tenor.com/view/monday-mood-cat-12345",
                media_formats: {
                  gif: {
                    url: "https://media.tenor.com/Rxjea6sMa1oAAAAC/monday-mood-cat.gif",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "content-type": "image/gif" } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x47, 0x49, 0x46, 0x38]), { status: 200, headers: { "content-type": "image/gif" } }),
      );

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).not.toHaveBeenCalled();
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "![monday-mood-cat.gif](https://media.tenor.com/Rxjea6sMa1oAAAAC/monday-mood-cat.gif)",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("forces strict gif lookup even without explicit action verb", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGrokKey = process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-grok-gif-plain-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@grok gif monday mood",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-grok-gif-plain", content: "gif", authorName: "Grok" }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                itemurl: "https://tenor.com/view/monday-mood-cat-12345",
                media_formats: {
                  gif: {
                    url: "https://media.tenor.com/Rxjea6sMa1oAAAAC/monday-mood-cat.gif",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "content-type": "image/gif" } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x47, 0x49, 0x46, 0x38]), { status: 200, headers: { "content-type": "image/gif" } }),
      );

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(1);
      expect(result.lockSkipped).toBe(false);
      expect(openAiCreateMock).not.toHaveBeenCalled();
      expect(prismaMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorName: "Grok",
            questionMessageId: "msg-user",
            content: "![monday-mood-cat.gif](https://media.tenor.com/Rxjea6sMa1oAAAAC/monday-mood-cat.gif)",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
      if (previousOpenAiKey) process.env.OPENAI_API_KEY = previousOpenAiKey;
      else delete process.env.OPENAI_API_KEY;
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("returns without processing when no AI jobs are pending", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([]);
    prismaMock.aiJob.updateMany.mockResolvedValueOnce({ count: 0 });

    try {
      const result = await processAiQueue({ maxJobs: 1 });
      expect(result.processed).toBe(0);
      expect(result.lockSkipped).toBe(false);
      expect(prismaMock.$queryRawUnsafe).toHaveBeenCalled();
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("does not enqueue AI jobs when @chatgpt is not mentioned", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.message.create.mockResolvedValueOnce(baseMessage({ id: "msg-user", content: "hello class" }));

    try {
      await createMessage({
        clientId: "client-1",
        type: "message",
        message: "hello class",
      });
      expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
      expect(openAiCreateMock).not.toHaveBeenCalled();
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("does not auto-trigger AI when author display name is ChatGPT", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-ai-name",
      clientId: "client-1",
      username: "ChatGPT",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-user", content: "@grok answer this", authorName: "ChatGPT" }),
    );

    try {
      await createMessage({
        clientId: "client-1",
        type: "message",
        message: "@grok answer this",
      });

      expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("creates message replies with questionId linkage", async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(
      baseMessage({
        id: "parent-1",
        type: MessageType.MESSAGE,
        content: "Original prompt",
        authorName: "alice",
      }),
    );
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "reply-1",
        type: MessageType.MESSAGE,
        content: "Meine Antwort",
        questionMessageId: "parent-1",
        questionMessage: baseMessage({
          id: "parent-1",
          type: MessageType.MESSAGE,
          content: "Original prompt",
          authorName: "alice",
        }),
      }),
    );

    const created = await createMessage({
      clientId: "client-1",
      type: "message",
      message: "Meine Antwort",
      questionId: "parent-1",
    });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          questionMessageId: "parent-1",
        }),
      }),
    );
    expect(created.questionId).toBe("parent-1");
    expect(created.oldusername).toBe("alice");
    expect(created.oldmessage).toBe("Original prompt");
  });

  it("retries OpenAI once with reduced context when context window is exceeded", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-2",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt explain this with details",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-ai", content: "Short answer", authorName: "ChatGPT" }),
    );
    openAiCreateMock
      .mockRejectedValueOnce(
        new Error("400 Your input exceeds the context window of this model. Please adjust your input and try again."),
      )
      .mockResolvedValueOnce({ output_text: "Short answer", output: [] });

    try {
      await processAiQueue({ maxJobs: 1 });
      expect(openAiCreateMock).toHaveBeenCalledTimes(2);
      expect(prismaMock.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 8,
        }),
      );
      expect(prismaMock.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 2,
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it("retries ChatGPT once on transient 500 and then falls back from prompt to model", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousEnableImageGeneration = process.env.OPENAI_ENABLE_IMAGE_GENERATION;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_ENABLE_IMAGE_GENERATION = "false";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-500-fallback-model-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt explain gravity quickly",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-ai-fallback-model", content: "Model fallback answer", authorName: "ChatGPT" }),
    );
    openAiCreateMock
      .mockRejectedValueOnce(new Error("500 An error occurred while processing your request."))
      .mockRejectedValueOnce(new Error("500 An error occurred while processing your request."))
      .mockResolvedValueOnce({ output_text: "Model fallback answer", output: [] });

    try {
      await processAiQueue({ maxJobs: 1 });

      expect(openAiCreateMock).toHaveBeenCalledTimes(3);
      const thirdRequest = openAiCreateMock.mock.calls[2]?.[0] as { prompt?: unknown; model?: string } | undefined;
      expect(thirdRequest?.prompt).toBeUndefined();
      expect(thirdRequest?.model).toBe("gpt-4o-mini");
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousEnableImageGeneration !== undefined) {
        process.env.OPENAI_ENABLE_IMAGE_GENERATION = previousEnableImageGeneration;
      } else {
        delete process.env.OPENAI_ENABLE_IMAGE_GENERATION;
      }
    }
  });

  it("retries ChatGPT image requests on transient 500 and falls back to gpt-image-1", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousImageModel = process.env.OPENAI_IMAGE_MODEL;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1.5";

    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]);
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        id: "job-image-500-1",
        sourceMessageId: "msg-user",
        username: "tester",
        message: "@chatgpt generate a dramatic sunset skyline",
        imageUrls: [],
        attempts: 1,
      },
    ]);
    prismaMock.aiJob.count.mockResolvedValueOnce(0);
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-ai-image", content: "![Generated Image 1](https://example.com/image.png)", authorName: "ChatGPT" }),
    );
    openAiCreateMock
      .mockRejectedValueOnce(new Error("500 An error occurred while processing your request."))
      .mockRejectedValueOnce(new Error("500 An error occurred while processing your request."))
      .mockResolvedValueOnce({
        output_text: "",
        output: [{ type: "image_generation_call", result: Buffer.from("fake-image").toString("base64") }],
      });

    try {
      await processAiQueue({ maxJobs: 1 });

      expect(openAiCreateMock).toHaveBeenCalledTimes(3);
      const thirdRequest = openAiCreateMock.mock.calls[2]?.[0] as { tools?: Array<{ type: string; model?: string }> } | undefined;
      const imageTool = thirdRequest?.tools?.find((tool) => tool.type === "image_generation");
      expect(imageTool?.model).toBe("gpt-image-1");
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousImageModel !== undefined) process.env.OPENAI_IMAGE_MODEL = previousImageModel;
      else delete process.env.OPENAI_IMAGE_MODEL;
    }
  });

  it("supports multi-select voting with vote changes", async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      ...baseMessage({
        id: "poll-1",
        type: MessageType.VOTING_POLL,
        pollMultiSelect: true,
        pollAllowVoteChange: true,
      }),
      pollOptions: [
        { id: "o1", label: "A", sortOrder: 0, votes: [] },
        { id: "o2", label: "B", sortOrder: 1, votes: [] },
      ],
    });
    prismaMock.pollChoiceVote.findMany.mockResolvedValue([
      { id: "old", pollMessageId: "poll-1", userId: "user-id", pollOptionId: "o1" },
    ]);
    prismaMock.pollChoiceVote.groupBy.mockResolvedValue([
      { pollOptionId: "o1", _count: { pollOptionId: 0 } },
      { pollOptionId: "o2", _count: { pollOptionId: 1 } },
    ]);
    prismaMock.message.update.mockResolvedValue(
      baseMessage({
        id: "poll-1",
        type: MessageType.VOTING_POLL,
        pollLeftCount: 0,
        pollRightCount: 1,
        pollOptions: [
          { id: "o1", label: "A", sortOrder: 0, votes: [] },
          { id: "o2", label: "B", sortOrder: 1, votes: [{ id: "v2" }] },
        ],
      }),
    );

    const result = await votePoll({
      clientId: "client-1",
      pollMessageId: "poll-1",
      optionIds: ["o2"],
    });

    expect(result.poll?.options.find((option) => option.id === "o2")?.votes).toBe(1);
    expect(prismaMock.pollChoiceVote.deleteMany).toHaveBeenCalled();
  });

  it("extends existing polls with additional options", async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce({
      ...baseMessage({
        id: "poll-extend-1",
        type: MessageType.VOTING_POLL,
        content: "Welche Farbe?",
      }),
      pollOptions: [
        { id: "o1", label: "Rot", sortOrder: 0, votes: [] },
        { id: "o2", label: "Blau", sortOrder: 1, votes: [] },
      ],
    });
    prismaMock.message.update.mockResolvedValueOnce(
      baseMessage({
        id: "poll-extend-1",
        type: MessageType.VOTING_POLL,
        content: "Welche Farbe?",
        pollOptions: [
          { id: "o1", label: "Rot", sortOrder: 0, votes: [] },
          { id: "o2", label: "Blau", sortOrder: 1, votes: [] },
          { id: "o3", label: "Grün", sortOrder: 2, votes: [] },
        ],
      }),
    );

    const result = await extendPoll({
      clientId: "client-1",
      pollMessageId: "poll-extend-1",
      pollOptions: ["Grün"],
    });

    expect(prismaMock.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "poll-extend-1" },
        data: expect.objectContaining({
          pollOptions: {
            create: [{ label: "Grün", sortOrder: 2 }],
          },
        }),
      }),
    );
    expect(result.poll?.options.map((option) => option.label)).toEqual(["Rot", "Blau", "Grün"]);
    expect(publishMock).toHaveBeenCalledWith("poll.updated", expect.objectContaining({ id: "poll-extend-1" }));
  });

  it("rejects extending a poll with duplicate existing options", async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce({
      ...baseMessage({
        id: "poll-extend-2",
        type: MessageType.VOTING_POLL,
        content: "Welche Farbe?",
      }),
      pollOptions: [
        { id: "o1", label: "Rot", sortOrder: 0, votes: [] },
        { id: "o2", label: "Blau", sortOrder: 1, votes: [] },
      ],
    });

    await expect(
      extendPoll({
        clientId: "client-1",
        pollMessageId: "poll-extend-2",
        pollOptions: ["Rot"],
      }),
    ).rejects.toThrow("Mindestens eine Option existiert bereits in der Umfrage");
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });

  it("rejects extending incompatible legacy polls without modern options", async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(
      baseMessage({
        id: "poll-legacy",
        type: MessageType.VOTING_POLL,
        optionOne: "A",
        optionTwo: "B",
        pollOptions: [],
      }),
    );

    await expect(
      extendPoll({
        clientId: "client-1",
        pollMessageId: "poll-legacy",
        pollOptions: ["C"],
      }),
    ).rejects.toThrow("Diese Umfrage kann nicht erweitert werden");
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });

  it("creates message reaction and emits update + validation event", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-1",
          content: "hello class",
          authorId: "author-2",
          authorName: "alice",
          reactions: [],
        }),
      )
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-1",
          content: "hello class",
          authorId: "author-2",
          authorName: "alice",
          reactions: [baseReaction({ messageId: "msg-react-1", reaction: "LOL" })],
        }),
      );
    prismaMock.messageReaction.findUnique.mockResolvedValueOnce(null);

    const result = await reactToMessage({
      clientId: "client-1",
      messageId: "msg-react-1",
      reaction: "LOL",
    });

    expect(prismaMock.messageReaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: "msg-react-1",
          userId: "user-id",
          reaction: "LOL",
        }),
      }),
    );
    expect(result.reactions?.viewerReaction).toBe("LOL");
    expect(publishMock).toHaveBeenCalledWith("message.updated", expect.objectContaining({ id: "msg-react-1" }));
    expect(publishMock).toHaveBeenCalledWith(
      "reaction.received",
      expect.objectContaining({
        targetUsername: "alice",
        fromUsername: "tester",
        messageId: "msg-react-1",
        reaction: "LOL",
      }),
    );
  });

  it("toggles off identical reaction when user sends same reaction twice", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-2",
          content: "same reaction",
          authorId: "author-2",
          authorName: "alice",
          reactions: [baseReaction({ id: "reaction-existing", messageId: "msg-react-2", reaction: "LOL" })],
        }),
      )
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-2",
          content: "same reaction",
          authorId: "author-2",
          authorName: "alice",
          reactions: [],
        }),
      );
    prismaMock.messageReaction.findUnique.mockResolvedValueOnce({
      id: "reaction-existing",
      messageId: "msg-react-2",
      userId: "user-id",
      reaction: "LOL",
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
      updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    const result = await reactToMessage({
      clientId: "client-1",
      messageId: "msg-react-2",
      reaction: "LOL",
    });

    expect(prismaMock.messageReaction.delete).toHaveBeenCalledWith({
      where: { id: "reaction-existing" },
    });
    expect(result.reactions?.viewerReaction).toBeNull();
    const receivedCalls = publishMock.mock.calls.filter((call) => call[0] === "reaction.received");
    expect(receivedCalls).toHaveLength(0);
  });

  it("updates reaction when user changes to a different one", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-3",
          content: "change reaction",
          authorId: "author-2",
          authorName: "alice",
          reactions: [baseReaction({ id: "reaction-existing-2", messageId: "msg-react-3", reaction: "FIRE" })],
        }),
      )
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-3",
          content: "change reaction",
          authorId: "author-2",
          authorName: "alice",
          reactions: [baseReaction({ id: "reaction-existing-2", messageId: "msg-react-3", reaction: "LOL" })],
        }),
      );
    prismaMock.messageReaction.findUnique.mockResolvedValueOnce({
      id: "reaction-existing-2",
      messageId: "msg-react-3",
      userId: "user-id",
      reaction: "FIRE",
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
      updatedAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    const result = await reactToMessage({
      clientId: "client-1",
      messageId: "msg-react-3",
      reaction: "LOL",
    });

    expect(prismaMock.messageReaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reaction-existing-2" },
        data: { reaction: "LOL" },
      }),
    );
    expect(result.reactions?.viewerReaction).toBe("LOL");
  });

  it("does not emit validation event for own message reactions", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-self",
          content: "self reaction",
          authorId: "user-id",
          authorName: "tester",
          reactions: [],
        }),
      )
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-self",
          content: "self reaction",
          authorId: "user-id",
          authorName: "tester",
          reactions: [baseReaction({ messageId: "msg-react-self", reaction: "BIG_BRAIN" })],
        }),
      );
    prismaMock.messageReaction.findUnique.mockResolvedValueOnce(null);

    await reactToMessage({
      clientId: "client-1",
      messageId: "msg-react-self",
      reaction: "BIG_BRAIN",
    });

    const receivedCalls = publishMock.mock.calls.filter((call) => call[0] === "reaction.received");
    expect(receivedCalls).toHaveLength(0);
  });

  it("allows reactions on system join messages", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-system-join-react",
          authorId: null,
          authorName: "System",
          content: "alice ist dem Chat beigetreten",
          reactions: [],
        }),
      )
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-system-join-react",
          authorId: null,
          authorName: "System",
          content: "alice ist dem Chat beigetreten",
          reactions: [baseReaction({ messageId: "msg-system-join-react", reaction: "LOL" })],
        }),
      );
    prismaMock.messageReaction.findUnique.mockResolvedValueOnce(null);

    const result = await reactToMessage({
      clientId: "client-1",
      messageId: "msg-system-join-react",
      reaction: "LOL",
    });

    expect(prismaMock.messageReaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: "msg-system-join-react",
          userId: "user-id",
          reaction: "LOL",
        }),
      }),
    );
    expect(result.reactions?.viewerReaction).toBe("LOL");
  });

  it("attributes reactions on legacy join system messages to the joined user", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-system-join-legacy",
          authorId: null,
          authorName: "System",
          content: "alice ist dem Chat beigetreten",
          reactions: [],
        }),
      )
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-system-join-legacy",
          authorId: "author-join-1",
          authorName: "System",
          content: "alice ist dem Chat beigetreten",
          reactions: [baseReaction({ messageId: "msg-system-join-legacy", reaction: "FIRE" })],
        }),
      );
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: "author-join-1",
      clientId: "client-join-1",
      username: "alice",
      profilePicture: "https://example.com/alice.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.messageReaction.findUnique.mockResolvedValueOnce(null);

    await reactToMessage({
      clientId: "client-1",
      messageId: "msg-system-join-legacy",
      reaction: "FIRE",
    });

    expect(prismaMock.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "msg-system-join-legacy",
          authorId: null,
        },
        data: {
          authorId: "author-join-1",
        },
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      "taste.updated",
      expect.objectContaining({ userId: "author-join-1", reason: "reaction" }),
    );
  });

  it("rejects reactions on non-join system messages", async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce(
      baseMessage({
        id: "msg-system-react",
        authorId: null,
        authorName: "System",
        content: "alice hat den Chat verlassen",
      }),
    );

    await expect(
      reactToMessage({
        clientId: "client-1",
        messageId: "msg-system-react",
        reaction: "LOL",
      }),
    ).rejects.toThrow("Diese Systemnachricht kann nicht bewertet werden");
  });

  it("schreibt Behavior-Event bei neuer Nachricht", async () => {
    const previousGrokKey = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = "test-grok-key";
    prismaMock.message.create.mockResolvedValueOnce(baseMessage({ id: "msg-event-1", content: "hällo äöüß" }));

    try {
      await createMessage({
        clientId: "client-1",
        type: "message",
        message: "hällo äöüß",
      });

      expect(prismaMock.userBehaviorEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-id",
            type: "MESSAGE_CREATED",
            messageId: "msg-event-1",
          }),
        }),
      );
      expect(publishMock).toHaveBeenCalledWith(
        "taste.updated",
        expect.objectContaining({
          userId: "user-id",
          reason: "message",
        }),
      );
    } finally {
      process.env.GROK_API_KEY = previousGrokKey;
    }
  });

  it("schreibt Behavior-Events für gegebene und erhaltene Reaktion", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-event",
          content: "top post",
          authorId: "author-2",
          authorName: "alice",
          reactions: [],
        }),
      )
      .mockResolvedValueOnce(
        baseMessage({
          id: "msg-react-event",
          content: "top post",
          authorId: "author-2",
          authorName: "alice",
          reactions: [baseReaction({ messageId: "msg-react-event", reaction: "FIRE" })],
        }),
      );
    prismaMock.messageReaction.findUnique.mockResolvedValueOnce(null);

    await reactToMessage({
      clientId: "client-1",
      messageId: "msg-react-event",
      reaction: "FIRE",
    });

    const reactionEventCalls = prismaMock.userBehaviorEvent.create.mock.calls.filter((call) => {
      const arg = call[0] as { data?: { type?: string } };
      return arg?.data?.type === "REACTION_GIVEN" || arg?.data?.type === "REACTION_RECEIVED";
    });
    expect(reactionEventCalls.length).toBeGreaterThanOrEqual(2);
    expect(publishMock).toHaveBeenCalledWith(
      "taste.updated",
      expect.objectContaining({ userId: "user-id", reason: "reaction" }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      "taste.updated",
      expect.objectContaining({ userId: "author-2", reason: "reaction" }),
    );
  });

  it("liefert detailliertes Taste-Profil für 7d/30d/Gesamt", async () => {
    prismaMock.message.findMany.mockResolvedValue([
      {
        id: "msg-1",
        type: MessageType.MESSAGE,
        content: "hi @grok",
        createdAt: new Date("2026-02-10T10:00:00.000Z"),
        taggingStatus: "COMPLETED",
        taggingPayload: {
          messageTags: [{ tag: "funny", score: 0.9 }],
          categories: {
            themes: [{ tag: "school", score: 0.8 }],
            humor: [{ tag: "sarcasm", score: 0.7 }],
            art: [],
            tone: [{ tag: "casual", score: 0.8 }],
            topics: [{ tag: "class", score: 0.6 }],
          },
          images: [],
        },
      },
    ]);
    prismaMock.messageReaction.findMany.mockResolvedValue([]);
    prismaMock.pollChoiceVote.findMany.mockResolvedValue([]);
    prismaMock.userBehaviorEvent.findMany.mockResolvedValue([]);
    prismaMock.userBehaviorEvent.findFirst.mockResolvedValue({
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    const result = await getTasteProfileDetailed({ clientId: "client-1" });
    expect(result.windows["7d"]).toBeDefined();
    expect(result.windows["30d"]).toBeDefined();
    expect(result.windows.all).toBeDefined();
    expect(result.windows.all.interests.topTags[0]?.tag).toBe("funny");
  });

  it("adds user tag for reactions on system join messages in taste profile", async () => {
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.messageReaction.findMany.mockResolvedValue([
      {
        reaction: "FIRE",
        updatedAt: new Date("2026-02-12T10:00:00.000Z"),
        userId: null,
        user: null,
        message: {
          id: "sys-join-msg-1",
          authorId: null,
          authorName: "System",
          authorProfilePicture: "https://example.com/system.png",
          content: "Alice ist dem Chat beigetreten",
          taggingPayload: null,
        },
      },
    ]);
    prismaMock.pollChoiceVote.findMany.mockResolvedValue([]);
    prismaMock.userBehaviorEvent.findMany.mockResolvedValue([]);
    prismaMock.userBehaviorEvent.findFirst.mockResolvedValue({
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
    });

    const result = await getTasteProfileDetailed({ clientId: "client-1" });
    expect(result.windows.all.interests.topTags.some((entry) => entry.tag === "user:alice")).toBe(true);
  });

  it("liefert paginierte Taste-Events", async () => {
    prismaMock.userBehaviorEvent.findMany.mockResolvedValue([
      {
        id: "ev-3",
        type: "REACTION_GIVEN",
        createdAt: new Date("2026-02-12T10:00:00.000Z"),
        messageId: "m3",
        relatedUserId: "u2",
        reaction: "LOL",
        preview: "preview 3",
        meta: { relatedUsername: "alice" },
      },
      {
        id: "ev-2",
        type: "MESSAGE_CREATED",
        createdAt: new Date("2026-02-11T10:00:00.000Z"),
        messageId: "m2",
        relatedUserId: null,
        reaction: null,
        preview: "preview 2",
        meta: {},
      },
      {
        id: "ev-1",
        type: "POLL_CREATED",
        createdAt: new Date("2026-02-10T10:00:00.000Z"),
        messageId: "m1",
        relatedUserId: null,
        reaction: null,
        preview: "preview 1",
        meta: {},
      },
    ]);

    const result = await getTasteProfileEvents({
      clientId: "client-1",
      limit: 2,
    });

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("2026-02-11T10:00:00.000Z");
  });

  it("liefert sanitisiertes öffentliches Nutzerprofil", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: "viewer-id",
        clientId: "viewer-1",
        username: "viewer",
        profilePicture: "https://example.com/viewer.png",
        status: "",
        isOnline: true,
        lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
        ppcMemberScoreRaw: 10,
        ppcMemberLastActiveAt: new Date("2026-02-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "target-id",
        clientId: "target-1",
        username: "alice",
        profilePicture: "https://example.com/alice.png",
        status: "online",
        isOnline: true,
        lastSeenAt: new Date("2026-02-12T11:00:00.000Z"),
        ppcMemberScoreRaw: 120,
        ppcMemberLastActiveAt: new Date("2026-02-12T11:00:00.000Z"),
      });
    prismaMock.message.findMany.mockResolvedValue([
      {
        id: "msg-1",
        type: MessageType.MESSAGE,
        content: "Hallo",
        createdAt: new Date("2026-02-10T10:00:00.000Z"),
        taggingStatus: "COMPLETED",
        taggingPayload: null,
      },
    ]);
    prismaMock.messageReaction.findMany.mockResolvedValue([]);
    prismaMock.userBehaviorEvent.findMany.mockResolvedValue([]);
    prismaMock.pollChoiceVote.findMany.mockResolvedValue([]);

    const result = await getPublicUserProfile({
      viewerClientId: "viewer-1",
      targetClientId: "target-1",
    });

    expect(result.username).toBe("alice");
    expect(result.stats.postsTotal).toBe(1);
    expect(result.stats).not.toHaveProperty("tagging");
    expect(result.stats).not.toHaveProperty("interests");
  });

  it('emits "hat den Chat verlassen" when stale users are cleaned', async () => {
    prismaMock.user.update.mockResolvedValue({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.findMany.mockResolvedValueOnce([
      {
        id: "stale-1",
        clientId: "client-stale",
        username: "alice",
        profilePicture: "https://example.com/alice.png",
        status: "typing…",
        isOnline: true,
        lastSeenAt: new Date("2026-02-10T08:00:00.000Z"),
      },
    ]);
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "sys-left", content: "alice hat den Chat verlassen", authorName: "System" }),
    );

    await pingPresence({ clientId: "client-1" });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "alice hat den Chat verlassen",
          authorName: "System",
        }),
      }),
    );
  });

  it("marks user offline even when user-row delete fails", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: false,
      lastSeenAt: new Date("2026-02-10T10:01:00.000Z"),
    });
    prismaMock.user.delete.mockRejectedValueOnce(new Error("foreign key constraint"));
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "sys-left-explicit", content: "tester hat den Chat verlassen", authorName: "System" }),
    );

    const result = await markUserOffline({ clientId: "client-1" });

    expect(result.isOnline).toBe(false);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "client-1" },
        data: expect.objectContaining({ isOnline: false, status: "" }),
      }),
    );
    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "tester hat den Chat verlassen",
          authorName: "System",
        }),
      }),
    );
  });

  it("recomputes PPC Score rank and emits rank-up system message", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
      ppcMemberScoreRaw: 295,
      ppcMemberLastActiveAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.userBehaviorEvent.groupBy.mockResolvedValueOnce([
      { type: "MESSAGE_CREATED", _count: { type: 80 } },
    ]);
    prismaMock.messageReaction.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.userBehaviorEvent.findFirst.mockResolvedValueOnce({
      createdAt: new Date("2026-02-11T10:00:00.000Z"),
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-11T10:00:00.000Z"),
      ppcMemberScoreRaw: 400,
      ppcMemberLastActiveAt: new Date("2026-02-11T10:00:00.000Z"),
    });
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({
        id: "sys-rank-up-1",
        content: "tester ist auf Silber aufgestiegen · PPC Score 370",
        authorName: "System",
      }),
    );

    await recomputePpcMemberForUser("user-id");

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringMatching(/ist auf Silber aufgestiegen.*PPC Score/i),
          authorName: "System",
          authorId: "user-id",
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith(
      "rank.up",
      expect.objectContaining({
        userId: "user-id",
        username: "tester",
        previousRank: "BRONZE",
        rank: "SILBER",
        score: expect.any(Number),
      }),
    );
  });

  it("falls back when USERNAME_CHANGED enum is missing in DB for latest-activity query", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-11T10:00:00.000Z"),
      ppcMemberScoreRaw: 0,
      ppcMemberLastActiveAt: null,
    });
    prismaMock.userBehaviorEvent.groupBy.mockResolvedValueOnce([]);
    prismaMock.messageReaction.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.userBehaviorEvent.findFirst
      .mockRejectedValueOnce(new Error('Invalid input value for enum "UserBehaviorEventType": "USERNAME_CHANGED"'))
      .mockResolvedValueOnce(null);
    prismaMock.message.count.mockResolvedValueOnce(0);
    prismaMock.message.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-11T10:00:00.000Z"),
      ppcMemberScoreRaw: 0,
      ppcMemberLastActiveAt: null,
    });

    await expect(recomputePpcMemberForUser("user-id", { emitRankUp: false })).resolves.toBeUndefined();
    expect(prismaMock.userBehaviorEvent.findFirst).toHaveBeenCalledTimes(2);
  });

  it("counts display-name changes from system join messages as fallback", async () => {
    const renameAt = new Date("2026-02-16T13:10:47.816Z");
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-16T13:11:00.000Z"),
      ppcMemberScoreRaw: 0,
      ppcMemberLastActiveAt: null,
    });
    prismaMock.userBehaviorEvent.groupBy.mockResolvedValueOnce([]);
    prismaMock.messageReaction.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.userBehaviorEvent.findFirst.mockResolvedValueOnce(null);
    prismaMock.message.count.mockResolvedValueOnce(4);
    prismaMock.message.findFirst.mockResolvedValueOnce({ createdAt: renameAt });
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-16T13:11:00.000Z"),
      ppcMemberScoreRaw: 15,
      ppcMemberLastActiveAt: renameAt,
    });

    await recomputePpcMemberForUser("user-id", { emitRankUp: false });

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ppcMemberScoreRaw: 15,
          ppcMemberLastActiveAt: renameAt,
        }),
      }),
    );
  });

  it("resets PPC Member values for excluded users", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "user-system-1",
      clientId: "chatgpt-client",
      username: "ChatGPT",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
      ppcMemberScoreRaw: 999,
      ppcMemberLastActiveAt: new Date("2026-02-10T10:00:00.000Z"),
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user-system-1",
      clientId: "chatgpt-client",
      username: "ChatGPT",
      profilePicture: "https://example.com/avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: new Date("2026-02-10T10:00:00.000Z"),
      ppcMemberScoreRaw: 0,
      ppcMemberLastActiveAt: null,
    });

    await recomputePpcMemberForUser("user-system-1");

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ppcMemberScoreRaw: 0,
          ppcMemberLastActiveAt: null,
        }),
      }),
    );
  });
});
