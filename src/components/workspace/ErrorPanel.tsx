"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import type { UserFacingError } from "@/lib/github/errors";

export function ErrorPanel({ error, onRetry }: { error: UserFacingError; onRetry: () => void }) {
  return (
    <section className="w-full max-w-[480px] animate-slide-up rounded-xl border border-line bg-panel p-5 shadow-panel">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[rgba(229,100,95,0.35)] bg-[rgba(229,100,95,0.08)]">
          <AlertTriangle size={15} className="text-danger" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-ink">{error.title}</h1>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">{error.message}</p>
          {error.hint ? <p className="mt-2 text-xs leading-5 text-ink-muted">{error.hint}</p> : null}
          {error.retryAfterSeconds ? (
            <p className="mt-2 font-mono text-2xs text-ink-muted">
              Retry after ~{error.retryAfterSeconds}s
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {error.retryable ? (
          <button type="button" className="ag-button ag-button-primary" onClick={onRetry}>
            <RefreshCw size={12} aria-hidden />
            Try again
          </button>
        ) : null}
        <Link href="/" className="ag-button">
          <ArrowLeft size={12} aria-hidden />
          Analyze another repository
        </Link>
      </div>
    </section>
  );
}
