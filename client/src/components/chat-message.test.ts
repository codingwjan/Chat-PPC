import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "@/components/chat-message";
import type { MessageDTO } from "@/lib/types";

function createBaseMessage(overrides: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: "m1",
    type: "message",
    message: "Hallo Welt",
    username: "alice",
    profilePicture: "/avatar.png",
    createdAt: "2026-02-14T18:00:00.000Z",
    reactions: {
      total: 0,
      score: 0,
      viewerReaction: null,
      summary: [
        { reaction: "LIKE", count: 0, users: [] },
        { reaction: "LOL", count: 0, users: [] },
        { reaction: "FIRE", count: 0, users: [] },
        { reaction: "BASED", count: 0, users: [] },
        { reaction: "WTF", count: 0, users: [] },
        { reaction: "BIG_BRAIN", count: 0, users: [] },
      ],
    },
    ...overrides,
  };
}

const noop = () => {};

function renderMessage(
  message: MessageDTO,
  props?: {
    isDeveloperMode?: boolean;
    withReactions?: boolean;
  },
) {
  return renderToStaticMarkup(
    React.createElement(ChatMessage, {
      message,
      currentUserId: "user-bob",
      currentUsername: "bob",
      isDeveloperMode: props?.isDeveloperMode,
      onAnswerDraftChange: noop,
      onSubmitAnswer: noop,
      onVote: noop,
      onReact: props?.withReactions ? noop : undefined,
    }),
  );
}

