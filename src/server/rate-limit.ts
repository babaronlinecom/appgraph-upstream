/**
 * Minimal in-memory sliding-window rate limiter.
 * Good enough for a single-node deployment; replace with a shared store when
 * running multiple instances.
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 2_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  pruneBuckets();
  return { allowed: true, remaining: limit - bucket.timestamps.length, retryAfterSeconds: 0 };
}

function pruneBuckets(): void {
  if (buckets.size <= MAX_BUCKETS) return;
  const entries = [...buckets.entries()].sort((a, b) => {
    const aLast = a[1].timestamps[a[1].timestamps.length - 1] ?? 0;
    const bLast = b[1].timestamps[b[1].timestamps.length - 1] ?? 0;
    return aLast - bLast;
  });
  while (buckets.size > MAX_BUCKETS && entries.length > 0) {
    const oldest = entries.shift();
    if (oldest) buckets.delete(oldest[0]);
  }
}

export function clientIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "local";
}
