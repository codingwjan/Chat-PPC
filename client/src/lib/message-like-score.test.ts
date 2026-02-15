import { describe, expect, it } from "vitest";
import type { MessageDTO, UserTasteProfileDTO } from "@/lib/types";
import { buildMessageLikeScoreMap, computeMessageLikeScore, createEmptyReactionSummary } from "@/lib/message-like-score";

function createBaseMessage(overrides: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: "m1",
    type: "message",
    message: "test",
    username: "alice",
    profilePicture: "/avatar.png",
    createdAt: new Date("2026-02-14T18:00:00.000Z").toISOString(),
    reactions: {
      total: 0,
      score: 0,
      viewerReaction: null,
      summary: createEmptyReactionSummary(),
    },
    ...overrides,
  };
}

function createBaseProfile(overrides: Partial<UserTasteProfileDTO> = {}): UserTasteProfileDTO {
  return {
    userId: "user-1",
    windowDays: 30,
    updatedAt: new Date("2026-02-14T18:00:00.000Z").toISOString(),
    reactionsReceived: 0,
    reactionDistribution: [
      { reaction: "LOL", count: 6 },
      { reaction: "FIRE", count: 3 },
      { reaction: "BASED", count: 1 },
      { reaction: "WTF", count: 0 },
      { reaction: "BIG_BRAIN", count: 0 },
    ],
    topTags: [
      { tag: "funny", score: 0.9 },
      { tag: "school", score: 0.8 },
      { tag: "meme", score: 0.7 },
    ],
    ...overrides,
  };
}

