import { detectLanguage } from "../languages";
import { parseSource } from "./ts-parser";
import type { LanguageParser, ParseInput, ParseResult } from "./contract";

/**
 * TypeScript/JavaScript parser adapter. Wraps the TypeScript compiler AST
 * implementation behind the language-agnostic `LanguageParser` contract.
 */
export const typescriptLanguageParser: LanguageParser = {
  id: "typescript-ast",
  version: "1.0.0",
  label: "TypeScript / JavaScript (compiler AST)",
  capabilities: {
    languages: ["typescript", "javascript"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    symbolKinds: [
      "function",
      "method",
      "class",
      "interface",
      "const",
      "component",
      "hook",
      "enum",
      "type",
    ],
    supportsCallGraph: true,
    supportsJsx: true,
    supportsTypeOnlyImports: true,
  },

  canParse(input: ParseInput): boolean {
    return this.capabilities.extensions.includes(input.extension.toLowerCase());
  },

  parse(input: ParseInput): ParseResult {
    const language = input.language ?? detectLanguage(input.path) ?? "typescript";
    const file = parseSource(input.path, input.content, {
      language,
      parserId: this.id,
      extension: input.extension,
    });
    return { file, diagnostics: [] };
  },
};
