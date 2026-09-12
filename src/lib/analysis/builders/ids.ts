/** Deterministic id helpers shared by graph projections. */
export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

export const FILE_NODE_PREFIX = "file:";

export function fileNodeId(path: string): string {
  return `${FILE_NODE_PREFIX}${path}`;
}
