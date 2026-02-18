"use client";

import { memberRankLabel } from "@/lib/member-progress";
import type { MemberProgressDTO } from "@/lib/types";

interface MemberProgressInlineProps {
  member?: MemberProgressDTO;
  variant?: "sidebar" | "list" | "chat";
  highlight?: boolean;
}

const RANK_STYLE_BY_VALUE: Record<NonNullable<MemberProgressDTO["rank"]>, string> = {
  BRONZE: "border-amber-300 bg-amber-50 text-amber-700",
  SILBER: "border-slate-300 bg-slate-50 text-slate-700",
  GOLD: "border-yellow-300 bg-yellow-50 text-yellow-700",
  PLATIN: "border-cyan-300 bg-cyan-50 text-cyan-700",
  DIAMANT: "border-blue-300 bg-blue-50 text-blue-700",
  ONYX: "border-zinc-400 bg-zinc-100 text-zinc-800",
  TITAN: "border-violet-300 bg-violet-50 text-violet-700",
};

function scoreTextClassForVariant(variant: NonNullable<MemberProgressInlineProps["variant"]>): string {
  if (variant === "chat") return "text-[10px] text-slate-500";
  if (variant === "list") return "text-[11px] text-slate-500";
  return "text-xs text-slate-500";
}

function badgeTextClassForVariant(variant: NonNullable<MemberProgressInlineProps["variant"]>): string {
  if (variant === "chat") return "px-1.5 py-0.5 text-[10px]";
  if (variant === "list") return "px-2 py-0.5 text-[10px]";
  return "px-2 py-0.5 text-[11px]";
}

export function MemberProgressInline({
  member,
  variant = "list",
  highlight = false,
}: MemberProgressInlineProps) {
  if (!member) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 ${highlight ? "ppc-score-pop" : ""}`}>
      <span
        className={`inline-flex items-center rounded-full border font-semibold ${badgeTextClassForVariant(variant)} ${RANK_STYLE_BY_VALUE[member.rank]}`}
      >
        {memberRankLabel(member.rank)}
      </span>
      <span className={scoreTextClassForVariant(variant)}>
        PPC Score {member.score}
      </span>
    </div>
  );
}
