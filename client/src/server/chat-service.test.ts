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

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/sse-bus", () => ({ publish: publishMock }));
vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: vi.fn() };
  },
}));

import { createMessage, loginUser, pingPresence, votePoll } from "@/server/chat-service";

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
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.message.create.mockResolvedValue(baseMessage());
    prismaMock.pollChoiceVote.findMany.mockResolvedValue([]);
    prismaMock.pollChoiceVote.createMany.mockResolvedValue({ count: 1 });
    prismaMock.pollChoiceVote.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.pollChoiceVote.groupBy.mockResolvedValue([]);
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

  it('processes "/ai" command without blocking response', async () => {
    prismaMock.message.create
      .mockResolvedValueOnce(baseMessage({ id: "msg-user", content: "/ai explain gravity" }))
      .mockImplementationOnce(() => new Promise(() => {}));

    const result = await Promise.race([
      createMessage({
        clientId: "client-1",
        type: "message",
        message: "/ai explain gravity",
      }).then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 80)),
    ]);

    expect(result).toBe("resolved");
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
});
