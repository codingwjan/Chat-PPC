import { describe, expect, it } from "vitest";
import {
  buildMemberProgress,
  computeDecayedMemberScore,
  getNextMemberRank,
  isMemberRankUpgrade,
  PPC_MEMBER_BOT_CREATED_POINTS,
  PPC_MEMBER_POINT_RULES,
  PPC_MEMBER_SCORE_WEIGHTS,
  resolveMemberRank,
} from "@/lib/member-progress";

describe("member-progress", () => {
  it("resolves rank thresholds", () => {
    expect(resolveMemberRank(0)).toBe("BRONZE");
    expect(resolveMemberRank(299)).toBe("BRONZE");
    expect(resolveMemberRank(300)).toBe("SILBER");
    expect(resolveMemberRank(900)).toBe("GOLD");
    expect(resolveMemberRank(1800)).toBe("PLATIN");
    expect(resolveMemberRank(4200)).toBe("DIAMANT");
    expect(resolveMemberRank(9000)).toBe("ONYX");
    expect(resolveMemberRank(18000)).toBe("TITAN");
  });

  it("computes medium decay with 45-day half life", () => {
    const now = new Date("2026-02-16T12:00:00.000Z");
    const lastActiveAt = new Date("2026-01-02T12:00:00.000Z");
    const score = computeDecayedMemberScore({ rawScore: 1000, lastActiveAt, now });
    expect(score).toBe(500);
  });

  it("handles invalid lastActiveAt by returning rounded raw score", () => {
    const score = computeDecayedMemberScore({
      rawScore: 321.25,
      lastActiveAt: "invalid",
      now: new Date("2026-02-16T12:00:00.000Z"),
    });
    expect(score).toBe(321);
  });

  it("computes next rank and points to next", () => {
    const now = new Date("2026-02-16T12:00:00.000Z");
    const progress = buildMemberProgress({
      rawScore: 450,
      lastActiveAt: "2026-02-16T12:00:00.000Z",
      now,
    });
    expect(progress.rank).toBe("SILBER");
    expect(progress.nextRank).toBe("GOLD");
    expect(progress.pointsToNext).toBe(450);
  });

  it("does not expose next rank on maximum rank", () => {
    const now = new Date("2026-02-16T12:00:00.000Z");
    const progress = buildMemberProgress({
      rawScore: 50000,
      lastActiveAt: "2026-02-16T12:00:00.000Z",
      now,
    });
    expect(progress.rank).toBe("TITAN");
    expect(progress.nextRank).toBeUndefined();
    expect(progress.pointsToNext).toBeUndefined();
    expect(getNextMemberRank("TITAN")).toBeUndefined();
  });

  it("detects rank upgrades", () => {
    expect(isMemberRankUpgrade("BRONZE", "SILBER")).toBe(true);
    expect(isMemberRankUpgrade("GOLD", "SILBER")).toBe(false);
  });

  it("includes display-name changes in point rules", () => {
    expect(PPC_MEMBER_SCORE_WEIGHTS.usernameChanges).toBe(5);
    expect(PPC_MEMBER_POINT_RULES.some((rule) => rule.id === "usernameChanges" && rule.points === 5)).toBe(true);
  });

  it("awards 100 points for bot creation and hides zero-point tagging from the menu", () => {
    expect(PPC_MEMBER_BOT_CREATED_POINTS).toBe(100);
    expect(PPC_MEMBER_POINT_RULES.some((rule) => rule.id === "botsCreated" && rule.points === 100)).toBe(true);
    expect(PPC_MEMBER_SCORE_WEIGHTS.taggingCompleted).toBe(0);
    expect(PPC_MEMBER_POINT_RULES.some((rule) => rule.id === "taggingCompleted")).toBe(false);
  });
});