describe("computeMessageLikeScore", () => {
  it("gibt bei hohem Tag-Overlap einen hohen Score", () => {
    const profile = createBaseProfile();
    const message = createBaseMessage({
      tagging: {
        status: "completed",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [
          { tag: "funny", score: 0.95 },
          { tag: "school", score: 0.85 },
          { tag: "meme", score: 0.75 },
        ],
        categories: {
          themes: [{ tag: "school", score: 0.8 }],
          humor: [{ tag: "funny", score: 0.8 }],
          art: [],
          tone: [],
          topics: [],
        },
        images: [],
      },
    });

    const result = computeMessageLikeScore(message, profile, { now: new Date("2026-02-14T18:00:00.000Z") });
    expect(result.state).toBe("ready");
    expect(result.percent).toBeGreaterThan(80);
  });

  it("gibt bei niedrigem Tag-Overlap einen niedrigen Score", () => {
    const profile = createBaseProfile();
    const message = createBaseMessage({
      tagging: {
        status: "completed",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [
          { tag: "finance", score: 0.9 },
          { tag: "coding", score: 0.9 },
        ],
        categories: {
          themes: [{ tag: "stock market", score: 0.8 }],
          humor: [],
          art: [],
          tone: [],
          topics: [{ tag: "investing", score: 0.8 }],
        },
        images: [],
      },
    });

    const result = computeMessageLikeScore(message, profile, { now: new Date("2026-02-14T18:00:00.000Z") });
    expect(result.state).toBe("ready");
    expect(result.percent).toBeLessThan(55);
  });

  it("liefert pending, wenn Tagging noch läuft", () => {
    const profile = createBaseProfile();
    const message = createBaseMessage({
      tagging: {
        status: "pending",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [],
        categories: { themes: [], humor: [], art: [], tone: [], topics: [] },
        images: [],
      },
    });

    const result = computeMessageLikeScore(message, profile, { now: new Date("2026-02-14T18:00:00.000Z") });
    expect(result.state).toBe("pending");
    expect(result.percent).toBeGreaterThanOrEqual(0);
    expect(result.percent).toBeLessThanOrEqual(100);
  });

  it("liefert fallback bei fehlendem oder fehlgeschlagenem Tagging", () => {
    const profile = createBaseProfile();
    const noTaggingResult = computeMessageLikeScore(createBaseMessage(), profile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });
    expect(noTaggingResult.state).toBe("fallback");

    const failedTaggingResult = computeMessageLikeScore(
      createBaseMessage({
        tagging: {
          status: "failed",
          provider: "grok",
          model: "grok-test",
          language: "en",
          messageTags: [],
          categories: { themes: [], humor: [], art: [], tone: [], topics: [] },
          images: [],
          error: "parse failed",
        },
      }),
      profile,
      { now: new Date("2026-02-14T18:00:00.000Z") },
    );
    expect(failedTaggingResult.state).toBe("fallback");
  });

  it("nutzt eine stabile Baseline bei sehr schwacher Qualität", () => {
    const profile = createBaseProfile({
      topTags: [{ tag: "komplett anders", score: 1 }],
      reactionDistribution: [
        { reaction: "LOL", count: 0 },
        { reaction: "FIRE", count: 0 },
        { reaction: "BASED", count: 0 },
        { reaction: "WTF", count: 0 },
        { reaction: "BIG_BRAIN", count: 0 },
      ],
    });

    const veryOldMessage = createBaseMessage({
      createdAt: new Date("2025-12-01T00:00:00.000Z").toISOString(),
      tagging: {
        status: "failed",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [],
        categories: { themes: [], humor: [], art: [], tone: [], topics: [] },
        images: [],
      },
    });

    const result = computeMessageLikeScore(veryOldMessage, profile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });
    expect(result.state).toBe("fallback");
    expect(result.percent).toBeGreaterThanOrEqual(35);
  });

  it("berücksichtigt Reaktionsverteilung", () => {
    const profile = createBaseProfile({
      topTags: [],
    });
    const matchingMessage = createBaseMessage({
      reactions: {
        total: 10,
        score: 12,
        viewerReaction: null,
        summary: [
          { reaction: "LOL", count: 8, users: [] },
          { reaction: "FIRE", count: 2, users: [] },
          { reaction: "BASED", count: 0, users: [] },
          { reaction: "WTF", count: 0, users: [] },
          { reaction: "BIG_BRAIN", count: 0, users: [] },
        ],
      },
    });
    const nonMatchingMessage = createBaseMessage({
      reactions: {
        total: 10,
        score: 10,
        viewerReaction: null,
        summary: [
          { reaction: "LOL", count: 0, users: [] },
          { reaction: "FIRE", count: 0, users: [] },
          { reaction: "BASED", count: 0, users: [] },
          { reaction: "WTF", count: 1, users: [] },
          { reaction: "BIG_BRAIN", count: 9, users: [] },
        ],
      },
    });

    const matching = computeMessageLikeScore(matchingMessage, profile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });
    const nonMatching = computeMessageLikeScore(nonMatchingMessage, profile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });

    expect(matching.percent).toBeGreaterThan(nonMatching.percent);
  });

  it("verarbeitet Umlaute stabil", () => {
    const profile = createBaseProfile({
      topTags: [{ tag: "frühstück äöüß", score: 0.9 }],
    });
    const message = createBaseMessage({
      tagging: {
        status: "completed",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [{ tag: " Frühstück ÄÖÜß ", score: 0.8 }],
        categories: { themes: [], humor: [], art: [], tone: [], topics: [] },
        images: [],
      },
    });

    const result = computeMessageLikeScore(message, profile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });
    expect(result.state).toBe("ready");
    expect(result.percent).toBeGreaterThan(50);
  });

  it("aktualisiert Status bei Message-Update (pending -> ready)", () => {
    const profile = createBaseProfile();
    const pendingMessage = createBaseMessage({
      id: "m-pending",
      tagging: {
        status: "pending",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [],
        categories: { themes: [], humor: [], art: [], tone: [], topics: [] },
        images: [],
      },
    });
    const readyMessage = {
      ...pendingMessage,
      tagging: {
        ...pendingMessage.tagging!,
        status: "completed" as const,
        messageTags: [{ tag: "funny", score: 0.9 }],
      },
    };

    const firstMap = buildMessageLikeScoreMap([pendingMessage], profile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });
    const secondMap = buildMessageLikeScoreMap([readyMessage], profile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });

    expect(firstMap.get("m-pending")?.state).toBe("pending");
    expect(secondMap.get("m-pending")?.state).toBe("ready");
  });

  it("ändert Score bei Profil-Änderung", () => {
    const message = createBaseMessage({
      id: "m-profile-change",
      tagging: {
        status: "completed",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [{ tag: "funny", score: 0.8 }],
        categories: { themes: [], humor: [], art: [], tone: [], topics: [] },
        images: [],
      },
    });
    const matchingProfile = createBaseProfile({
      topTags: [{ tag: "funny", score: 1 }],
    });
    const nonMatchingProfile = createBaseProfile({
      topTags: [{ tag: "boring", score: 1 }],
    });

    const matching = buildMessageLikeScoreMap([message], matchingProfile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });
    const nonMatching = buildMessageLikeScoreMap([message], nonMatchingProfile, {
      now: new Date("2026-02-14T18:00:00.000Z"),
    });

    expect((matching.get("m-profile-change")?.percent || 0)).toBeGreaterThan(
      nonMatching.get("m-profile-change")?.percent || 0,
    );
  });
});
