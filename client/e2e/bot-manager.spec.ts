import { expect, test, type Page } from "@playwright/test";

interface ManagedBotFixture {
  id: string;
  displayName: string;
  profilePicture: string;
  mentionHandle: string;
  instructions: string;
  catchphrases: string[];
  createdAt: string;
  updatedAt: string;
}

const FIXTURE_NOW = "2026-02-27T18:00:00.000Z";
const SESSION = {
  id: "user-id",
  clientId: "client-1",
  loginName: "tester.login",
  username: "tester",
  profilePicture: "/default-avatar.svg",
  sessionToken: "session-token",
  sessionExpiresAt: "2026-03-27T18:00:00.000Z",
};

function makeBot(overrides: Partial<ManagedBotFixture> = {}): ManagedBotFixture {
  return {
    id: "bot-1",
    displayName: "Peter Griffin",
    profilePicture: "/default-avatar.svg",
    mentionHandle: "peter-griffin",
    instructions: "Sei ein chaotischer Familienvater mit absurden Antworten.",
    catchphrases: ["hehehehe", "Lois!"],
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
    ...overrides,
  };
}

function createTasteProfile() {
  const emptyTagGroup = {
    themes: [],
    humor: [],
    art: [],
    tone: [],
    topics: [],
    objects: [],
  };

  const emptyWindow = {
    reactions: {
      givenTotal: 0,
      receivedTotal: 0,
      givenByType: [],
      receivedByType: [],
    },
    interests: {
      topTags: [],
      topMessageCategories: {
        themes: [],
        humor: [],
        art: [],
        tone: [],
        topics: [],
      },
      topImageCategories: {
        themes: emptyTagGroup.themes,
        humor: emptyTagGroup.humor,
        art: emptyTagGroup.art,
        tone: emptyTagGroup.tone,
        objects: emptyTagGroup.objects,
      },
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
      tagging: {
        completed: 0,
        failed: 0,
        pending: 0,
        coverage: 0,
      },
    },
    social: {
      topInteractedUsers: [],
    },
  };

  return {
    userId: "user-id",
    generatedAt: FIXTURE_NOW,
    member: {
      score: 120,
      rawScore: 120,
      rank: "PLATIN",
      nextRank: "DIAMANT",
      pointsToNext: 80,
      progressPercent: 60,
    },
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
      rawScore: 120,
    },
    windows: {
      "7d": emptyWindow,
      "30d": emptyWindow,
      all: emptyWindow,
    },
    transparency: {
      eventRetentionDays: 180,
      rawEventsAvailableSince: FIXTURE_NOW,
      sources: ["messages", "reactions"],
    },
  };
}