describe("ChatMessage rendering", () => {
  it("zeigt keinen Match-Text", () => {
    const html = renderMessage(createBaseMessage());
    expect(html).not.toContain("Dein Match");
  });

  it("zeigt keinen Match-Text bei System-Presence", () => {
    const systemMessage = createBaseMessage({
      username: "System",
      message: "alice hat den Chat verlassen",
    });
    const html = renderMessage(systemMessage);
    expect(html).not.toContain("Dein Match");
  });

  it("zeigt Reaktionen unter Join-Systemnachrichten", () => {
    const systemMessage = createBaseMessage({
      username: "System",
      message: "alice ist dem Chat beigetreten",
    });

    const html = renderMessage(systemMessage, { withReactions: true });
    expect(html).toContain("alice ist dem Chat beigetreten");
    expect(html).toContain("Like");
    expect(html).toContain("LOL");
    expect(html).toContain("FIRE");
    expect(html).toContain("BASED");
    expect(html).toContain("WTF");
    expect(html).toContain("BIG BRAIN");
  });

  it("zeigt Rank-Up-Systemnachrichten und Reaktionen", () => {
    const systemMessage = createBaseMessage({
      username: "System",
      message: "alice ist auf Gold aufgestiegen · PPC Score 901",
    });

    const html = renderMessage(systemMessage, { withReactions: true });
    expect(html).toContain("alice ist auf Gold aufgestiegen");
    expect(html).toContain("Like");
    expect(html).toContain("BIG BRAIN");
  });

  it("zeigt unter Join-Systemnachrichten keine Reaktions-Zusammenfassung", () => {
    const systemMessage = createBaseMessage({
      username: "System",
      message: "alice ist dem Chat beigetreten",
      reactions: {
        total: 2,
        score: 2,
        viewerReaction: "LOL",
        summary: [
          { reaction: "LIKE", count: 0, users: [] },
          { reaction: "LOL", count: 2, users: [{ id: "u1", username: "bob", profilePicture: "/bob.png" }] },
          { reaction: "FIRE", count: 0, users: [] },
          { reaction: "BASED", count: 0, users: [] },
          { reaction: "WTF", count: 0, users: [] },
          { reaction: "BIG_BRAIN", count: 0, users: [] },
        ],
      },
    });

    const html = renderMessage(systemMessage, { withReactions: true });
    expect(html).not.toContain("😂 2");
    expect(html).not.toContain("LOL: bob");
  });

  it("blendet nicht-Join-Systemnachrichten komplett aus", () => {
    const systemMessage = createBaseMessage({
      username: "System",
      message: "alice hat den Chat verlassen",
    });

    const html = renderMessage(systemMessage, { withReactions: true });
    expect(html).toBe("");
  });

  it("aligns AI replies to the current user on the right", () => {
    const aiReply = createBaseMessage({
      username: "ChatGPT",
      oldusername: "bob",
      oldmessage: "Wie gehts?",
      questionId: "root-1",
      message: "Alles gut",
    });
    const html = renderMessage(aiReply);
    expect(html).toContain("justify-end");
  });

  it("zeigt Rank und Score neben dem Username", () => {
    const memberMessage = createBaseMessage({
      username: "alice",
      member: {
        brand: "PPC Score",
        score: 321,
        rank: "SILBER",
        nextRank: "GOLD",
        pointsToNext: 579,
        lastActiveAt: "2026-02-14T18:00:00.000Z",
      },
    });

    const html = renderMessage(memberMessage);
    expect(html).toContain("Silber");
    expect(html).toContain("PPC Score 321");
  });

  it("zeigt Reply-Kontext bei gethreadeten Umfragen", () => {
    const pollMessage = createBaseMessage({
      type: "votingPoll",
      message: "Team-Lunch?",
      questionId: "root-1",
      oldusername: "alice",
      oldmessage: "Lass uns abstimmen",
      poll: {
        options: [
          { id: "o1", label: "Pizza", votes: 0, voters: [] },
          { id: "o2", label: "Sushi", votes: 0, voters: [] },
        ],
        settings: {
          multiSelect: false,
          allowVoteChange: true,
        },
      },
    });
    const html = renderMessage(pollMessage, { withReactions: true });
    expect(html).toContain("Antwort auf");
    expect(html).toContain("Lass uns abstimmen");
    expect(html).toContain("von alice");
  });

  it("keeps other AI replies on the left", () => {
    const aiReply = createBaseMessage({
      username: "ChatGPT",
      oldusername: "alice",
      oldmessage: "Wie gehts?",
      questionId: "root-1",
      message: "Alles gut",
    });
    const html = renderMessage(aiReply);
    expect(html).toContain("justify-start");
  });

  it("keeps old own messages on the right via authorId after rename", () => {
    const renamedOldMessage = createBaseMessage({
      authorId: "user-bob",
      username: "oldname",
      message: "legacy message",
    });
    const html = renderMessage(renamedOldMessage);
    expect(html).toContain("justify-end");
  });

  it("zeigt Reaktions-Namen nur auf eigenen Nachrichten", () => {
    const ownMessage = createBaseMessage({
      authorId: "user-bob",
      username: "bob",
      reactions: {
        total: 2,
        score: 2,
        viewerReaction: null,
        summary: [
          { reaction: "LIKE", count: 0, users: [] },
          {
            reaction: "LOL",
            count: 2,
            users: [
              { id: "u1", username: "bob", profilePicture: "/bob.png" },
              { id: "u2", username: "alice", profilePicture: "/alice.png" },
            ],
          },
          { reaction: "FIRE", count: 0, users: [] },
          { reaction: "BASED", count: 0, users: [] },
          { reaction: "WTF", count: 0, users: [] },
          { reaction: "BIG_BRAIN", count: 0, users: [] },
        ],
      },
    });

    const html = renderMessage(ownMessage, { withReactions: true });
    expect(html).toContain("LOL: bob, alice");
  });

  it("blendet Reaktions-Namen auf fremden Nachrichten aus, zeigt aber die Anzahl", () => {
    const foreignMessage = createBaseMessage({
      authorId: "user-alice",
      username: "alice",
      reactions: {
        total: 17,
        score: 17,
        viewerReaction: null,
        summary: [
          { reaction: "LIKE", count: 0, users: [] },
          {
            reaction: "LOL",
            count: 17,
            users: [
              { id: "u1", username: "bob", profilePicture: "/bob.png" },
              { id: "u2", username: "carol", profilePicture: "/carol.png" },
            ],
          },
          { reaction: "FIRE", count: 0, users: [] },
          { reaction: "BASED", count: 0, users: [] },
          { reaction: "WTF", count: 0, users: [] },
          { reaction: "BIG_BRAIN", count: 0, users: [] },
        ],
      },
    });

    const html = renderMessage(foreignMessage, { withReactions: true });
    expect(html).toContain(">17<");
    expect(html).not.toContain("LOL: bob");
    expect(html).not.toContain("LOL: bob, carol");
  });

  it("begrenzt Kategorie-Tags in der Dev-Ansicht auf maximal 8", () => {
    const tags = Array.from({ length: 10 }, (_, i) => ({ tag: `tag-${i + 1}`, score: 0.9 - i * 0.01 }));
    const message = createBaseMessage({
      tagging: {
        status: "completed",
        provider: "grok",
        model: "grok-test",
        language: "en",
        messageTags: [{ tag: "message-tag", score: 0.95 }],
        categories: {
          themes: tags,
          humor: [],
          art: [],
          tone: [],
          topics: [],
        },
        images: [],
      },
    });

    const html = renderMessage(message, { isDeveloperMode: true });
    expect(html).toContain("tag-8");
    expect(html).not.toContain("tag-9");
    expect(html).not.toContain("tag-10");
  });
});
