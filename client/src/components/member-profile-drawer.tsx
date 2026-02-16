"use client";
/* eslint-disable @next/next/no-img-element */

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { MemberProgressInline } from "@/components/member-progress-inline";
import type { MemberRank, PublicUserProfileDTO, PublicUserProfileStatsDTO } from "@/lib/types";

type AiProviderClientId = "chatgpt" | "grok";

interface MemberProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error?: string | null;
  profile: PublicUserProfileDTO | null;
  ownStats?: PublicUserProfileStatsDTO | null;
  aiModels?: Partial<Record<AiProviderClientId, string>>;
  onOpenProfileImage?: (url: string, alt: string) => void;
}

const PROFILE_CARD_TINT_BY_RANK: Record<MemberRank, string> = {
  BRONZE: "rgba(180, 83, 9, 0.28)",
  SILBER: "rgba(100, 116, 139, 0.24)",
  GOLD: "rgba(161, 98, 7, 0.28)",
  PLATIN: "rgba(14, 116, 144, 0.24)",
};

const PROFILE_CARD_TINT_BY_AI: Record<AiProviderClientId, string> = {
  chatgpt: "rgba(167, 139, 250, 0.28)",
  grok: "rgba(192, 132, 252, 0.28)",
};

const AI_PROFILE_COPY: Record<
  AiProviderClientId,
  {
    capabilities: string;
    styleTone: string;
    info: string;
  }
> = {
  chatgpt: {
    capabilities:
      "Textgenerierung (moderiert), Umfrage-Erstellung und Bildgenerierung.",
    styleTone: "Moderiert, klar und sicherheitsorientiert.",
    info: "Wird mit @chatgpt erwähnt und antwortet auf Basis des aktuellen Chat-Kontexts.",
  },
  grok: {
    capabilities:
      "Textgenerierung (unmoderiert) und Umfrage-Erstellung.",
    styleTone: "Unmoderiert.",
    info: "Wird mit @grok erwähnt. Bildgenerierung ist für @grok deaktiviert.",
  },
};

function getAiProvider(clientId: string | null | undefined): AiProviderClientId | null {
  if (clientId === "chatgpt" || clientId === "grok") return clientId;
  return null;
}

function profileCardGradient(profile: PublicUserProfileDTO | null): string | undefined {
  const aiProvider = getAiProvider(profile?.clientId);
  if (aiProvider) {
    const tint = PROFILE_CARD_TINT_BY_AI[aiProvider];
    return `linear-gradient(to top right, ${tint} 0%, rgba(248, 250, 252, 0.96) 58%, rgba(241, 245, 249, 0.96) 100%)`;
  }

  const rank = profile?.member?.rank;
  if (!rank) return undefined;
  const tint = PROFILE_CARD_TINT_BY_RANK[rank];
  return `linear-gradient(to top right, ${tint} 0%, rgba(248, 250, 252, 0.96) 58%, rgba(241, 245, 249, 0.96) 100%)`;
}

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Zuletzt kürzlich aktiv";
  const date = new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) return "Zuletzt kürzlich aktiv";
  return `Zuletzt aktiv ${date.toLocaleString("de-DE")}`;
}

function StatCard({ title, value, ownValue }: { title: string; value: number; ownValue?: number | null }) {
  return (
    <div className="glass-panel rounded-xl p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-400">Du: {ownValue ?? "—"}</p>
    </div>
  );
}

export function MemberProfileDrawer({
  open,
  onClose,
  loading,
  error,
  profile,
  ownStats,
  aiModels,
  onOpenProfileImage,
}: MemberProfileDrawerProps) {
  const aiProvider = getAiProvider(profile?.clientId);
  const aiModel = aiProvider ? aiModels?.[aiProvider]?.trim() || "Modell wird geladen…" : "";
  const aiCopy = aiProvider ? AI_PROFILE_COPY[aiProvider] : null;
  const profileHeaderGradient = profileCardGradient(profile);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[75]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ease-out data-closed:opacity-0"
      />

      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
            <DialogPanel
              transition
              className="pointer-events-auto w-screen max-w-xl transform transition duration-400 ease-out data-closed:translate-x-full"
            >
              <div className="glass-panel-strong flex h-full flex-col overflow-y-auto [overscroll-behavior:contain]">
                <div className="flex items-start justify-between border-b border-slate-200 px-4 py-4 sm:px-6">
                  <DialogTitle className="text-base font-semibold text-slate-900">Profil</DialogTitle>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    aria-label="Profil schließen"
                  >
                    <XMarkIcon className="size-6" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex-1 space-y-4 px-4 py-5 sm:px-6">
                  {loading ? (
                    <div className="glass-panel rounded-xl p-3 animate-pulse">
                      <div className="h-4 w-32 rounded bg-slate-200/70" />
                      <div className="mt-3 h-16 rounded-xl bg-slate-200/70" />
                      <div className="mt-2 h-4 w-2/3 rounded bg-slate-200/70" />
                    </div>
                  ) : null}

                  {error ? (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
                  ) : null}

                  {!loading && !error && !profile ? (
                    <p className="glass-panel rounded-xl p-3 text-sm text-slate-600">Kein Profil verfügbar.</p>
                  ) : null}

                  {profile ? (
                    <>
                      <div
                        className="glass-panel rounded-2xl p-4"
                        style={profileHeaderGradient ? { backgroundImage: profileHeaderGradient } : undefined}
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              onOpenProfileImage?.(
                                profile.profilePicture,
                                `Profilbild von ${profile.username}`,
                              )}
                            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                            aria-label={`Profilbild von ${profile.username} in Vollbild öffnen`}
                          >
                            <img
                              src={profile.profilePicture}
                              alt={`Profilbild von ${profile.username}`}
                              className="h-28 w-28 rounded-full border border-slate-200 object-cover transition hover:opacity-90"
                              width={112}
                              height={112}
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                          <div className="min-w-0">
                            <p className="truncate text-2xl font-bold text-slate-900">{profile.username}</p>
                            <div className="mt-1 space-y-0.5">
                              <p className="text-sm text-slate-600">
                                {aiProvider ? aiModel : profile.isOnline ? "Online" : formatLastSeen(profile.lastSeenAt)}
                              </p>
                              <div>
                                {aiProvider ? (
                                  <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                    AI Assistant
                                  </span>
                                ) : (
                                  <MemberProgressInline member={profile.member} variant="list" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {aiProvider && aiCopy ? (
                        <div className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">KI-Profil</p>
                          <p className="text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Fähigkeiten:</span> {aiCopy.capabilities}
                          </p>
                          <p className="text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Stil & Ton:</span> {aiCopy.styleTone}
                          </p>
                          <p className="text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Info:</span> {aiCopy.info}
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <StatCard title="Posts" value={profile.stats.postsTotal} ownValue={ownStats?.postsTotal} />
                          <StatCard
                            title="Reaktionen erhalten"
                            value={profile.stats.reactionsReceived}
                            ownValue={ownStats?.reactionsReceived}
                          />
                          <StatCard
                            title="Reaktionen gegeben"
                            value={profile.stats.reactionsGiven}
                            ownValue={ownStats?.reactionsGiven}
                          />
                          <StatCard title="Umfragen erstellt" value={profile.stats.pollsCreated} ownValue={ownStats?.pollsCreated} />
                          <StatCard title="Umfrage-Stimmen" value={profile.stats.pollVotes} ownValue={ownStats?.pollVotes} />
                          <StatCard title="Aktive Tage" value={profile.stats.activeDays} ownValue={ownStats?.activeDays} />
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            </DialogPanel>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
