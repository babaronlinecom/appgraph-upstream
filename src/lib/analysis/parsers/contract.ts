import type { FileIR } from "../ir/model";
import type { LanguageId } from "../languages";

export interface ParseInput {
  path: string;
  content: string;
  language: LanguageId;
  extension: string;
}

export interface ParserCapabilities {
  languages: LanguageId[];
  extensions: string[];
  symbolKinds: string[];
  supportsCallGraph: boolean;
  supportsJsx: boolean;
  supportsTypeOnlyImports: boolean;
}

export interface ParserDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  path: string;
}

export interface ParseResult {
  file: FileIR;
  diagnostics: ParserDiagnostic[];
}

/**
 * Language-agnostic parser contract. The analysis pipeline only knows this
 * interface: a new language becomes analyzable by registering an
 * implementation, without touching pipeline control flow.
 */
export interface LanguageParser {
  id: string;
  version: string;
  label: string;
  capabilities: ParserCapabilities;
  canParse(input: ParseInput): boolean;
  parse(input: ParseInput): ParseResult;
}
