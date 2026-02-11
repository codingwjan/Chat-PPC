import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";

const serviceMock = vi.hoisted(() => ({
  loginUser: vi.fn(),
  renameUser: vi.fn(),
  createMessage: vi.fn(),
  getMessages: vi.fn(),
  votePoll: vi.fn(),
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
});
