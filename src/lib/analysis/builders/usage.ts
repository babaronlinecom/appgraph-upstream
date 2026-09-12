import type { DatabaseOperation } from "../integrations";
import { classifyDatabaseOperation } from "../integrations";
import type { ParsedFile } from "../types";

/** Which imported local names are actually used in JSX or in calls. */
export function localUsage(
  parsed: ParsedFile,
  localNames: string[],
): { usedInJsx: boolean; jsxTag?: ParsedFile["jsxTags"][number]; calls: ParsedFile["calls"] } {
  const jsxTag = parsed.jsxTags.find((tag) =>
    localNames.some((name) => tag.name === name || tag.name.startsWith(`${name}.`)),
  );
  const calls = parsed.calls.filter((call) =>
    localNames.some((name) => call.name === name || call.name.startsWith(`${name}.`)),
  );
  return { usedInJsx: Boolean(jsxTag), jsxTag, calls };
}

export interface DatabaseAggregate {
  hasRead: boolean;
  hasWrite: boolean;
  unknown: boolean;
  count: number;
  readCall?: ParsedFile["calls"][number];
  writeCall?: ParsedFile["calls"][number];
}

export function aggregateOperations(calls: ParsedFile["calls"]): DatabaseAggregate {
  const aggregate: DatabaseAggregate = {
    hasRead: false,
    hasWrite: false,
    unknown: false,
    count: calls.length,
  };
  for (const call of calls) {
    const operation: DatabaseOperation = classifyDatabaseOperation(call.name);
    if (operation === "read") {
      aggregate.hasRead = true;
      aggregate.readCall ??= call;
    } else if (operation === "write") {
      aggregate.hasWrite = true;
      aggregate.writeCall ??= call;
    } else {
      aggregate.unknown = true;
    }
  }
  return aggregate;
}
