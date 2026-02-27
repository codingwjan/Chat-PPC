"use client";
/* eslint-disable @next/next/no-img-element */

import { Dialog, DialogBackdrop, DialogPanel, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  InformationCircleIcon,
  PhotoIcon,
  SwatchIcon,
  UserCircleIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/20/solid";
import { memo, type ReactNode } from "react";
import { MemberProgressInline } from "@/components/member-progress-inline";
import type { MemberProgressDTO } from "@/lib/types";

interface ChatShellSidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  username: string;
  profilePicture: string;
  member?: MemberProgressDTO;
  memberHighlight?: boolean;
  onOpenProfileEditor: () => void;
  onOpenDevMenu?: () => void;
  onOpenBots: () => void;
  onOpenSharedBackground: () => void;
  onOpenMedia: () => void;
  onOpenPointsInfo: () => void;
  onlineUsersContent: ReactNode;
}

const PROFILE_CARD_TINT_BY_RANK: Record<NonNullable<MemberProgressDTO["rank"]>, string> = {
  BRONZE: "rgba(180, 83, 9, 0.28)",
  SILBER: "rgba(100, 116, 139, 0.24)",
  GOLD: "rgba(161, 98, 7, 0.28)",
  PLATIN: "rgba(14, 116, 144, 0.24)",
  DIAMANT: "rgba(37, 99, 235, 0.24)",
  ONYX: "rgba(63, 63, 70, 0.24)",
  TITAN: "rgba(124, 58, 237, 0.24)",
};

function profileCardGradient(member?: MemberProgressDTO): string | undefined {
  if (!member) return undefined;
  const tint = PROFILE_CARD_TINT_BY_RANK[member.rank];
  return `linear-gradient(to top right, ${tint} 0%, rgba(248, 250, 252, 0.96) 58%, rgba(241, 245, 249, 0.96) 100%)`;
}

function SidebarActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            onClick();
          }, 0);
          return;
        }
        onClick();
      }}
      className="glass-panel flex h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SidebarBody({
  username,
  profilePicture,
  member,
  memberHighlight,
  onOpenProfileEditor,
  onOpenDevMenu,
  onOpenBots,
  onOpenSharedBackground,
  onOpenMedia,
  onOpenPointsInfo,
  onlineUsersContent,
}: Omit<ChatShellSidebarProps, "mobileOpen" | "onCloseMobile">) {
  const profileButtonGradient = profileCardGradient(member);

  return (
    <div className="glass-panel-strong flex h-full min-h-0 flex-col rounded-r-2xl border-r px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] lg:py-4">
      <div className="pb-3">
        <p className="text-lg font-semibold text-slate-900">ChatPPC</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Users</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <div className="space-y-2">{onlineUsersContent}</div>
      </div>

      <div className="mt-3 space-y-2">
        {onOpenDevMenu ? (
          <SidebarActionButton
            label="Dev Menu"
            onClick={onOpenDevMenu}
            icon={<WrenchScrewdriverIcon className="size-4 text-slate-500" aria-hidden="true" />}
          />
        ) : null}
        <SidebarActionButton
          label="Meine Bots"
          onClick={onOpenBots}
          icon={<UserCircleIcon className="size-4 text-slate-500" aria-hidden="true" />}
        />
        <SidebarActionButton
          label="Medien"
          onClick={onOpenMedia}
          icon={<PhotoIcon className="size-4 text-slate-500" aria-hidden="true" />}
        />
        <SidebarActionButton
          label="Geteilter Chat-Hintergrund"
          onClick={onOpenSharedBackground}
          icon={<SwatchIcon className="size-4 text-slate-500" aria-hidden="true" />}
        />
        <SidebarActionButton
          label="Wie bekomme ich Punkte?"
          onClick={onOpenPointsInfo}
          icon={<InformationCircleIcon className="size-4 text-slate-500" aria-hidden="true" />}
        />
      </div>

      <button
        type="button"
        onClick={onOpenProfileEditor}
        data-testid="open-profile-editor"
        className={`glass-panel mt-2 flex items-center gap-3 rounded-xl p-3 text-left transition-[filter,background-color] hover:brightness-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${memberHighlight ? "ppc-score-sidebar-pop" : ""}`}
        aria-label="Eigenes Profil öffnen"
        style={profileButtonGradient ? { backgroundImage: profileButtonGradient } : undefined}
      >
        <img
          src={profilePicture}
          alt={`${username} avatar`}
          className="h-12 w-12 shrink-0 rounded-full border border-slate-200 object-cover [aspect-ratio:1/1]"
          loading="lazy"
          decoding="async"
          width={48}
          height={48}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{username}</p>
          <div className="mt-0.5">
            <MemberProgressInline member={member} variant="sidebar" highlight={memberHighlight} />
          </div>
        </div>
      </button>
    </div>
  );
}

export const ChatShellSidebar = memo(function ChatShellSidebar({
  mobileOpen,
  onCloseMobile,
  username,
  profilePicture,
  member,
  memberHighlight,
  onOpenProfileEditor,
  onOpenDevMenu,
  onOpenBots,
  onOpenSharedBackground,
  onOpenMedia,
  onOpenPointsInfo,
  onlineUsersContent,
}: ChatShellSidebarProps) {
  return (
    <>
      <Dialog open={mobileOpen} onClose={onCloseMobile} className="relative z-50 lg:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-slate-900/70 transition-opacity duration-300 ease-linear data-closed:opacity-0"
        />

        <div className="fixed inset-0 flex">
          <DialogPanel
            transition
            className="relative flex h-full w-[min(88vw,22rem)] max-w-[22rem] transform transition duration-300 ease-in-out data-closed:-translate-x-full"
          >
            <TransitionChild>
              <div className="absolute top-[calc(env(safe-area-inset-top)+0.25rem)] left-full flex w-12 justify-center duration-300 ease-in-out data-closed:opacity-0">
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="-m-2.5 p-2.5"
                  aria-label="Sidebar schließen"
                >
                  <span className="sr-only">Sidebar schließen</span>
                  <XMarkIcon aria-hidden="true" className="size-6 text-white" />
                </button>
              </div>
            </TransitionChild>

            <div className="w-full">
              <SidebarBody
                username={username}
                profilePicture={profilePicture}
                member={member}
                memberHighlight={memberHighlight}
                onOpenProfileEditor={onOpenProfileEditor}
                onOpenDevMenu={onOpenDevMenu}
                onOpenBots={onOpenBots}
                onOpenSharedBackground={onOpenSharedBackground}
                onOpenMedia={onOpenMedia}
                onOpenPointsInfo={onOpenPointsInfo}
                onlineUsersContent={onlineUsersContent}
              />
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-72 lg:flex-col">
        <SidebarBody
          username={username}
          profilePicture={profilePicture}
          member={member}
          memberHighlight={memberHighlight}
          onOpenProfileEditor={onOpenProfileEditor}
          onOpenDevMenu={onOpenDevMenu}
          onOpenBots={onOpenBots}
          onOpenSharedBackground={onOpenSharedBackground}
          onOpenMedia={onOpenMedia}
          onOpenPointsInfo={onOpenPointsInfo}
          onlineUsersContent={onlineUsersContent}
        />
      </aside>
    </>
  );
});
