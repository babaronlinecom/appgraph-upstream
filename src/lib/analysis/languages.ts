/**
 * Language registry: every parser declares which languages and extensions it
 * understands. Adding a language means adding a definition here and a parser
 * that implements `LanguageParser` — pipeline control flow stays untouched.
 */
export type LanguageId = string;

export interface LanguageDefinition {
  id: LanguageId;
  label: string;
  extensions: string[];
}

export const LANGUAGES: LanguageDefinition[] = [
  { id: "typescript", label: "TypeScript", extensions: [".ts", ".tsx", ".mts", ".cts"] },
  { id: "javascript", label: "JavaScript", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
];

const LANGUAGE_BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]));
const LANGUAGE_BY_EXTENSION = new Map<string, LanguageDefinition>();
for (const language of LANGUAGES) {
  for (const extension of language.extensions) {
    LANGUAGE_BY_EXTENSION.set(extension, language);
  }
}

export function detectLanguage(path: string): LanguageId | null {
  const lower = path.toLowerCase();
  const index = lower.lastIndexOf(".");
  if (index < 0) return null;
  return LANGUAGE_BY_EXTENSION.get(lower.slice(index))?.id ?? null;
}

export function languageLabel(id: LanguageId): string {
  return LANGUAGE_BY_ID.get(id)?.label ?? id;
}

export function languageExtensions(id: LanguageId): string[] {
  return LANGUAGE_BY_ID.get(id)?.extensions ?? [];
}

export function knownLanguageIds(): LanguageId[] {
  return LANGUAGES.map((language) => language.id);
}
