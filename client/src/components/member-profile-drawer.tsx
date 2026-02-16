"use client";
/* eslint-disable @next/next/no-img-element */

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { MemberProgressInline } from "@/components/member-progress-inline";
import type { PublicUserProfileDTO } from "@/lib/types";

interface MemberProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error?: string | null;
  profile: PublicUserProfileDTO | null;
  onOpenProfileImage?: (url: string, alt: string) => void;
}

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Zuletzt kürzlich aktiv";
  const date = new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) return "Zuletzt kürzlich aktiv";
  return `Zuletzt aktiv ${date.toLocaleString("de-DE")}`;
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

export function MemberProfileDrawer({
  open,
  onClose,
  loading,
  error,
  profile,
  onOpenProfileImage,
}: MemberProfileDrawerProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[75]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-slate-900/55 transition-opacity duration-300 ease-out data-closed:opacity-0"
      />

      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
            <DialogPanel
              transition
              className="pointer-events-auto w-screen max-w-xl transform transition duration-400 ease-out data-closed:translate-x-full"
            >
              <div className="flex h-full flex-col overflow-y-auto bg-white shadow-xl [overscroll-behavior:contain]">
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
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Profil wird geladen…</p>
                  ) : null}

                  {error ? (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
                  ) : null}

                  {!loading && !error && !profile ? (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Kein Profil verfügbar.</p>
                  ) : null}

                  {profile ? (
                    <>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
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
                                {profile.isOnline ? "Online" : formatLastSeen(profile.lastSeenAt)}
                              </p>
                              <div>
                                <MemberProgressInline member={profile.member} variant="list" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <StatCard title="Posts" value={profile.stats.postsTotal} />
                        <StatCard title="Reaktionen erhalten" value={profile.stats.reactionsReceived} />
                        <StatCard title="Reaktionen gegeben" value={profile.stats.reactionsGiven} />
                        <StatCard title="Umfragen erstellt" value={profile.stats.pollsCreated} />
                        <StatCard title="Umfrage-Stimmen" value={profile.stats.pollVotes} />
                        <StatCard title="Aktive Tage" value={profile.stats.activeDays} />
                      </div>
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
