import type { LanguageId } from "../languages";

/**
 * Normalized Software IR (draft).
 *
 * Parsers emit this shape regardless of language. Everything a downstream
 * analyzer needs carries a source range so every inferred fact can point back
 * to the code that proves it. Language-specific conveniences (React hooks,
 * JSX tags, route handlers) are present because TypeScript/JavaScript needs
 * them today; they are optional for future parsers.
 */

export interface IrSourceRange {
  path: string;
  startLine: number;
  endLine?: number;
}

export type IrSymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "const"
  | "component"
  | "hook"
  | "enum"
  | "type"
  | "unknown";

export interface IrSymbol {
  name: string;
  kind: IrSymbolKind;
  exported: boolean;
  defaultExport?: boolean;
  range: IrSourceRange;
}

export interface IrImport {
  specifier: string;
  kind: "default" | "named" | "namespace" | "side-effect" | "type";
  importedNames: string[];
  localNames: string[];
  typeOnly: boolean;
  range: IrSourceRange;
}

export type IrExportKind =
  | "function"
  | "class"
  | "const"
  | "component"
  | "hook"
  | "default"
  | "type"
  | "re-export";

export interface IrExport {
  name: string;
  kind: IrExportKind;
  range: IrSourceRange;
}

export interface IrJsxTag {
  name: string;
  range: IrSourceRange;
}

export interface IrCall {
  /** Callee text exactly as written: `createProject`, `db.project.create`. */
  name: string;
  range: IrSourceRange;
}

export interface IrRouteHandler {
  method: string;
  range: IrSourceRange;
}

export interface IrFetchPath {
  path: string;
  range: IrSourceRange;
}

export interface IrEnvRead {
  name: string;
  range: IrSourceRange;
}

export interface FileIR {
  path: string;
  language: LanguageId;
  parserId: string;
  imports: IrImport[];
  exports: IrExport[];
  defaultExport?: IrExport;
  /** Declared symbols with source ranges (draft for the symbol-level graph). */
  symbols: IrSymbol[];
  components: string[];
  hooks: string[];
  functions: string[];
  classes: string[];
  jsxTags: IrJsxTag[];
  calls: IrCall[];
  routeHandlers: IrRouteHandler[];
  /** Located environment reads. */
  envReads: IrEnvRead[];
  /** Derived convenience view of `envReads` (unique sorted names). */
  envVars: string[];
  fetchPaths: IrFetchPath[];
  directives: { useClient: boolean; useServer: boolean };
  usesJsx: boolean;
  lines: string[];
}
