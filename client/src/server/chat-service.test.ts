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
  createMessage,
  getChatBackground,
  loginUser,
  markUserOffline,
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
    openAiCreateMock.mockResolvedValue({ output_text: "", output: [] });
  });

  it("rejects blacklisted usernames on login", async () => {
    prismaMock.blacklistEntry.findUnique.mockResolvedValueOnce({
      id: "blocked",
      username: "badname",
    });

    await expect(loginUser({ username: "badname", clientId: "client-1" })).rejects.toThrow(
      "Username is not allowed",
    );
  });

  it('posts "joined the chat" system message on login', async () => {
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
        content: "tester joined the chat",
        authorName: "System",
      }),
    );

    await loginUser({ username: "tester", clientId: "client-1" });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "tester joined the chat",
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
      "Username is already in use",
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

  it('posts "old_name is now new_name" system message on rename', async () => {
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
        content: "tester is now newname",
        authorName: "System",
      }),
    );

    await renameUser({ clientId: "client-1", newUsername: "newname" });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "tester is now newname",
          authorName: "System",
        }),
      }),
    );
  });

  it("processes @chatgpt mention without blocking response", async () => {
    prismaMock.message.create.mockResolvedValueOnce(
      baseMessage({ id: "msg-user", content: "@chatgpt explain gravity" }),
    );

    const result = await Promise.race([
      createMessage({
        clientId: "client-1",
        type: "message",
        message: "@chatgpt explain gravity",
      }).then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 80)),
    ]);

    expect(result).toBe("resolved");
  });

  it("does not call OpenAI when @chatgpt is not mentioned", async () => {
    prismaMock.message.create.mockResolvedValueOnce(baseMessage({ id: "msg-user", content: "hello class" }));

    await createMessage({
      clientId: "client-1",
      type: "message",
      message: "hello class",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(openAiCreateMock).not.toHaveBeenCalled();
  });

  it("retries OpenAI once with reduced context when context window is exceeded", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    try {
      prismaMock.message.create.mockResolvedValueOnce(
        baseMessage({
          id: "msg-user",
          content: "@chatgpt explain this",
        }),
      );
      openAiCreateMock
        .mockRejectedValueOnce(
          new Error("400 Your input exceeds the context window of this model. Please adjust your input and try again."),
        )
        .mockResolvedValueOnce({ output_text: "Short answer", output: [] });

      await createMessage({
        clientId: "client-1",
        type: "message",
        message: "@chatgpt explain this with details",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

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

  it('emits "left the chat" when stale users are cleaned', async () => {
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
      baseMessage({ id: "sys-left", content: "alice left the chat", authorName: "System" }),
    );

    await pingPresence({ clientId: "client-1" });

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "alice left the chat",
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
      baseMessage({ id: "sys-left-explicit", content: "tester left the chat", authorName: "System" }),
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
          content: "tester left the chat",
          authorName: "System",
        }),
      }),
    );
  });
});
