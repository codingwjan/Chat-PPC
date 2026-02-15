import {
  BoltIcon,
  HandThumbUpIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

const WHATS_NEW_ITEMS = [
  {
    title: "User Accounts",
    subtitle: "Ein eigener Account pro Person statt Shared-Login.",
    Icon: ShieldCheckIcon,
    accent: "from-sky-500/20 via-cyan-400/10 to-white",
  },
  {
    title: "User Reactions",
    subtitle: "Reagiere schneller direkt im Chat auf Nachrichten.",
    Icon: HandThumbUpIcon,
    accent: "from-amber-400/20 via-orange-300/10 to-white",
  },
  {
    title: "AI ist schneller geworden",
    subtitle: "Antworten kommen spürbar direkter und flüssiger.",
    Icon: BoltIcon,
    accent: "from-fuchsia-400/15 via-violet-300/10 to-white",
  },
] as const;

export function AuthWhatsNewPanel() {
  return (
    <aside className="rounded-3xl border border-white/75 bg-white/65 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-8 lg:min-h-[560px] lg:p-10">
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
        What&apos;s New
      </div>

      <h1 className="mt-6 text-[clamp(1.6rem,2.8vw,2.35rem)] font-semibold leading-tight text-slate-900">
        Alles neu, aber in 2 Minuten startklar.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-600 sm:text-base">
        Ein kurzer Setup-Flow und danach bleibst du wie gewohnt direkt im Chat.
      </p>

      <ul className="mt-8 space-y-3">
        {WHATS_NEW_ITEMS.map(({ title, subtitle, Icon, accent }) => (
          <li key={title} className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${accent} p-4 shadow-[0_14px_40px_rgba(15,23,42,0.08)]`}>
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200/80 bg-white/90 text-slate-700">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{subtitle}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
