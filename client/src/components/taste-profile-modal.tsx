"use client";

import { useMemo, useState } from "react";
import { memberRankLabel, PPC_MEMBER_POINT_RULES } from "@/lib/member-progress";
import type { ReactionType, TasteProfileDetailedDTO, TasteProfileEventDTO, TasteWindowKey } from "@/lib/types";

interface TasteProfileModalProps {
  open: boolean;
  onClose: () => void;
  subjectLabel?: string;
  profile: TasteProfileDetailedDTO | null;
  events: TasteProfileEventDTO[];
  selectedWindow: TasteWindowKey;
  onWindowChange: (window: TasteWindowKey) => void;
  loadingProfile: boolean;
  loadingEvents: boolean;
  loadingMoreEvents: boolean;
  hasMoreEvents: boolean;
  onLoadMoreEvents: () => void;
  error?: string | null;
}

type TasteTabKey = "overview" | "interests" | "activity" | "ppcPoints" | "raw";

const REACTION_LABELS: Record<ReactionType, string> = {
  LIKE: "❤️ Like",
  LOL: "😂 LOL",
  FIRE: "🔥 FIRE",
  BASED: "🫡 BASED",
  WTF: "💀 WTF",
  BIG_BRAIN: "🧠 BIG BRAIN",
};

const EVENT_TYPE_LABELS: Record<TasteProfileEventDTO["type"], string> = {
  MESSAGE_CREATED: "Nachricht erstellt",
  USERNAME_CHANGED: "Anzeigename geändert",
  MESSAGE_TAGGING_COMPLETED: "Tagging abgeschlossen",
  MESSAGE_TAGGING_FAILED: "Tagging fehlgeschlagen",
  REACTION_GIVEN: "Reaktion gegeben",
  REACTION_RECEIVED: "Reaktion erhalten",
  POLL_CREATED: "Umfrage erstellt",
  POLL_EXTENDED: "Umfrage erweitert",
  POLL_VOTE_GIVEN: "Bei Umfrage abgestimmt",
  AI_MENTION_SENT: "KI erwähnt",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unbekannt";
  return date.toLocaleString("de-DE");
}

function StatCard(props: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.title}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{props.value}</p>
      {props.hint ? <p className="mt-1 text-xs text-slate-500">{props.hint}</p> : null}
    </div>
  );
}

