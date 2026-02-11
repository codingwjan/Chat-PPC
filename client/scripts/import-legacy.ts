import fs from "node:fs/promises";
import path from "node:path";

type LegacyMessageType = "message" | "votingPoll" | "question" | "answer";

interface LegacyUser {
  username: string;
  uuid: string | number;
  isOnline?: boolean;
  status?: string;
  profilePicture?: string;
}

interface LegacyMessage {
  username?: string;
  message?: string;
  uuid?: string | number;
  time?: string;
  type?: string;
  optionone?: string;
  optiontwo?: string;
  resultone?: string;
  resulttwo?: string;
  oldusername?: string;
  oldmessage?: string;
  questionId?: string;
}

interface LegacyBlacklist {
  usernames?: string[];
}

const FALLBACK_START = new Date("2023-02-10T00:00:00.000Z");

export function normalizeLegacyMessageType(type: string | undefined): LegacyMessageType {
  if (type === "votingPoll") return "votingPoll";
  if (type === "question") return "question";
  if (type === "answer") return "answer";
  return "message";
}

export function buildLegacyMessageKey(index: number): string {
  return `legacy:${index}`;
}

export function buildFallbackCreatedAt(index: number): Date {
  return new Date(FALLBACK_START.getTime() + index * 1_000);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseLegacyTime(value: string | undefined, index: number): Date {
  if (!value) {
    return buildFallbackCreatedAt(index);
  }

  return buildFallbackCreatedAt(index);
}

async function run(): Promise<void> {
  const { importLegacyBlacklist, importLegacyMessage, importLegacyUser } = await import(
    "../src/server/chat-service"
  );

  const serverDir = path.resolve(process.cwd(), "../server");
  const usersPath = path.join(serverDir, "users.json");
  const chatPath = path.join(serverDir, "chat.json");
  const blacklistPath = path.join(serverDir, "blacklist.json");

  const [legacyUsers, legacyMessages, legacyBlacklist] = await Promise.all([
    readJson<LegacyUser[]>(usersPath, []),
    readJson<LegacyMessage[]>(chatPath, []),
    readJson<LegacyBlacklist>(blacklistPath, { usernames: [] }),
  ]);

  await importLegacyBlacklist(legacyBlacklist.usernames || []);

  for (const user of legacyUsers) {
    if (!user.username || user.uuid === undefined || user.uuid === null) {
      continue;
    }

    await importLegacyUser({
      clientId: String(user.uuid),
      username: user.username,
      profilePicture: user.profilePicture,
      isOnline: user.isOnline,
      status: user.status,
    });
  }

  const questionIdMap = new Map<string, string>();
  const questionLookupByText = new Map<string, string>();
  const deferredAnswers: Array<{ message: LegacyMessage; index: number }> = [];

  for (let index = 0; index < legacyMessages.length; index += 1) {
    const message = legacyMessages[index];
    const type = normalizeLegacyMessageType(message.type);

    if (type === "answer") {
      deferredAnswers.push({ message, index });
      continue;
    }

    const createdId = await importLegacyMessage({
      legacyKey: buildLegacyMessageKey(index),
      type,
      content: message.message?.trim() || "",
      username: message.username?.trim() || "unknown",
      profilePicture: undefined,
      optionOne: message.optionone,
      optionTwo: message.optiontwo,
      resultone: message.resultone,
      resulttwo: message.resulttwo,
      createdAt: parseLegacyTime(message.time, index),
      authorClientId: message.uuid !== undefined ? String(message.uuid) : undefined,
    });

    if (type === "question") {
      if (message.uuid !== undefined && message.uuid !== null) {
        questionIdMap.set(String(message.uuid), createdId);
      }

      const key = `${message.username || ""}::${message.message || ""}`;
      questionLookupByText.set(key, createdId);
    }
  }

  for (const { message, index } of deferredAnswers) {
    const questionFromId = message.questionId ? questionIdMap.get(String(message.questionId)) : undefined;
    const questionFromText = questionLookupByText.get(`${message.oldusername || ""}::${message.oldmessage || ""}`);
    const questionMessageId = questionFromId || questionFromText;

    await importLegacyMessage({
      legacyKey: buildLegacyMessageKey(index),
      type: "answer",
      content: message.message?.trim() || "",
      username: message.username?.trim() || "unknown",
      profilePicture: undefined,
      questionMessageId,
      createdAt: parseLegacyTime(message.time, index),
      authorClientId: message.uuid !== undefined ? String(message.uuid) : undefined,
    });
  }

  console.log(
    `Legacy import complete: ${legacyUsers.length} users, ${legacyMessages.length} messages, ${(legacyBlacklist.usernames || []).length} blacklist entries.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .catch((error) => {
      console.error("Legacy import failed", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { prisma } = await import("../src/lib/prisma");
      await prisma.$disconnect();
    });
}
