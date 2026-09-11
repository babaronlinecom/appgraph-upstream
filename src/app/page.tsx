import { Boxes, GitBranch, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { LandingHero } from "@/components/landing/LandingHero";
import { DemoGraphPreview } from "@/components/landing/DemoGraphPreview";

const FEATURES = [
  {
    icon: Boxes,
    title: "See the whole system",
    description:
      "Pages, API routes, services, data stores and external SDKs become connected entities — trace animated flows, analyze impact and replay architecture tours.",
  },
  {
    icon: GitBranch,
    title: "Framework-aware",
    description:
      "Next.js App Router and Pages Router, React and Node.js are detected automatically, including routes, layouts and internal API calls.",
  },
  {
    icon: ShieldCheck,
    title: "Static and safe",
    description:
      "Deterministic AST analysis. Repository code is never executed, installed or written to disk.",
  },
];

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-x-hidden pb-16">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(ellipse_at_top,rgba(124,140,248,0.09),transparent_62%)]" />

      <header className="relative z-10 mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Logo />
        <span className="hidden text-2xs text-ink-muted sm:inline">
          GitHub architecture intelligence
        </span>
      </header>

      <LandingHero />
      <DemoGraphPreview />

      <section className="mx-auto mt-20 grid w-full max-w-6xl grid-cols-1 gap-4 px-6 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-line bg-panel p-4">
            <feature.icon size={15} className="text-accent" aria-hidden />
            <h2 className="mt-3 text-sm font-semibold text-ink">{feature.title}</h2>
            <p className="mt-1.5 text-xs leading-5 text-ink-secondary">{feature.description}</p>
          </div>
        ))}
      </section>

      <footer className="mx-auto mt-20 flex w-full max-w-6xl items-center justify-between px-6 text-2xs text-ink-muted">
        <span>AppGraph · MVP</span>
        <span>Public repositories only · rate limits apply</span>
      </footer>
    </main>
  );
}