async function installChatApiMocks(
  page: Page,
  options: {
    initialBots?: ManagedBotFixture[];
    limit?: number;
  } = {},
): Promise<void> {
  let bots = [...(options.initialBots ?? [])];
  const botLimit = options.limit ?? 2;

  await page.addInitScript(({ session }) => {
    window.localStorage.setItem("chatppc.session", JSON.stringify(session));

    class MockEventSource {
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor() {
        window.setTimeout(() => {
          this.onopen?.(new Event("open"));
        }, 0);
      }

      addEventListener() {}

      removeEventListener() {}

      close() {}
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: MockEventSource,
    });
  }, { session: SESSION });

  await page.route(/\/api\/.*$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (pathname === "/api/presence" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: [
          {
            id: "user-id",
            clientId: "client-1",
            username: "tester",
            profilePicture: "/default-avatar.svg",
            status: "",
            isOnline: true,
            lastSeenAt: FIXTURE_NOW,
            member: {
              score: 120,
              rawScore: 120,
              rank: "PLATIN",
              nextRank: "DIAMANT",
              pointsToNext: 80,
              progressPercent: 60,
            },
          },
        ],
      });
    }

    if (pathname === "/api/messages" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: {
          messages: [],
          hasMore: false,
        },
      });
    }

    if (pathname === "/api/ai/status" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: {
          chatgpt: "online",
          grok: "online",
          chatgptModel: "gpt-5",
          grokModel: "grok-3",
          updatedAt: FIXTURE_NOW,
        },
      });
    }

    if (pathname === "/api/chat/background" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: {
          url: null,
          updatedAt: null,
          updatedBy: null,
        },
      });
    }

    if (pathname === "/api/app/kill" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: {
          enabled: false,
          updatedAt: null,
          updatedBy: null,
        },
      });
    }

    if (pathname === "/api/me/taste/profile" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: createTasteProfile(),
      });
    }

    if (pathname === "/api/me/taste/events" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: {
          items: [],
          nextCursor: null,
          hasMore: false,
        },
      });
    }

    if (pathname === "/api/bots" && method === "GET") {
      return route.fulfill({
        status: 200,
        json: {
          items: bots,
          limit: botLimit,
          used: bots.length,
          remaining: Math.max(0, botLimit - bots.length),
        },
      });
    }

    if (pathname === "/api/bots" && method === "POST") {
      const body = JSON.parse(request.postData() || "{}") as Partial<ManagedBotFixture>;
      const created: ManagedBotFixture = {
        id: `bot-${bots.length + 1}`,
        displayName: String(body.displayName || "Unnamed Bot"),
        profilePicture: String(body.profilePicture || "/default-avatar.svg"),
        mentionHandle: String(body.mentionHandle || "unnamed-bot").replace(/^@+/, "").toLowerCase(),
        instructions: String(body.instructions || ""),
        catchphrases: Array.isArray(body.catchphrases) ? body.catchphrases.map((entry) => String(entry)) : [],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      };
      bots = [...bots, created];
      return route.fulfill({
        status: 200,
        json: created,
      });
    }

    if (pathname.startsWith("/api/bots/") && method === "PATCH") {
      const botId = pathname.split("/").at(-1) || "";
      const body = JSON.parse(request.postData() || "{}") as Partial<ManagedBotFixture>;
      bots = bots.map((bot) =>
        bot.id === botId
          ? {
            ...bot,
            displayName: String(body.displayName || bot.displayName),
            profilePicture: String(body.profilePicture || bot.profilePicture),
            mentionHandle: String(body.mentionHandle || bot.mentionHandle).replace(/^@+/, "").toLowerCase(),
            instructions: String(body.instructions || bot.instructions),
            catchphrases: Array.isArray(body.catchphrases) ? body.catchphrases.map((entry) => String(entry)) : bot.catchphrases,
            updatedAt: FIXTURE_NOW,
          }
          : bot,
      );
      const updated = bots.find((bot) => bot.id === botId) || makeBot({ id: botId });
      return route.fulfill({
        status: 200,
        json: updated,
      });
    }

    if (pathname.startsWith("/api/bots/") && method === "DELETE") {
      const botId = pathname.split("/").at(-1) || "";
      bots = bots.filter((bot) => bot.id !== botId);
      return route.fulfill({
        status: 200,
        json: { ok: true },
      });
    }

    if (
      pathname === "/api/presence/ping"
      || pathname === "/api/presence/typing"
      || pathname === "/api/auth/login"
    ) {
      return route.fulfill({
        status: 200,
        json: {
          ...SESSION,
          devMode: false,
          devAuthToken: null,
        },
      });
    }

    return route.fulfill({
      status: 404,
      json: {
        error: `Unhandled ${method} ${pathname}`,
      },
    });
  });
}

async function openBotManager(page: Page): Promise<void> {
  await page.goto("/chat");
  await expect(page.getByTestId("open-profile-editor")).toBeVisible();
  await page.getByTestId("open-profile-editor").click();
  await expect(page.getByTestId("bot-manager-section")).toBeVisible();
}

test("creates and edits a custom bot from the profile overlay", async ({ page }) => {
  await installChatApiMocks(page, { limit: 2 });
  await openBotManager(page);

  await page.getByTestId("bot-name-input").fill("Peter Griffin");
  await page.getByTestId("bot-handle-input").fill("Peter Griffin");
  await page.getByTestId("bot-instructions-input").fill("Sei ein absurder Dad mit komplett ueberzogenen Antworten.");
  await page.getByTestId("bot-catchphrases-input").fill("hehehehe\nLois!");

  await expect(page.getByTestId("bot-manager-section")).toContainText("@peter-griffin");
  await expect(page.getByTestId("bot-helper-text")).toContainText("Handle wird automatisch kleingeschrieben");

  await page.getByTestId("bot-save-button").click();

  await expect(page.getByTestId("bot-card-bot-1")).toContainText("Peter Griffin");
  await expect(page.getByTestId("bot-card-bot-1")).toContainText("@peter-griffin");
  await expect(page.getByTestId("bot-manager-section")).toContainText("1 von 2 belegt");

  await page.getByTestId("bot-edit-bot-1").click();
  await page.getByTestId("bot-name-input").fill("Mayor West");
  await page.getByTestId("bot-save-button").click();

  await expect(page.getByTestId("bot-card-bot-1")).toContainText("Mayor West");
});

test("deletes a bot and frees the visible slot counter", async ({ page }) => {
  await installChatApiMocks(page, {
    limit: 1,
    initialBots: [makeBot()],
  });
  await openBotManager(page);

  await expect(page.getByTestId("bot-manager-section")).toContainText("1 von 1 belegt");
  await expect(page.getByTestId("bot-card-bot-1")).toBeVisible();

  await page.getByTestId("bot-delete-bot-1").click();

  await expect(page.getByTestId("bot-card-bot-1")).toHaveCount(0);
  await expect(page.getByTestId("bot-manager-section")).toContainText("0 von 1 belegt");
  await expect(page.getByTestId("bot-manager-section")).toContainText("1 frei");
  await expect(page.getByTestId("bot-manager-section")).toContainText("Noch kein Bot erstellt");
});
