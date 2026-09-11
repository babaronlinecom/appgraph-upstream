import type { LanguageParser } from "./contract";
import { typescriptLanguageParser } from "./typescript-parser";

/**
 * Parser registry: resolves a file path to a parser by extension. Multiple
 * parsers may claim the same extension; the first registered wins, which keeps
 * lookup deterministic.
 */
export class ParserRegistry {
  private readonly parsers: LanguageParser[] = [];
  private readonly byExtension = new Map<string, LanguageParser>();

  register(parser: LanguageParser): void {
    if (this.parsers.some((existing) => existing.id === parser.id)) {
      throw new Error(`Parser "${parser.id}" is already registered`);
    }
    this.parsers.push(parser);
    for (const extension of parser.capabilities.extensions) {
      const key = extension.toLowerCase();
      if (!this.byExtension.has(key)) this.byExtension.set(key, parser);
    }
  }

  list(): LanguageParser[] {
    return [...this.parsers];
  }

  get(id: string): LanguageParser | undefined {
    return this.parsers.find((parser) => parser.id === id);
  }

  /** Returns the parser that can handle this path, or null when unsupported. */
  getForPath(path: string): LanguageParser | null {
    const lower = path.toLowerCase();
    const index = lower.lastIndexOf(".");
    if (index < 0) return null;
    return this.byExtension.get(lower.slice(index)) ?? null;
  }

  supports(path: string): boolean {
    return this.getForPath(path) !== null;
  }

  /** Registered language ids across all parsers (capabilities reporting). */
  languages(): string[] {
    const languages = new Set<string>();
    for (const parser of this.parsers) {
      for (const language of parser.capabilities.languages) languages.add(language);
    }
    return [...languages].sort();
  }
}

export const parserRegistry = new ParserRegistry();

let builtinsRegistered = false;

export function registerBuiltinParsers(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  parserRegistry.register(typescriptLanguageParser);
}

registerBuiltinParsers();
