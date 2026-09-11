"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Github, Sparkles } from "lucide-react";
import { AppGraphError } from "@/lib/github/errors";
import { parseGitHubUrl } from "@/lib/github/url";
import { cn } from "@/lib/utils/cn";

const EXAMPLES = [
  { repo: "leerob/next-saas-starter", label: "SaaS Starter", note: "Next.js · Prisma · Stripe" },
  { repo: "shadcn-ui/taxonomy", label: "Taxonomy", note: "Next.js · Auth.js · Prisma" },
  { repo: "vercel/ai-chatbot", label: "AI Chatbot", note: "Next.js · AI SDK · Postgres" },
];

export function LandingHero() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const generate = (raw?: string) => {
    const input = (raw ?? value).trim();
    if (!input) {
      setError("Paste a public GitHub repository URL to generate a graph.");
      return;
    }
    try {
      const parsed = parseGitHubUrl(input);
      setError(null);
      setSubmitting(true);
      router.push(`/github/${parsed.owner}/${parsed.repo}`);
    } catch (parseError) {
      setSubmitting(false);
      setError(parseError instanceof AppGraphError ? parseError.message : "That URL could not be parsed.");
    }
  };

  return (
    <section className="relative mx-auto w-full max-w-3xl px-6 pt-20 sm:pt-28">
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel/80 px-3 py-1 text-2xs text-ink-secondary">
          <Sparkles size={11} className="text-accent" aria-hidden />
          Public repositories · no GitHub login required
        </span>
      </div>

      <h1 className="mt-7 text-center text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-[52px]">
        See your software,
        <br />
        <span className="text-ink-secondary">not your folders.</span>
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-6 text-ink-secondary sm:text-[15px]">
        Paste a public GitHub repository. AppGraph turns the codebase into an interactive architecture
        map — pages, APIs, services, data stores and external dependencies.
      </p>

      <form
        className="mx-auto mt-8 w-full max-w-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          generate();
        }}
      >
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-panel p-1.5 pl-3.5 shadow-panel transition-colors duration-180",
            error ? "border-[rgba(229,100,95,0.55)]" : "border-line focus-within:border-[#3a4152]",
          )}
        >
          <Github size={16} className="shrink-0 text-ink-muted" aria-hidden />
          <input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            placeholder="https://github.com/owner/repository"
            className="h-9 w-full min-w-0 bg-transparent font-mono text-[13px] text-ink placeholder:text-ink-muted focus:outline-none"
            aria-label="Public GitHub repository URL"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={submitting}
            className="ag-button ag-button-primary h-9 shrink-0 px-4 text-[13px] disabled:opacity-80"
          >
            {submitting ? "Opening…" : "Generate graph"}
            <ArrowRight size={13} aria-hidden />
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-2xs text-ink-muted">
            Static analysis only — repository code is never executed. TypeScript, JavaScript, Next.js, React, Node.js.
          </p>
        )}
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <span className="text-2xs text-ink-muted">Try:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example.repo}
            type="button"
            onClick={() => {
              setValue(`https://github.com/${example.repo}`);
              generate(`https://github.com/${example.repo}`);
            }}
            className="group rounded-md border border-line bg-elevated px-2.5 py-1.5 text-left transition-colors duration-180 hover:border-line-strong"
          >
            <span className="block text-2xs font-medium text-ink">{example.label}</span>
            <span className="block font-mono text-2xs text-ink-muted group-hover:text-ink-secondary">
              {example.repo}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
