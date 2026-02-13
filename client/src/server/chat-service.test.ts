import { MessageType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  message: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
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
  createMessage,
  extendPoll,
  getChatBackground,
  loginUser,
  markUserOffline,
  processAiQueue,
  pingPresence,
  renameUser,
  setChatBackground,
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
    createdAt: new Date("2026-02-10T10:00:00.000Z"),
    questionMessage: null,
    pollOptions: [],
    author: null,
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
    prismaMock.message.create.mockResolvedValue(baseMessage());
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.pollChoiceVote.findMany.mockResolvedValue([]);
    prismaMock.pollChoiceVote.createMany.mockResolvedValue({ count: 1 });
    prismaMock.pollChoiceVote.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.pollChoiceVote.groupBy.mockResolvedValue([]);
    prismaMock.aiJob.count.mockResolvedValue(0);
    prismaMock.aiJob.create.mockResolvedValue({ id: "job-1" });
    prismaMock.aiJob.update.mockResolvedValue({ id: "job-1" });
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 0 });
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

  it('posts "ist dem Chat beigetreten" system message on login', async () => {
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
        }),
      }),
    );
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
        username: "Developer",
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
      expect(result.username.toLowerCase()).toContain("developer");
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

  it('posts "old_name heißt jetzt new_name" system message on rename', async () => {
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
        content: "tester heißt jetzt newname",
        authorName: "System",
      }),
    );

    await renameUser({ clientId: "client-1", newUsername: "newname" });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "tester heißt jetzt newname",
          authorName: "System",
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

  it("queues one AI job when both @chatgpt and @grok are mentioned", async () => {
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
      expect(prismaMock.aiJob.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMessageId: "msg-user",
            message: "@chatgpt vs @grok explain gravity",
          }),
        }),
      );
    } finally {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
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
});
