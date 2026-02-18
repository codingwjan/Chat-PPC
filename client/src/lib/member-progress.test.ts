import { describe, expect, it } from "vitest";
import {
  buildMemberProgress,
  computeDecayedMemberScore,
  getNextMemberRank,
  isMemberRankUpgrade,
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
    const progress = buildMemberProgress({ rawScore: 450, lastActiveAt: "2026-02-16T12:00:00.000Z" });
    expect(progress.rank).toBe("SILBER");
    expect(progress.nextRank).toBe("GOLD");
    expect(progress.pointsToNext).toBe(450);
  });

  it("does not expose next rank on maximum rank", () => {
    const progress = buildMemberProgress({ rawScore: 5000, lastActiveAt: "2026-02-16T12:00:00.000Z" });
    expect(progress.rank).toBe("PLATIN");
    expect(progress.nextRank).toBeUndefined();
    expect(progress.pointsToNext).toBeUndefined();
    expect(getNextMemberRank("PLATIN")).toBeUndefined();
  });

  it("detects rank upgrades", () => {
    expect(isMemberRankUpgrade("BRONZE", "SILBER")).toBe(true);
    expect(isMemberRankUpgrade("GOLD", "SILBER")).toBe(false);
  });

  it("includes display-name changes in point rules", () => {
    expect(PPC_MEMBER_SCORE_WEIGHTS.usernameChanges).toBe(5);
    expect(PPC_MEMBER_POINT_RULES.some((rule) => rule.id === "usernameChanges" && rule.points === 5)).toBe(true);
  });

  it("does not award points for tagging completed", () => {
    expect(PPC_MEMBER_SCORE_WEIGHTS.taggingCompleted).toBe(0);
    expect(PPC_MEMBER_POINT_RULES.some((rule) => rule.id === "taggingCompleted" && rule.points === 0)).toBe(true);
  });
});
