"use client";

export function Toast({ message, toastKey }: { message?: string; toastKey?: number }) {
  if (!message) return null;
  return (
    <div
      key={toastKey}
      className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 animate-slide-up rounded-md border border-line-strong bg-elevated px-3 py-1.5 text-xs text-ink shadow-float"
      role="status"
    >
      {message}
    </div>
  );
}
