import type { MessageDTO, ReactionType, UserTasteProfileDTO } from "@/lib/types";

export type PredictedLikeState = "ready" | "pending" | "fallback";

export interface MessageLikeScoreResult {
  percent: number;
  state: PredictedLikeState;
  debug?: {
    tagMatch: number;
    reactionStyleMatch: number;
    freshness: number;
    final: number;
  };
}

const MATCH_SCORE_BASELINE = 0.35;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function applyBaselineCalibration(quality: number): number {
  const safeQuality = clamp01(quality);
  return clamp01(MATCH_SCORE_BASELINE + (1 - MATCH_SCORE_BASELINE) * safeQuality);
}

function normalizeTagLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addTag(target: Map<string, number>, tag: string, score: number): void {
  const normalized = normalizeTagLabel(tag);
  if (!normalized) return;
  const safeScore = clamp01(score);
  target.set(normalized, (target.get(normalized) || 0) + safeScore);
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const value of a.values()) {
    normA += value * value;
  }
  for (const value of b.values()) {
    normB += value * value;
  }
  if (normA <= 0 || normB <= 0) return 0;

  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [key, value] of small.entries()) {
    const other = large.get(key);
    if (!other) continue;
    dot += value * other;
  }

  return clamp01(dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

function computeFreshnessScore(createdAt: string, nowMs: number): number {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return 0.5;
  const ageMs = Math.max(0, nowMs - createdMs);
  const halfLifeMs = 72 * 60 * 60 * 1_000;
  const decay = Math.exp(-(Math.log(2) * ageMs) / halfLifeMs);
  return clamp01(decay);
}

function createReactionVectorFromProfile(profile: UserTasteProfileDTO | null | undefined): Map<string, number> {
  const vector = new Map<string, number>();
  if (!profile?.reactionDistribution?.length) return vector;
  const total = profile.reactionDistribution.reduce((sum, entry) => sum + Math.max(0, entry.count), 0);
  if (total <= 0) return vector;
  for (const entry of profile.reactionDistribution) {
    vector.set(entry.reaction, Math.max(0, entry.count) / total);
  }
  return vector;
}

function createReactionVectorFromMessage(message: MessageDTO): Map<string, number> {
  const vector = new Map<string, number>();
  const summary = message.reactions?.summary || [];
  const total = summary.reduce((sum, entry) => sum + Math.max(0, entry.count), 0);
  if (total <= 0) return vector;
  for (const entry of summary) {
    vector.set(entry.reaction, Math.max(0, entry.count) / total);
  }
  return vector;
}

function createTagVectorFromProfile(profile: UserTasteProfileDTO | null | undefined): Map<string, number> {
  const vector = new Map<string, number>();
  if (!profile?.topTags?.length) return vector;
  for (const tag of profile.topTags) {
    addTag(vector, tag.tag, tag.score);
  }
  return vector;
}

function addTagListToVector(
  vector: Map<string, number>,
  tags: Array<{ tag: string; score: number }> | undefined,
): void {
  if (!tags?.length) return;
  for (const tag of tags) {
    addTag(vector, tag.tag, tag.score);
  }
}

function createTagVectorFromMessage(message: MessageDTO): Map<string, number> {
  const vector = new Map<string, number>();
  const tagging = message.tagging;
  if (!tagging) return vector;

  addTagListToVector(vector, tagging.messageTags);
  addTagListToVector(vector, tagging.categories.themes);
  addTagListToVector(vector, tagging.categories.humor);
  addTagListToVector(vector, tagging.categories.art);
  addTagListToVector(vector, tagging.categories.tone);
  addTagListToVector(vector, tagging.categories.topics);

  for (const image of tagging.images) {
    addTagListToVector(vector, image.tags);
    addTagListToVector(vector, image.categories.themes);
    addTagListToVector(vector, image.categories.humor);
    addTagListToVector(vector, image.categories.art);
    addTagListToVector(vector, image.categories.tone);
    addTagListToVector(vector, image.categories.objects);
  }

  return vector;
}

function roundPercent(value: number): number {
  return Math.round(clamp01(value) * 100);
}

function computeReactionStyleMatch(
  message: MessageDTO,
  profile: UserTasteProfileDTO | null | undefined,
): number {
  const profileVector = createReactionVectorFromProfile(profile);
  const messageVector = createReactionVectorFromMessage(message);
  if (profileVector.size === 0 || messageVector.size === 0) return 0;
  return cosineSimilarity(profileVector, messageVector);
}

function computeTagMatch(message: MessageDTO, profile: UserTasteProfileDTO | null | undefined): number {
  const profileVector = createTagVectorFromProfile(profile);
  const messageVector = createTagVectorFromMessage(message);
  if (profileVector.size === 0 || messageVector.size === 0) return 0;
  return cosineSimilarity(profileVector, messageVector);
}

export function computeMessageLikeScore(
  message: MessageDTO,
  profile: UserTasteProfileDTO | null | undefined,
  options?: { now?: Date; debug?: boolean },
): MessageLikeScoreResult {
  const nowMs = options?.now?.getTime() ?? Date.now();
  const reactionStyleMatch = computeReactionStyleMatch(message, profile);
  const freshness = computeFreshnessScore(message.createdAt, nowMs);
  const taggingStatus = message.tagging?.status;

  if (taggingStatus === "pending" || taggingStatus === "processing") {
    const fallbackQuality = 0.55 * reactionStyleMatch + 0.45 * freshness;
    const fallback = applyBaselineCalibration(fallbackQuality);
    return {
      percent: roundPercent(fallback),
      state: "pending",
      ...(options?.debug
        ? {
          debug: {
            tagMatch: 0,
            reactionStyleMatch,
            freshness,
            final: clamp01(fallback),
          },
        }
        : {}),
    };
  }

  if (!message.tagging || taggingStatus === "failed") {
    const fallbackQuality = 0.55 * reactionStyleMatch + 0.45 * freshness;
    const fallback = applyBaselineCalibration(fallbackQuality);
    return {
      percent: roundPercent(fallback),
      state: "fallback",
      ...(options?.debug
        ? {
          debug: {
            tagMatch: 0,
            reactionStyleMatch,
            freshness,
            final: clamp01(fallback),
          },
        }
        : {}),
    };
  }

  const tagMatch = computeTagMatch(message, profile);
  const quality = 0.65 * tagMatch + 0.2 * reactionStyleMatch + 0.15 * freshness;
  const finalScore = applyBaselineCalibration(quality);
  return {
    percent: roundPercent(finalScore),
    state: "ready",
    ...(options?.debug
      ? {
        debug: {
          tagMatch,
          reactionStyleMatch,
          freshness,
          final: clamp01(finalScore),
        },
      }
      : {}),
  };
}

export function buildMessageLikeScoreMap(
  messages: MessageDTO[],
  profile: UserTasteProfileDTO | null | undefined,
  options?: { now?: Date; debug?: boolean },
): Map<string, MessageLikeScoreResult> {
  const map = new Map<string, MessageLikeScoreResult>();
  for (const message of messages) {
    map.set(message.id, computeMessageLikeScore(message, profile, options));
  }
  return map;
}

export function createEmptyReactionSummary(): Array<{
  reaction: ReactionType;
  count: number;
  users: Array<{ id: string; username: string; profilePicture: string }>;
}> {
  return [
    { reaction: "LIKE", count: 0, users: [] },
    { reaction: "LOL", count: 0, users: [] },
    { reaction: "FIRE", count: 0, users: [] },
    { reaction: "BASED", count: 0, users: [] },
    { reaction: "WTF", count: 0, users: [] },
    { reaction: "BIG_BRAIN", count: 0, users: [] },
  ];
}