function TagCloud(props: { title: string; tags: Array<{ tag: string; score: number }>; emptyText: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.title}</p>
      {props.tags.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{props.emptyText}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {props.tags.map((entry) => (
            <span
              key={`${props.title}-${entry.tag}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
            >
              <span>{entry.tag}</span>
              <span className="text-[10px] text-slate-500">{Math.round(entry.score * 100)}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TasteProfileModal(props: TasteProfileModalProps) {
  const [tab, setTab] = useState<TasteTabKey>("overview");

  const selectedWindow = props.profile?.windows[props.selectedWindow];
  const member = props.profile?.member;
  const memberBreakdown = props.profile?.memberBreakdown;
  const tabs: Array<{ key: TasteTabKey; label: string }> = useMemo(
    () => [
      { key: "overview", label: "Übersicht" },
      { key: "interests", label: "Interessen" },
      { key: "activity", label: "Aktivität" },
      { key: "ppcPoints", label: "PPC Punkte" },
      { key: "raw", label: "Rohdaten" },
    ],
    [],
  );

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[72] grid place-items-center bg-slate-900/50 p-3 sm:p-4" onClick={props.onClose}>
      <div
        className="flex h-[min(92vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Taste Profile & Stats"
      >
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Taste Profile & Stats{props.subjectLabel ? ` · ${props.subjectLabel}` : ""}
              </h2>
              <p className="text-xs text-slate-500">
                Hier siehst du klar, welche Daten wir über {props.subjectLabel || "dich"} sammeln.
              </p>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Schließen
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => props.onWindowChange("7d")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  props.selectedWindow === "7d" ? "bg-sky-100 text-sky-700" : "text-slate-600"
                }`}
              >
                7 Tage
              </button>
              <button
                type="button"
                onClick={() => props.onWindowChange("30d")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  props.selectedWindow === "30d" ? "bg-sky-100 text-sky-700" : "text-slate-600"
                }`}
              >
                30 Tage
              </button>
              <button
                type="button"
                onClick={() => props.onWindowChange("all")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  props.selectedWindow === "all" ? "bg-sky-100 text-sky-700" : "text-slate-600"
                }`}
              >
                Gesamt
              </button>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              {tabs.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setTab(entry.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tab === entry.key
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-5">
          {props.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{props.error}</div>
          ) : null}

          {props.loadingProfile && !props.profile ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              Profil-Daten werden geladen…
            </div>
          ) : null}

          {!props.loadingProfile && !props.profile ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              Keine Profil-Daten verfügbar.
            </div>
          ) : null}

          {selectedWindow ? (
            <div className="space-y-3">
              {tab === "overview" ? (
                <>
                  {member ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <StatCard title="PPC Score" value={member.score} />
                      <StatCard title="Rank" value={memberRankLabel(member.rank)} />
                      <StatCard
                        title="Bis nächster Rank"
                        value={member.pointsToNext ?? 0}
                        hint={member.nextRank ? memberRankLabel(member.nextRank) : "Max Rank erreicht"}
                      />
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Reaktionen gegeben" value={selectedWindow.reactions.givenTotal} />
                    <StatCard title="Reaktionen erhalten" value={selectedWindow.reactions.receivedTotal} />
                    <StatCard title="Beiträge" value={selectedWindow.activity.postsTotal} />
                    <StatCard
                      title="Tagging-Abdeckung"
                      value={`${Math.round(selectedWindow.activity.tagging.coverage * 100)}%`}
                      hint={`${selectedWindow.activity.tagging.completed} fertig, ${selectedWindow.activity.tagging.failed} fehlgeschlagen`}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {memberBreakdown ? (
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PPC Score Breakdown</p>
                        <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                          <p>Nachrichten erstellt: <span className="font-semibold">{memberBreakdown.messagesCreated}</span></p>
                          <p>Reaktionen gegeben: <span className="font-semibold">{memberBreakdown.reactionsGiven}</span></p>
                          <p>Reaktionen erhalten: <span className="font-semibold">{memberBreakdown.reactionsReceived}</span></p>
                          <p>KI-Mentions: <span className="font-semibold">{memberBreakdown.aiMentions}</span></p>
                          <p>Umfragen erstellt: <span className="font-semibold">{memberBreakdown.pollsCreated}</span></p>
                          <p>Umfragen erweitert: <span className="font-semibold">{memberBreakdown.pollsExtended}</span></p>
                          <p>Umfrage-Stimmen: <span className="font-semibold">{memberBreakdown.pollVotes}</span></p>
                          <p>Tagging abgeschlossen: <span className="font-semibold">{memberBreakdown.taggingCompleted}</span></p>
                          <p>Anzeigename geändert: <span className="font-semibold">{memberBreakdown.usernameChanges}</span></p>
                          <p>Rohscore: <span className="font-semibold">{memberBreakdown.rawScore}</span></p>
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reaktionen gegeben</p>
                      <div className="mt-2 space-y-1.5">
                        {selectedWindow.reactions.givenByType.map((entry) => (
                          <p key={`given-${entry.reaction}`} className="text-xs text-slate-700">
                            {REACTION_LABELS[entry.reaction]}: <span className="font-semibold">{entry.count}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reaktionen erhalten</p>
                      <div className="mt-2 space-y-1.5">
                        {selectedWindow.reactions.receivedByType.map((entry) => (
                          <p key={`received-${entry.reaction}`} className="text-xs text-slate-700">
                            {REACTION_LABELS[entry.reaction]}: <span className="font-semibold">{entry.count}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {tab === "interests" ? (
                <>
                  <TagCloud title="Top-Tags" tags={selectedWindow.interests.topTags.slice(0, 80)} emptyText="Noch keine Top-Tags." />
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <TagCloud
                      title="Kategorien Nachricht: Themen"
                      tags={selectedWindow.interests.topMessageCategories.themes.slice(0, 8)}
                      emptyText="Keine Themen vorhanden."
                    />
                    <TagCloud
                      title="Kategorien Nachricht: Humor"
                      tags={selectedWindow.interests.topMessageCategories.humor.slice(0, 8)}
                      emptyText="Kein Humor-Profil vorhanden."
                    />
                    <TagCloud
                      title="Kategorien Nachricht: Art"
                      tags={selectedWindow.interests.topMessageCategories.art.slice(0, 8)}
                      emptyText="Keine Art-Tags vorhanden."
                    />
                    <TagCloud
                      title="Kategorien Nachricht: Tone"
                      tags={selectedWindow.interests.topMessageCategories.tone.slice(0, 8)}
                      emptyText="Keine Tone-Tags vorhanden."
                    />
                    <TagCloud
                      title="Kategorien Nachricht: Topics"
                      tags={selectedWindow.interests.topMessageCategories.topics.slice(0, 8)}
                      emptyText="Keine Topics vorhanden."
                    />
                    <TagCloud
                      title="Kategorien Bild: Objects"
                      tags={selectedWindow.interests.topImageCategories.objects.slice(0, 8)}
                      emptyText="Keine Object-Tags vorhanden."
                    />
                  </div>
                </>
              ) : null}

              {tab === "activity" ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Aktive Tage" value={selectedWindow.activity.activeDays} />
                    <StatCard title="Beiträge mit Bild" value={selectedWindow.activity.postsWithImages} />
                    <StatCard title="Umfragen erstellt" value={selectedWindow.activity.pollsCreated} />
                    <StatCard title="Umfragen erweitert" value={selectedWindow.activity.pollsExtended} />
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Beiträge nach Typ</p>
                      <div className="mt-2 space-y-1">
                        {selectedWindow.activity.postsByType.map((entry) => (
                          <p key={`post-type-${entry.type}`} className="text-xs text-slate-700">
                            {entry.type}: <span className="font-semibold">{entry.count}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">KI-Mentions</p>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-slate-700">
                          @chatgpt: <span className="font-semibold">{selectedWindow.activity.aiMentions.chatgpt}</span>
                        </p>
                        <p className="text-xs text-slate-700">
                          @grok: <span className="font-semibold">{selectedWindow.activity.aiMentions.grok}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top Interaktionen</p>
                    {selectedWindow.social.topInteractedUsers.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">Noch keine Interaktionen vorhanden.</p>
                    ) : (
                      <div className="mt-2 space-y-1.5">
                        {selectedWindow.social.topInteractedUsers.slice(0, 20).map((entry) => (
                          <p key={`social-${entry.userId}`} className="text-xs text-slate-700">
                            {entry.username}: gegeben {entry.given}, erhalten {entry.received}, gesamt {entry.total}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {tab === "ppcPoints" ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PPC Score Punkte pro Aktion</p>
                  <div className="mt-3 space-y-2">
                    {PPC_MEMBER_POINT_RULES.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <p className="text-sm text-slate-700">{rule.label}</p>
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          +{rule.points}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Der sichtbare PPC Score nutzt zusätzlich Inaktivitäts-Decay (Halbwertszeit 45 Tage).
                  </p>
                </div>
              ) : null}

              {tab === "raw" ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rohdaten-Events</p>
                  {props.loadingEvents && props.events.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">Events werden geladen…</p>
                  ) : null}
                  {!props.loadingEvents && props.events.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">Noch keine Rohdaten vorhanden.</p>
                  ) : null}
                  {props.events.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {props.events.map((event) => (
                        <div key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-800">{EVENT_TYPE_LABELS[event.type]}</p>
                            <p className="text-[10px] text-slate-500">{formatDate(event.createdAt)}</p>
                          </div>
                          {event.reaction ? (
                            <p className="mt-1 text-xs text-slate-600">Reaktion: {REACTION_LABELS[event.reaction]}</p>
                          ) : null}
                          {event.relatedUsername ? (
                            <p className="mt-1 text-xs text-slate-600">Bezug: {event.relatedUsername}</p>
                          ) : null}
                          {event.preview ? (
                            <p className="mt-1 text-xs text-slate-600">Preview: {event.preview}</p>
                          ) : null}
                          {event.messageId ? (
                            <p className="mt-1 text-[10px] text-slate-500">Nachrichten-ID: {event.messageId}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {props.hasMoreEvents ? (
                    <button
                      type="button"
                      onClick={props.onLoadMoreEvents}
                      disabled={props.loadingMoreEvents}
                      className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      {props.loadingMoreEvents ? "Wird geladen…" : "Mehr laden"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {props.profile ? (
          <div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diese Daten sammeln wir aktuell</p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {props.profile.transparency.sources.map((entry) => (
                <li key={entry}>• {entry}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">
              Rohdaten-Aufbewahrung: {props.profile.transparency.eventRetentionDays} Tage
              {props.profile.transparency.rawEventsAvailableSince
                ? ` • verfügbar seit ${formatDate(props.profile.transparency.rawEventsAvailableSince)}`
                : ""}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
