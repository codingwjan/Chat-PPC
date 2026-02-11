"use client";

import dynamic from "next/dynamic";

const ChatApp = dynamic(() => import("../../components/chat-app").then((module) => module.ChatApp), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">
      Loading session…
    </div>
  ),
});

export default function ChatPage() {
  return <ChatApp />;
}
