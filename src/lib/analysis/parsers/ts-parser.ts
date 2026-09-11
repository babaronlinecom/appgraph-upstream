import ts from "typescript";
import type { LanguageId } from "../languages";
import type {
  FileIR,
  IrCall,
  IrEnvRead,
  IrExport,
  IrExportKind,
  IrFetchPath,
  IrImport,
  IrJsxTag,
  IrReExport,
  IrRouteHandler,
  IrSourceRange,
  IrSymbol,
  IrSymbolKind,
} from "../ir/model";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const JSX_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
]);

const MAX_SYMBOLS_PER_FILE = 400;
const MAX_CALLS_PER_FILE = 2_000;
const MAX_ENV_READS_PER_FILE = 200;

function scriptKindFor(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".mts") || lower.endsWith(".cts") || lower.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(modifiers?.some((modifier) => modifier.kind === kind));
}

function isExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function isDefaultExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (JSX_KINDS.has(child.kind)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

/**
 * Walks up the AST to find the nearest declared symbol containing a node.
 * Used to attribute calls/JSX/env reads to the function or method they live in.
 */
function enclosingSymbolName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isClassDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      const initializer = current.initializer;
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        return current.name.text;
      }
    }
    current = current.parent;
  }
  return undefined;
}

function textOfExpression(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const left = textOfExpression(node.expression);
    if (!left) return null;
    return `${left}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    if (argument && ts.isStringLiteralLike(argument)) {
      const left = textOfExpression(node.expression);
      if (!left) return null;
      return `${left}.${argument.text}`;
    }
  }
  if (ts.isCallExpression(node)) {
    const callee = textOfExpression(node.expression);
    if (callee) return `${callee}()`;
  }
  return null;
}

export interface ParseSourceOptions {
  language?: LanguageId;
  parserId?: string;
  extension?: string;
}

/**
 * Static AST analysis for a single TS/JS file producing the normalized IR.
 * Regex is used only for tiny fallbacks (e.g. pages-router method switches);
 * all structure comes from the TypeScript compiler AST.
 */
export function parseSource(
  path: string,
  content: string,
  options: ParseSourceOptions = {},
): FileIR {
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindFor(path));

  const imports: IrImport[] = [];
  const reExports: IrReExport[] = [];
  const exports: IrExport[] = [];
  const symbols: IrSymbol[] = [];
  const components = new Set<string>();
  const hooks = new Set<string>();
  const functions = new Set<string>();
  const classes = new Set<string>();
  const jsxTags: IrJsxTag[] = [];
  const calls: IrCall[] = [];
  const routeHandlers: IrRouteHandler[] = [];
  const envReads: IrEnvRead[] = [];
  const fetchPaths: IrFetchPath[] = [];
  const directives = { useClient: false, useServer: false };
  let defaultExport: IrExport | undefined;
  let usesJsx = false;

  const rangeOf = (node: ts.Node): IrSourceRange => {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return { path, startLine: start, endLine: end };
  };

  const addSymbol = (name: string, kind: IrSymbolKind, node: ts.Node, exported: boolean, isDefault: boolean) => {
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) return;
    symbols.push({
      name,
      kind,
      exported: exported || isDefault,
      ...(isDefault ? { defaultExport: true } : {}),
      range: rangeOf(node),
    });
  };

  const registerFunction = (name: string, node: ts.Node, exported: boolean, isDefault: boolean) => {
    const component = isComponentName(name) && containsJsx(node);
    const hook = isHookName(name);
    const symbolKind: IrSymbolKind = component ? "component" : hook ? "hook" : "function";
    if (component) components.add(name);
    if (hook) hooks.add(name);
    else functions.add(name);
    if (HTTP_METHODS.has(name)) {
      routeHandlers.push({ method: name, range: rangeOf(node) });
    }
    addSymbol(name, symbolKind, node, exported, isDefault);
    if (exported || isDefault || component || hook) {
      const exportKind: IrExportKind = component ? "component" : hook ? "hook" : "function";
      const entry: IrExport = { name, kind: exportKind, range: rangeOf(node) };
      if (isDefault) {
        defaultExport = { ...entry, kind: "default" };
        exports.push({ ...entry, kind: "default" });
      } else if (exported) {
        exports.push(entry);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    // Imports
    if (ts.isImportDeclaration(node)) {
      const specifier = ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
      if (specifier) {
        const clause = node.importClause;
        let kind: IrImport["kind"] = "side-effect";
        const importedNames: string[] = [];
        const localNames: string[] = [];
        if (clause) {
          if (clause.name) {
            kind = "default";
            importedNames.push("default");
            localNames.push(clause.name.text);
          }
          const bindings = clause.namedBindings;
          if (bindings) {
            if (ts.isNamespaceImport(bindings)) {
              kind = "namespace";
              importedNames.push("*");
              localNames.push(bindings.name.text);
            } else {
              kind = "named";
              for (const element of bindings.elements) {
                importedNames.push(element.propertyName?.text ?? element.name.text);
                localNames.push(element.name.text);
              }
            }
          }
        }
        imports.push({
          specifier,
          kind,
          importedNames,
          localNames,
          typeOnly: Boolean(clause?.isTypeOnly),
          range: rangeOf(node),
        });
      }
    }

    // Re-exports with module specifier
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const sourceNames = node.exportClause.elements.map(
          (element) => element.propertyName?.text ?? element.name.text,
        );
        const exportedNames = node.exportClause.elements.map((element) => element.name.text);
        // File-level dependency fact (used by the file graph and resolvers).
        imports.push({
          specifier: node.moduleSpecifier.text,
          kind: "named",
          importedNames: sourceNames,
          localNames: exportedNames,
          typeOnly: Boolean(node.isTypeOnly),
          range: rangeOf(node),
        });
        reExports.push({
          specifier: node.moduleSpecifier.text,
          sourceNames,
          exportedNames,
          range: rangeOf(node),
        });
        for (const name of exportedNames) {
          exports.push({ name, kind: "re-export", range: rangeOf(node) });
        }
      } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          kind: "namespace",
          importedNames: ["*"],
          localNames: [node.exportClause.name.text],
          typeOnly: Boolean(node.isTypeOnly),
          range: rangeOf(node),
        });
        reExports.push({
          specifier: node.moduleSpecifier.text,
          sourceNames: "*",
          exportedNames: [node.exportClause.name.text],
          range: rangeOf(node),
        });
        exports.push({ name: node.exportClause.name.text, kind: "re-export", range: rangeOf(node) });
      } else {
        // export * from "..."
        imports.push({
          specifier: node.moduleSpecifier.text,
          kind: "named",
          importedNames: ["*"],
          localNames: [],
          typeOnly: Boolean(node.isTypeOnly),
          range: rangeOf(node),
        });
        reExports.push({
          specifier: node.moduleSpecifier.text,
          sourceNames: "*",
          exportedNames: [],
          range: rangeOf(node),
        });
      }
    }

    // import x = require("...")
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteralLike(expression)) {
        imports.push({
          specifier: expression.text,
          kind: "namespace",
          importedNames: ["*"],
          localNames: [node.name.text],
          typeOnly: false,
          range: rangeOf(node),
        });
      }
    }

    // Export assignment (export default ...)
    if (ts.isExportAssignment(node)) {
      const isDefault = !node.isExportEquals;
      if (isDefault) {
        let name = "default";
        if (ts.isIdentifier(node.expression)) name = node.expression.text;
        const entry: IrExport = { name, kind: "default", range: rangeOf(node) };
        defaultExport = entry;
        exports.push(entry);
      }
    }

    // Function declarations (top level and namespaces only for symbols)
    if (ts.isFunctionDeclaration(node) && node.name) {
      registerFunction(node.name.text, node, isExported(node), isDefaultExported(node));
    }

    // Classes (+ methods as symbols)
    if (ts.isClassDeclaration(node) && node.name) {
      classes.add(node.name.text);
      if (isExported(node) || isDefaultExported(node)) {
        const entry: IrExport = { name: node.name.text, kind: "class", range: rangeOf(node) };
        if (isDefaultExported(node)) {
          defaultExport = { ...entry, kind: "default" };
          exports.push({ ...entry, kind: "default" });
        } else {
          exports.push(entry);
        }
      }
      addSymbol(node.name.text, "class", node, isExported(node), isDefaultExported(node));
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          addSymbol(member.name.text, "method", member, false, false);
        }
      }
    }

    if (ts.isInterfaceDeclaration(node)) {
      addSymbol(node.name.text, "interface", node, isExported(node), isDefaultExported(node));
      if (isExported(node)) {
        exports.push({ name: node.name.text, kind: "type", range: rangeOf(node) });
      }
    }

    if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(node.name.text, "type", node, isExported(node), false);
      if (isExported(node)) {
        exports.push({ name: node.name.text, kind: "type", range: rangeOf(node) });
      }
    }

    if (ts.isEnumDeclaration(node)) {
      addSymbol(node.name.text, "enum", node, isExported(node), false);
      if (isExported(node)) {
        exports.push({ name: node.name.text, kind: "const", range: rangeOf(node) });
      }
    }

    // Variable declarations (arrow components, hooks, handlers, stores, consts)
    if (ts.isVariableStatement(node)) {
      const exported = isExported(node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const initializer = declaration.initializer;
        const functionLike = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
        if (functionLike) {
          registerFunction(name, declaration, exported, false);
          continue;
        }
        addSymbol(name, "const", declaration, exported, false);
        if (exported) {
          exports.push({ name, kind: "const", range: rangeOf(declaration) });
        }
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      usesJsx = true;
    }

    // Directives: "use client" / "use server"
    if (ts.isExpressionStatement(node) && ts.isStringLiteralLike(node.expression)) {
      if (node.expression.text === "use client") directives.useClient = true;
      if (node.expression.text === "use server") directives.useServer = true;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  collectEnvReads(sourceFile, envReads, rangeOf);
  collectFetchPaths(sourceFile, fetchPaths, rangeOf);
  collectCalls(sourceFile, calls, rangeOf);
  collectJsxTags(sourceFile, jsxTags, rangeOf);

  // Pages-router API methods: look for req.method comparisons in source text.
  const methodMatches = content.matchAll(/method\s*[=!]==?\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/gi);
  for (const match of methodMatches) {
    const method = match[1].toUpperCase();
    if (!routeHandlers.some((handler) => handler.method === method)) {
      routeHandlers.push({ method, range: { path, startLine: 1 } });
    }
  }

  return {
    path,
    language: options.language ?? "typescript",
    parserId: options.parserId ?? "typescript-ast",
    imports,
    reExports,
    exports,
    defaultExport,
    symbols,
    components: [...components],
    hooks: [...hooks],
    functions: [...functions],
    classes: [...classes],
    jsxTags,
    calls,
    routeHandlers,
    envReads,
    envVars: [...new Set(envReads.map((read) => read.name))].sort(),
    fetchPaths,
    directives,
    usesJsx,
    lines: content.split(/\r?\n/),
  };
}

function collectEnvReads(
  node: ts.Node,
  sink: IrEnvRead[],
  rangeOf: (node: ts.Node) => IrSourceRange,
): void {
  const push = (name: string, at: ts.Node) => {
    if (sink.length >= MAX_ENV_READS_PER_FILE) return;
    if (sink.some((read) => read.name === name && read.range.startLine === rangeOf(at).startLine)) return;
    sink.push({ name, symbol: enclosingSymbolName(at), range: rangeOf(at) });
  };

  if (ts.isPropertyAccessExpression(node)) {
    // process.env.NAME
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      node.expression.name.text === "env"
    ) {
      push(node.name.text, node);
    }
  }
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    if (
      argument &&
      ts.isStringLiteralLike(argument) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      node.expression.name.text === "env"
    ) {
      push(argument.text, node);
    }
  }
  // const { FOO, BAR } = process.env
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isPropertyAccessExpression(node.initializer)) {
    const initializer = node.initializer;
    if (
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === "process" &&
      initializer.name.text === "env" &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        if (ts.isIdentifier(element.name) && !element.propertyName) {
          push(element.name.text, node);
        } else if (element.propertyName && ts.isIdentifier(element.propertyName)) {
          push(element.propertyName.text, node);
        }
      }
    }
  }
  ts.forEachChild(node, (child) => collectEnvReads(child, sink, rangeOf));
}

function collectFetchPaths(
  node: ts.Node,
  sink: IrFetchPath[],
  rangeOf: (node: ts.Node) => IrSourceRange,
): void {
  if (ts.isCallExpression(node)) {
    const calleeText = textOfExpression(node.expression);
    const isFetch = calleeText === "fetch" || calleeText === "window.fetch" || calleeText === "globalThis.fetch";
    const isHttpClient =
      calleeText !== null &&
      /^(axios|ky|got|superagent)(\.(get|post|put|patch|delete|head|require))?$/.test(calleeText.split("(")[0]);
    if ((isFetch || isHttpClient) && node.arguments.length > 0) {
      const argument = node.arguments[0];
      let value: string | null = null;
      if (ts.isStringLiteralLike(argument)) {
        value = argument.text;
      } else if (ts.isTemplateExpression(argument) && argument.templateSpans.length === 1) {
        value = argument.head.text;
      } else if (ts.isNoSubstitutionTemplateLiteral(argument)) {
        value = argument.text;
      }
      if (value) {
        sink.push({ path: value, range: rangeOf(node) });
      }
    }
  }
  ts.forEachChild(node, (child) => collectFetchPaths(child, sink, rangeOf));
}

function collectCalls(
  node: ts.Node,
  sink: IrCall[],
  rangeOf: (node: ts.Node) => IrSourceRange,
): void {
  if (ts.isCallExpression(node) && sink.length < MAX_CALLS_PER_FILE) {
    const name = textOfExpression(node.expression);
    if (name && name.length <= 80 && !name.includes("=>")) {
      sink.push({ name, symbol: enclosingSymbolName(node), range: rangeOf(node) });
    }
  }
  ts.forEachChild(node, (child) => collectCalls(child, sink, rangeOf));
}

function collectJsxTags(
  node: ts.Node,
  sink: IrJsxTag[],
  rangeOf: (node: ts.Node) => IrSourceRange,
): void {
  const handleTag = (tag: ts.JsxTagNameExpression) => {
    let name: string | null = null;
    if (ts.isIdentifier(tag)) name = tag.text;
    else if (ts.isPropertyAccessExpression(tag)) name = textOfExpression(tag);
    if (name && /^[A-Z]/.test(name.split(".")[0] ?? "")) {
      sink.push({ name, symbol: enclosingSymbolName(node), range: rangeOf(node) });
    }
  };
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    handleTag(node.tagName);
  }
  ts.forEachChild(node, (child) => collectJsxTags(child, sink, rangeOf));
}
