import type { MemberProgressDTO, MemberRank } from "@/lib/types";

export const PPC_MEMBER_BRAND: MemberProgressDTO["brand"] = "PPC Score";
export const PPC_MEMBER_DECAY_HALF_LIFE_DAYS = 45;
export const PPC_MEMBER_BOT_CREATED_POINTS = 100;
export const PPC_MEMBER_SCORE_WEIGHTS = {
  messagesCreated: 5,
  reactionsGiven: 4,
  reactionsReceived: 5,
  aiMentions: 8,
  pollsCreated: 5,
  pollsExtended: 6,
  pollVotes: 3,
  taggingCompleted: 0,
  usernameChanges: 5,
} as const;

export const PPC_MEMBER_POINT_RULES: Array<{
  id: string;
  label: string;
  description: string;
  points: number;
}> = [
  {
    id: "botsCreated",
    label: "Bot erstellt",
    description: "Für jeden neu angelegten Bot in deinem Bot-Menü.",
    points: PPC_MEMBER_BOT_CREATED_POINTS,
  },
  {
    id: "aiMentions",
    label: "KI oder Bot erwähnt",
    description: "Wenn du @chatgpt, @grok oder einen Charakter-Bot pingst.",
    points: PPC_MEMBER_SCORE_WEIGHTS.aiMentions,
  },
  {
    id: "pollsExtended",
    label: "Umfrage erweitert",
    description: "Wenn du einer bestehenden Umfrage neue Optionen hinzufügst.",
    points: PPC_MEMBER_SCORE_WEIGHTS.pollsExtended,
  },
  {
    id: "messagesCreated",
    label: "Nachricht erstellt",
    description: "Für normale Nachrichten, Fragen und Antworten im Chat.",
    points: PPC_MEMBER_SCORE_WEIGHTS.messagesCreated,
  },
  {
    id: "reactionsReceived",
    label: "Reaktion erhalten",
    description: "Wenn andere auf deine Nachricht reagieren.",
    points: PPC_MEMBER_SCORE_WEIGHTS.reactionsReceived,
  },
  {
    id: "pollsCreated",
    label: "Umfrage erstellt",
    description: "Für jede neue Abstimmung, die du startest.",
    points: PPC_MEMBER_SCORE_WEIGHTS.pollsCreated,
  },
  {
    id: "usernameChanges",
    label: "Anzeigename geändert",
    description: "Wenn du deinen sichtbaren Namen änderst.",
    points: PPC_MEMBER_SCORE_WEIGHTS.usernameChanges,
  },
  {
    id: "reactionsGiven",
    label: "Reaktion gegeben",
    description: "Wenn du auf Nachrichten anderer reagierst.",
    points: PPC_MEMBER_SCORE_WEIGHTS.reactionsGiven,
  },
  {
    id: "pollVotes",
    label: "Bei Umfrage abgestimmt",
    description: "Für jede abgegebene Stimme in einer Umfrage.",
    points: PPC_MEMBER_SCORE_WEIGHTS.pollVotes,
  },
];

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

interface RankStep {
  rank: MemberRank;
  minScore: number;
  label: string;
}

export const MEMBER_RANK_STEPS: readonly RankStep[] = [
  { rank: "BRONZE", minScore: 0, label: "Bronze" },
  { rank: "SILBER", minScore: 300, label: "Silber" },
  { rank: "GOLD", minScore: 900, label: "Gold" },
  { rank: "PLATIN", minScore: 1800, label: "Platin" },
  { rank: "DIAMANT", minScore: 4200, label: "Diamant" },
  { rank: "ONYX", minScore: 9000, label: "Onyx" },
  { rank: "TITAN", minScore: 18000, label: "Titan" },
] as const;

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function memberRankLabel(rank: MemberRank): string {
  return MEMBER_RANK_STEPS.find((entry) => entry.rank === rank)?.label || "Bronze";
}

export function resolveMemberRank(score: number): MemberRank {
  const safeScore = Math.max(0, Math.floor(score));
  for (let index = MEMBER_RANK_STEPS.length - 1; index >= 0; index -= 1) {
    const step = MEMBER_RANK_STEPS[index];
    if (safeScore >= step.minScore) {
      return step.rank;
    }
  }
  return "BRONZE";
}

export function getNextMemberRank(rank: MemberRank): MemberRank | undefined {
  const currentIndex = MEMBER_RANK_STEPS.findIndex((entry) => entry.rank === rank);
  if (currentIndex === -1) return undefined;
  return MEMBER_RANK_STEPS[currentIndex + 1]?.rank;
}

export function getRankOrder(rank: MemberRank): number {
  return MEMBER_RANK_STEPS.findIndex((entry) => entry.rank === rank);
}

export function isMemberRankUpgrade(previous: MemberRank, next: MemberRank): boolean {
  return getRankOrder(next) > getRankOrder(previous);
}

export function computeDecayedMemberScore(input: {
  rawScore: number;
  lastActiveAt?: Date | string | null;
  now?: Date;
}): number {
  const safeRawScore = normalizeScore(input.rawScore);
  if (safeRawScore <= 0) return 0;

  const now = input.now || new Date();
  const lastActiveAt = normalizeDate(input.lastActiveAt);
  if (!lastActiveAt) {
    return Math.round(safeRawScore);
  }

  const inactiveMs = Math.max(0, now.getTime() - lastActiveAt.getTime());
  const inactiveDays = inactiveMs / MS_PER_DAY;
  const decayFactor = Math.pow(0.5, inactiveDays / PPC_MEMBER_DECAY_HALF_LIFE_DAYS);
  return Math.max(0, Math.round(safeRawScore * decayFactor));
}

export function buildMemberProgress(input: {
  rawScore: number;
  lastActiveAt?: Date | string | null;
  now?: Date;
}): MemberProgressDTO {
  const score = computeDecayedMemberScore(input);
  const rank = resolveMemberRank(score);
  const nextRank = getNextMemberRank(rank);

  const nextMinScore = nextRank
    ? MEMBER_RANK_STEPS.find((entry) => entry.rank === nextRank)?.minScore
    : undefined;

  const pointsToNext = typeof nextMinScore === "number"
    ? Math.max(0, nextMinScore - score)
    : undefined;

  const lastActive = normalizeDate(input.lastActiveAt);

  return {
    brand: PPC_MEMBER_BRAND,
    score,
    rank,
    nextRank,
    pointsToNext,
    lastActiveAt: lastActive ? lastActive.toISOString() : undefined,
  };
}
