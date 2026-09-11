import ts from "typescript";
import type { ParsedExport, ParsedFile, ParsedImport } from "../types";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const JSX_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
]);

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

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
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

function collectEnvVars(node: ts.Node, sink: Set<string>): void {
  if (ts.isPropertyAccessExpression(node)) {
    // process.env.NAME
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      node.expression.name.text === "env"
    ) {
      sink.add(node.name.text);
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
      sink.add(argument.text);
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
          sink.add(element.name.text);
        } else if (element.propertyName && ts.isIdentifier(element.propertyName)) {
          sink.add(element.propertyName.text);
        }
      }
    }
  }
  ts.forEachChild(node, (child) => collectEnvVars(child, sink));
}

function collectFetchPaths(node: ts.Node, sink: Array<{ path: string; line: number }>): void {
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
        const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
        sink.push({ path: value, line });
      }
    }
  }
  ts.forEachChild(node, (child) => collectFetchPaths(child, sink));
}

function collectCalls(node: ts.Node, sink: Array<{ name: string; line: number }>): void {
  if (ts.isCallExpression(node)) {
    const name = textOfExpression(node.expression);
    if (name && name.length <= 80 && !name.includes("=>")) {
      const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
      sink.push({ name, line });
    }
  }
  ts.forEachChild(node, (child) => collectCalls(child, sink));
}

function collectJsxTags(node: ts.Node, sink: Array<{ name: string; line: number }>): void {
  const handleTag = (tag: ts.JsxTagNameExpression) => {
    let name: string | null = null;
    if (ts.isIdentifier(tag)) name = tag.text;
    else if (ts.isPropertyAccessExpression(tag)) name = textOfExpression(tag);
    if (name && /^[A-Z]/.test(name.split(".")[0] ?? "")) {
      const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
      sink.push({ name, line });
    }
  };
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    handleTag(node.tagName);
  }
  ts.forEachChild(node, (child) => collectJsxTags(child, sink));
}

function pushExport(
  exports: ParsedExport[],
  name: string,
  kind: ParsedExport["kind"],
  node: ts.Node,
): void {
  const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
  exports.push({ name, kind, line });
}

/**
 * Static AST analysis for a single TS/JS file. Regex is used only for tiny
 * fallbacks (e.g. pages-router method switches); all structure comes from the
 * TypeScript compiler AST.
 */
export function parseSource(path: string, content: string): ParsedFile {
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindFor(path));

  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];
  const components = new Set<string>();
  const hooks = new Set<string>();
  const functions = new Set<string>();
  const classes = new Set<string>();
  const jsxTags: Array<{ name: string; line: number }> = [];
  const calls: Array<{ name: string; line: number }> = [];
  const routeHandlers: Array<{ method: string; line: number }> = [];
  const envVars = new Set<string>();
  const fetchPaths: Array<{ path: string; line: number }> = [];
  const directives = { useClient: false, useServer: false };
  let defaultExport: ParsedExport | undefined;
  let usesJsx = false;

  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const registerFunction = (name: string, node: ts.Node, exported: boolean, isDefault: boolean) => {
    const component = isComponentName(name) && containsJsx(node);
    const hook = isHookName(name);
    if (component) components.add(name);
    if (hook) hooks.add(name);
    else functions.add(name);
    if (HTTP_METHODS.has(name)) {
      routeHandlers.push({ method: name, line: lineOf(node) });
    }
    if (exported || isDefault || component || hook) {
      const kind: ParsedExport["kind"] = component ? "component" : hook ? "hook" : "function";
      const entry: ParsedExport = { name, kind, line: lineOf(node) };
      if (isDefault) {
        defaultExport = entry;
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
        let kind: ParsedImport["kind"] = "side-effect";
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
              kind = kind === "default" ? "named" : "named";
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
          line: lineOf(node),
        });
      }
    }

    // Re-exports with module specifier
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const exported = node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((element) => element.name.text)
        : ["*"];
      imports.push({
        specifier: node.moduleSpecifier.text,
        kind: "named",
        importedNames: exported,
        localNames: [],
        typeOnly: Boolean(node.isTypeOnly),
        line: lineOf(node),
      });
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
          line: lineOf(node),
        });
      }
    }

    // Export assignment (export default ...)
    if (ts.isExportAssignment(node)) {
      const isDefault = !node.isExportEquals;
      if (isDefault) {
        let name = "default";
        if (ts.isIdentifier(node.expression)) name = node.expression.text;
        const entry: ParsedExport = { name, kind: "default", line: lineOf(node) };
        defaultExport = entry;
        exports.push(entry);
      }
    }

    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      registerFunction(node.name.text, node, isExported(node), isDefaultExported(node));
    }

    // Classes
    if (ts.isClassDeclaration(node) && node.name) {
      classes.add(node.name.text);
      if (isExported(node) || isDefaultExported(node)) {
        const entry: ParsedExport = { name: node.name.text, kind: "class", line: lineOf(node) };
        if (isDefaultExported(node)) {
          defaultExport = { ...entry, kind: "default" };
          exports.push({ ...entry, kind: "default" });
        } else {
          exports.push(entry);
        }
      }
    }

    // Variable declarations (arrow components, hooks, handlers, stores)
    if (ts.isVariableStatement(node)) {
      const exported = isExported(node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const initializer = declaration.initializer;
        const functionLike = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
        if (functionLike) {
          registerFunction(name, initializer, exported, false);
          continue;
        }
        if (exported) {
          pushExport(exports, name, "const", declaration);
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

  collectEnvVars(sourceFile, envVars);
  collectFetchPaths(sourceFile, fetchPaths);
  collectCalls(sourceFile, calls);
  collectJsxTags(sourceFile, jsxTags);

  // Pages-router API methods: look for req.method comparisons in source text.
  const methodMatches = content.matchAll(/method\s*[=!]==?\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/gi);
  for (const match of methodMatches) {
    const method = match[1].toUpperCase();
    if (!routeHandlers.some((handler) => handler.method === method)) {
      routeHandlers.push({ method, line: 1 });
    }
  }

  return {
    path,
    imports,
    exports,
    defaultExport,
    components: [...components],
    hooks: [...hooks],
    functions: [...functions],
    classes: [...classes],
    jsxTags,
    calls,
    routeHandlers,
    envVars: [...envVars].sort(),
    fetchPaths,
    directives,
    usesJsx,
    lines: content.split(/\r?\n/),
  };
}
