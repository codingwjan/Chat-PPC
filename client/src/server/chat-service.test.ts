import { MessageType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  blacklistEntry: {
    findUnique: vi.fn(),
  },
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
  pollVote: {
    create: vi.fn(),
  },
}));

const publishMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/sse-bus", () => ({
  publish: publishMock,
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = {
      create: vi.fn(),
    };
  },
}));

import { createMessage, loginUser, renameUser, votePoll } from "@/server/chat-service";

describe("chat service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.blacklistEntry.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture:
        "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg",
    });
  });

  it("rejects blacklisted usernames on login", async () => {
    prismaMock.blacklistEntry.findUnique.mockResolvedValue({
      id: "blocked",
      username: "badname",
    });

    await expect(
      loginUser({
        username: "badname",
        clientId: "client-1",
      }),
    ).rejects.toThrow("Username is not allowed");
  });

  it("creates threaded answers and returns old message context", async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: "question-1",
      type: MessageType.QUESTION,
      content: "What do you think?",
      authorName: "alice",
    });

    prismaMock.message.create.mockResolvedValue({
      id: "answer-1",
      type: MessageType.ANSWER,
      content: "I agree",
      authorName: "tester",
      authorProfilePicture:
        "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg",
      optionOne: null,
      optionTwo: null,
      pollLeftCount: 0,
      pollRightCount: 0,
      questionMessageId: "question-1",
      createdAt: new Date("2026-02-08T10:00:00.000Z"),
      questionMessage: {
        id: "question-1",
        content: "What do you think?",
        authorName: "alice",
      },
    });

    const result = await createMessage({
      clientId: "client-1",
      type: "answer",
      message: "I agree",
      questionId: "question-1",
    });

    expect(result.type).toBe("answer");
    expect(result.questionId).toBe("question-1");
    expect(result.oldusername).toBe("alice");
    expect(result.oldmessage).toBe("What do you think?");
  });

  it("enforces one poll vote per user", async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: "poll-1",
      type: MessageType.VOTING_POLL,
    });

    prismaMock.pollVote.create.mockRejectedValue(new Error("unique constraint"));

    await expect(
      votePoll({
        clientId: "client-1",
        pollMessageId: "poll-1",
        side: "left",
      }),
    ).rejects.toThrow("You have already voted on this poll");
  });

  it("allows updating profile picture without changing username", async () => {
    prismaMock.user.update.mockResolvedValue({
      id: "user-id",
      clientId: "client-1",
      username: "tester",
      profilePicture: "https://example.com/new-avatar.png",
      status: "",
      isOnline: true,
      lastSeenAt: null,
    });

    const result = await renameUser({
      clientId: "client-1",
      profilePicture: "https://example.com/new-avatar.png",
    });

    expect(result.profilePicture).toBe("https://example.com/new-avatar.png");
    expect(prismaMock.blacklistEntry.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("does not block message create response while !ai is processed", async () => {
    prismaMock.message.create
      .mockResolvedValueOnce({
        id: "msg-1",
        type: MessageType.MESSAGE,
        content: "!ai say hi",
        authorName: "tester",
        authorProfilePicture:
          "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg",
        optionOne: null,
        optionTwo: null,
        pollLeftCount: 0,
        pollRightCount: 0,
        questionMessageId: null,
        createdAt: new Date("2026-02-08T10:00:00.000Z"),
        questionMessage: null,
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    const result = await Promise.race([
      createMessage({
        clientId: "client-1",
        type: "message",
        message: "!ai say hi",
      }).then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 80)),
    ]);

    expect(result).toBe("resolved");
  });
});
