"use client";
/* eslint-disable @next/next/no-img-element */

import { Dialog, DialogBackdrop, DialogPanel, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { InformationCircleIcon, PhotoIcon, SwatchIcon } from "@heroicons/react/20/solid";
import { type ReactNode } from "react";
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
  onOpenSharedBackground: () => void;
  onOpenMedia: () => void;
  onOpenPointsInfo: () => void;
  onlineUsersContent: ReactNode;
  developerContent?: ReactNode;
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
      onClick={onClick}
      className="flex h-11 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
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
  onOpenSharedBackground,
  onOpenMedia,
  onOpenPointsInfo,
  onlineUsersContent,
  developerContent,
}: Omit<ChatShellSidebarProps, "mobileOpen" | "onCloseMobile">) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white/90 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] lg:py-4">
      <div className="pb-3">
        <p className="text-lg font-semibold text-slate-900">ChatPPC</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Users</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <div className="space-y-2">{onlineUsersContent}</div>
      </div>

      {developerContent ? <div className="mt-3">{developerContent}</div> : null}

      <div className="mt-3 space-y-2">
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
        className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        aria-label="Eigenes Profil öffnen"
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

export function ChatShellSidebar({
  mobileOpen,
  onCloseMobile,
  username,
  profilePicture,
  member,
  memberHighlight,
  onOpenProfileEditor,
  onOpenSharedBackground,
  onOpenMedia,
  onOpenPointsInfo,
  onlineUsersContent,
  developerContent,
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
                onOpenSharedBackground={onOpenSharedBackground}
                onOpenMedia={onOpenMedia}
                onOpenPointsInfo={onOpenPointsInfo}
                onlineUsersContent={onlineUsersContent}
                developerContent={developerContent}
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
          onOpenSharedBackground={onOpenSharedBackground}
          onOpenMedia={onOpenMedia}
          onOpenPointsInfo={onOpenPointsInfo}
          onlineUsersContent={onlineUsersContent}
          developerContent={developerContent}
        />
      </aside>
    </>
  );
}
