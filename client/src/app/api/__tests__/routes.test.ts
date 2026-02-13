import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";

const serviceMock = vi.hoisted(() => ({
  loginUser: vi.fn(),
  renameUser: vi.fn(),
  createMessage: vi.fn(),
  getMessages: vi.fn(),
  votePoll: vi.fn(),
  extendPoll: vi.fn(),
  getChatBackground: vi.fn(),
  setChatBackground: vi.fn(),
  getAdminOverview: vi.fn(),
  runAdminAction: vi.fn(),
  getMediaItems: vi.fn(),
}));

vi.mock("@/server/chat-service", () => serviceMock);

describe("api routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles login requests", async () => {
    serviceMock.loginUser.mockResolvedValue({ clientId: "c1", username: "alice" });
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "alice", clientId: "c1" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.username).toBe("alice");
  });

  it("rejects invalid login payloads", async () => {
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "ab", clientId: "c1" }),
      }),
    );

    expect(response.status).toBe(400);
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
