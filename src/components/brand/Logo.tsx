import Link from "next/link";

export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#12151a" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" stroke="#2b2f37" />
      <path d="M9 21.5V10.5" stroke="#7c8cf8" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 21.5V10.5" stroke="#57c99b" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M23 21.5V10.5" stroke="#e29a5c" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 15.5H23" stroke="#3a4152" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 18.5H16" stroke="#3a4152" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="9" cy="10.5" r="1.7" fill="#7c8cf8" />
      <circle cx="16" cy="10.5" r="1.7" fill="#57c99b" />
      <circle cx="23" cy="10.5" r="1.7" fill="#e29a5c" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-elevated" aria-label="AppGraph home">
      <LogoMark />
      {compact ? null : (
        <span className="text-sm font-semibold tracking-tight text-ink">AppGraph</span>
      )}
    </Link>
  );
}
