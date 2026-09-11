import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Tiny filesystem-backed JSON cache used for GitHub metadata and graph
 * documents. No Redis required: the cache is optional and always degradable.
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
  storedAt: number;
}

const memory = new Map<string, CacheEntry>();
const MEMORY_LIMIT = 256;

export function getCacheDir(): string {
  return process.env.APPGRAPH_CACHE_DIR?.trim() || path.join(process.cwd(), ".appgraph-cache");
}

function cacheFilePath(namespace: string, key: string): string {
  const safeKey = key
    .split(":")
    .map((part) => encodeURIComponent(part))
    .join("__")
    .replace(/[^A-Za-z0-9._%-]/g, "_");
  const digest = createHash("sha1").update(safeKey).digest("hex").slice(0, 8);
  const readable = safeKey.slice(0, 120);
  return path.join(getCacheDir(), namespace, `${readable}-${digest}.json`);
}

function memoryKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

function setMemory(namespace: string, key: string, entry: CacheEntry): void {
  if (memory.size >= MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  memory.set(memoryKey(namespace, key), entry);
}

async function readEntry(namespace: string, key: string): Promise<CacheEntry | null> {
  const cached = memory.get(memoryKey(namespace, key));
  if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) {
    return cached;
  }
  try {
    const raw = await fs.readFile(cacheFilePath(namespace, key), "utf8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.expiresAt !== null && parsed.expiresAt <= Date.now()) {
      return null;
    }
    setMemory(namespace, key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function readCache<T>(namespace: string, key: string): Promise<T | null> {
  const entry = await readEntry(namespace, key);
  return entry ? (entry.value as T) : null;
}

export async function readCacheWithTtl<T>(
  namespace: string,
  key: string,
  ttlMs: number,
): Promise<T | null> {
  const entry = await readEntry(namespace, key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > ttlMs) return null;
  return entry.value as T;
}

export async function writeCache<T>(
  namespace: string,
  key: string,
  value: T,
  options: { ttlMs?: number } = {},
): Promise<void> {
  const storedAt = Date.now();
  const expiresAt = options.ttlMs ? storedAt + options.ttlMs : null;
  setMemory(namespace, key, { value, expiresAt, storedAt });
  try {
    const file = cacheFilePath(namespace, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ value, storedAt, expiresAt }), "utf8");
  } catch {
    // Cache is best-effort: never fail an analysis because the disk is read-only.
  }
}

export function clearMemoryCache(): void {
  memory.clear();
}
