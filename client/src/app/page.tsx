import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative flex h-[100dvh] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_18%_10%,_#e0f2fe_0%,_#f8fafc_40%,_#e2e8f0_100%)] px-4">
      <div className="absolute -left-20 -top-12 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="absolute -bottom-16 right-0 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />

      <section className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/70 bg-white/80 p-8 shadow-2xl backdrop-blur sm:p-12">
        <p className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">
          2026 Class Chat
        </p>
        <h1 className="mt-4 text-4xl font-bold leading-tight text-slate-900 text-balance sm:text-5xl">
          Learn, Vote, Challenge, and Chat Together
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-slate-600 sm:text-base">
          A fun classroom chat with smart `@chatgpt` help, rich polls (up to 15 options), questions, and
          challenge posts in one fast realtime app.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Start Chatting
          </Link>
          <Link
            href="/chat"
            className="inline-flex h-11 items-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Rejoin Session
          </Link>
        </div>
      </section>
    </main>
  );
}
