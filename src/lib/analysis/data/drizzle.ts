import ts from "typescript";
import type {
  DataEnumFact,
  DataFieldFact,
  DataModelFact,
  DataRelationFact,
  DataSchemaAnalyzer,
  DataSchemaContext,
  DataSchemaDetection,
} from "./registry";

const MAX_TABLES = 120;
const MAX_COLUMNS = 80;
const MAX_ENUMS = 60;

const TABLE_FACTORY_DIALECT: Record<string, string> = {
  pgTable: "postgresql",
  mysqlTable: "mysql",
  sqliteTable: "sqlite",
};

const DRIZZLE_MODULE_PATTERN = /^drizzle-orm(\/|$)/;

interface DrizzleBindings {
  /** local name -> imported factory name (pgTable / mysqlTable / sqliteTable) */
  factories: Map<string, string>;
  /** local names bound to pgEnum */
  enums: Set<string>;
  /** local names bound to relations() */
  relations: Set<string>;
  /** local name -> imported helper name (index/uniqueIndex/unique/primaryKey/foreignKey) */
  helpers: Map<string, string>;
}

interface TableDraft {
  name: string;
  variable: string;
  dialect: string;
  line: number;
  endLine: number;
  fields: DataFieldFact[];
  relations: Array<{ field: string; targetVar: string; cardinality: "one" | "many" }>;
  primaryKey: string[];
  uniqueConstraints: string[][];
  indexes: string[][];
  indexDetails: Array<{ name?: string; columns: string[]; unique: boolean }>;
}

function scriptKind(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/**
 * Proves Drizzle usage through the TypeScript AST: only symbols actually
 * imported from `drizzle-orm/*` are treated as Drizzle factories/helpers.
 * A locally defined function named `pgTable` is NOT Drizzle.
 */
export function collectDrizzleBindings(sourceFile: ts.SourceFile): DrizzleBindings | null {
  const imported = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : "";
    if (!DRIZZLE_MODULE_PATTERN.test(specifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      // Alias support: import { pgTable as table } from "drizzle-orm/pg-core"
      imported.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
  if (imported.size === 0) return null;

  const factories = new Map<string, string>();
  const enums = new Set<string>();
  const relations = new Set<string>();
  const helpers = new Map<string, string>();
  for (const [localName, importedName] of imported) {
    if (TABLE_FACTORY_DIALECT[importedName]) factories.set(localName, importedName);
    else if (importedName === "pgEnum") enums.add(localName);
    else if (importedName === "relations") relations.add(localName);
    else if (
      importedName === "index" ||
      importedName === "uniqueIndex" ||
      importedName === "unique" ||
      importedName === "primaryKey" ||
      importedName === "foreignKey"
    ) {
      helpers.set(localName, importedName);
    }
  }

  return { factories, enums, relations, helpers };
}

/** True when a Drizzle factory imported from drizzle-orm is actually called. */
function callsImportedFactory(sourceFile: ts.SourceFile, factories: Map<string, string>): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && factories.has(node.expression.text)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

function callChain(node: ts.Expression): {
  base: string;
  methods: Array<{ name: string; args: ts.NodeArray<ts.Expression> }>;
  baseCall: ts.CallExpression | null;
} {
  const methods: Array<{ name: string; args: ts.NodeArray<ts.Expression> }> = [];
  let current: ts.Expression = node;
  let baseCall: ts.CallExpression | null = null;
  while (ts.isCallExpression(current)) {
    if (ts.isPropertyAccessExpression(current.expression)) {
      methods.unshift({ name: current.expression.name.text, args: current.arguments });
      current = current.expression.expression;
    } else {
      baseCall = current;
      current = current.expression;
      break;
    }
  }
  const base = ts.isIdentifier(current)
    ? current.text
    : ts.isPropertyAccessExpression(current)
      ? current.name.text
      : "";
  return { base, methods, baseCall };
}

function stringArg(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

/** Unwraps `(expr)` — TypeScript keeps ParenthesizedExpression nodes. */
function skipParentheses(node: ts.ConciseBody): ts.ConciseBody {
  let current: ts.ConciseBody = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function targetFromArrow(node: ts.Expression | undefined): string | null {
  if (!node || !ts.isArrowFunction(node)) return null;
  const body = skipParentheses(node.body);
  if (ts.isPropertyAccessExpression(body)) {
    return ts.isIdentifier(body.expression) ? body.expression.text : null;
  }
  return null;
}

/** Collects `table.column` references in expression order. */
function columnsFromArguments(args: readonly ts.Expression[], tableVar: string): string[] {
  const columns: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === tableVar && ts.isIdentifier(node.name)) {
        columns.push(node.name.text);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const arg of args) visit(arg);
  return columns;
}

function columnsFromPrimaryKey(argument: ts.Expression | undefined, tableVar: string): string[] {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return [];
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText();
    if (name !== "columns") continue;
    const value = skipParentheses(property.initializer);
    if (ts.isArrayLiteralExpression(value)) {
      return columnsFromArguments(value.elements, tableVar);
    }
  }
  return [];
}

function indexNameOf(entry: ts.CallExpression): string | undefined {
  // index("name").on(...) — the name is the first argument of the inner call.
  const inner = ts.isPropertyAccessExpression(entry.expression) ? entry.expression.expression : entry;
  if (ts.isCallExpression(inner)) {
    return stringArg(inner.arguments[0]) ?? undefined;
  }
  return undefined;
}

export function parseDrizzleModule(path: string, content: string): {
  tables: DataModelFact[];
  enums: DataEnumFact[];
  provider: string | null;
} {
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const bindings = collectDrizzleBindings(sourceFile);
  const drafts = new Map<string, TableDraft>();
  const enums: DataEnumFact[] = [];
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  if (!bindings) return { tables: [], enums: [], provider: null };

  // First pass: enum variable name -> enum name, so columns typed with an enum
  // variable can be classified without guessing.
  const enumVariableToName = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (!ts.isCallExpression(declaration.initializer)) continue;
      const callee = ts.isIdentifier(declaration.initializer.expression)
        ? declaration.initializer.expression.text
        : "";
      if (bindings.enums.has(callee)) {
        enumVariableToName.set(
          declaration.name.text,
          stringArg(declaration.initializer.arguments[0]) ?? declaration.name.text,
        );
      }
    }
  }

  const relationCalls: Array<{
    fromVar: string;
    field: string;
    targetVar: string;
    cardinality: "one" | "many";
    line: number;
  }> = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initializer = declaration.initializer;
      if (!ts.isCallExpression(initializer)) continue;
      const calleeName = ts.isIdentifier(initializer.expression)
        ? initializer.expression.text
        : ts.isPropertyAccessExpression(initializer.expression)
          ? initializer.expression.name.text
          : "";

      // pgTable("users", { ... }, (table) => [...]) — local name must be an
      // actual import from drizzle-orm/* (aliases supported).
      const factoryImport = bindings.factories.get(calleeName);
      if (factoryImport && drafts.size < MAX_TABLES) {
        const tableName = stringArg(initializer.arguments[0]) ?? declaration.name.text;
        const columnsObject = initializer.arguments[1];
        const fields: DataFieldFact[] = [];
        if (columnsObject && ts.isObjectLiteralExpression(columnsObject)) {
          for (const property of columnsObject.properties) {
            if (!ts.isPropertyAssignment(property) || fields.length >= MAX_COLUMNS) continue;
            const columnName = property.name.getText(sourceFile).replace(/["']/g, "");
            const columnLine = lineOf(property);
            const value = property.initializer;
            if (!ts.isCallExpression(value)) continue;
            const chain = callChain(value);
            const notNull = chain.methods.some((method) => method.name === "notNull");
            const primaryKey = chain.methods.some((method) => method.name === "primaryKey");
            const unique = chain.methods.some((method) => method.name === "unique");
            const list = chain.methods.some((method) => method.name === "array");
            const defaultMethod = chain.methods.find(
              (method) =>
                method.name === "default" ||
                method.name === "defaultNow" ||
                method.name === "defaultRandom",
            );
            const referenceMethod = chain.methods.find((method) => method.name === "references");

            let relation: DataRelationFact | undefined;
            if (referenceMethod) {
              // `.references(() => users.id)` — the arrow target identifies the table.
              const target = targetFromArrow(referenceMethod.args[0]);
              if (target) {
                relation = {
                  target,
                  cardinality: "one",
                  optional: !notNull,
                  range: { path, startLine: columnLine },
                };
              }
            }

            const enumName = enumVariableToName.get(chain.base);
            fields.push({
              name: columnName,
              type: enumName ?? chain.base,
              kind: relation ? "relation" : enumName ? "enum" : "scalar",
              optional: !notNull && !primaryKey,
              list,
              primaryKey,
              unique,
              ...(defaultMethod ? { default: defaultMethod.args[0]?.getText(sourceFile) } : {}),
              ...(relation ? { relation } : {}),
              range: { path, startLine: columnLine },
            });
          }
        }

        const draft: TableDraft = {
          name: tableName,
          variable: declaration.name.text,
          dialect: TABLE_FACTORY_DIALECT[factoryImport],
          line: lineOf(statement),
          endLine: lineOf(statement),
          fields,
          relations: [],
          primaryKey: fields.filter((field) => field.primaryKey).map((field) => field.name),
          uniqueConstraints: [],
          indexes: [],
          indexDetails: [],
        };

        // Third argument: table config (indexes, composite keys, foreign keys).
        const config = initializer.arguments[2];
        if (config && ts.isArrowFunction(config)) {
          const parameter = config.parameters[0];
          const tableVar = parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : "table";
          const body = skipParentheses(config.body);
          const entries: ts.Expression[] = ts.isObjectLiteralExpression(body)
            ? body.properties.filter(ts.isPropertyAssignment).map((property) => property.initializer)
            : ts.isArrayLiteralExpression(body)
              ? [...body.elements]
              : [];

          for (const entry of entries) {
            if (!ts.isCallExpression(entry)) continue;
            // The helper name lives on the base call of a chain:
            // `uniqueIndex("x").on(...)` -> expression = PropertyAccess(innerCall, "on").
            const baseCall =
              ts.isPropertyAccessExpression(entry.expression) && ts.isCallExpression(entry.expression.expression)
                ? entry.expression.expression
                : entry;
            const helperLocal = ts.isIdentifier(baseCall.expression)
              ? baseCall.expression.text
              : ts.isPropertyAccessExpression(baseCall.expression)
                ? baseCall.expression.name.text
                : "";
            const helper = bindings.helpers.get(helperLocal);
            if (!helper) continue;
            const entryLine = lineOf(entry);

            if (helper === "primaryKey") {
              const columns = columnsFromPrimaryKey(entry.arguments[0], tableVar);
              draft.primaryKey = [...new Set([...draft.primaryKey, ...columns])];
              for (const column of columns) {
                const field = draft.fields.find((candidate) => candidate.name === column);
                if (field) field.primaryKey = true;
              }
            } else if (helper === "index" || helper === "uniqueIndex" || helper === "unique") {
              const columns = columnsFromArguments(entry.arguments, tableVar);
              if (columns.length === 0) continue;
              const unique = helper !== "index";
              draft.indexDetails.push({ name: indexNameOf(entry), columns, unique });
              if (unique) draft.uniqueConstraints.push(columns);
              else draft.indexes.push(columns);
            } else if (helper === "foreignKey") {
              const argument = entry.arguments[0];
              if (!argument || !ts.isObjectLiteralExpression(argument)) continue;
              let ownerColumn: string | undefined;
              let target: string | undefined;
              for (const property of argument.properties) {
                if (!ts.isPropertyAssignment(property)) continue;
                const name = property.name.getText();
                const value = skipParentheses(property.initializer);
                if (name === "columns" && ts.isArrayLiteralExpression(value)) {
                  ownerColumn = columnsFromArguments(value.elements, tableVar)[0];
                }
                if (name === "foreignColumns" && ts.isArrayLiteralExpression(value)) {
                  target = arrowTargetFromExpression(value.elements[0]);
                }
              }
              const field = draft.fields.find((candidate) => candidate.name === ownerColumn);
              if (field && target) {
                field.kind = "relation";
                field.relation = {
                  target,
                  cardinality: "one",
                  optional: field.optional,
                  ownerField: "id",
                  range: { path, startLine: entryLine },
                };
              }
            }
          }
        }

        drafts.set(declaration.name.text, draft);
        continue;
      }

      // pgEnum("role", ["admin", "user"])
      if (bindings.enums.has(calleeName) && enums.length < MAX_ENUMS) {
        const valuesNode = initializer.arguments[1];
        const values: string[] = [];
        if (valuesNode && ts.isArrayLiteralExpression(valuesNode)) {
          for (const element of valuesNode.elements) {
            if (ts.isStringLiteralLike(element)) values.push(element.text);
          }
        }
        enums.push({
          name: stringArg(initializer.arguments[0]) ?? declaration.name.text,
          values,
          range: { path, startLine: lineOf(statement) },
        });
        continue;
      }

      // relations(users, ({ many }) => ({ posts: many(posts) }))
      if (bindings.relations.has(calleeName) && initializer.arguments[0] && ts.isIdentifier(initializer.arguments[0])) {
        const fromVar = initializer.arguments[0].text;
        const callback = initializer.arguments[1];
        if (callback && ts.isArrowFunction(callback)) {
          const body = skipParentheses(callback.body);
          if (ts.isObjectLiteralExpression(body)) {
            for (const property of body.properties) {
              if (!ts.isPropertyAssignment(property) || !ts.isCallExpression(property.initializer)) continue;
              const helper = ts.isIdentifier(property.initializer.expression)
                ? property.initializer.expression.text
                : "";
              const targetNode = property.initializer.arguments[0];
              if (!targetNode || !ts.isIdentifier(targetNode) || (helper !== "one" && helper !== "many")) {
                continue;
              }
              relationCalls.push({
                fromVar,
                field: property.name.getText(sourceFile).replace(/["']/g, ""),
                targetVar: targetNode.text,
                cardinality: helper === "many" ? "many" : "one",
                line: lineOf(property),
              });
            }
          }
        }
      }
    }
  }

  // Resolve variable names to table names.
  const variableToTable = new Map<string, string>();
  for (const draft of drafts.values()) variableToTable.set(draft.variable, draft.name);

  for (const draft of drafts.values()) {
    for (const field of draft.fields) {
      if (field.relation) {
        field.relation.target = variableToTable.get(field.relation.target) ?? field.relation.target;
      }
    }
  }

  for (const relation of relationCalls) {
    const table = drafts.get(relation.fromVar);
    if (!table) continue;
    const target = variableToTable.get(relation.targetVar) ?? relation.targetVar;
    table.fields.push({
      name: relation.field,
      type: target + (relation.cardinality === "many" ? "[]" : ""),
      kind: "relation",
      optional: false,
      list: relation.cardinality === "many",
      primaryKey: false,
      unique: false,
      relation: {
        target,
        cardinality: relation.cardinality,
        optional: false,
        ...(target === table.name ? { self: true } : {}),
        range: { path, startLine: relation.line },
      },
      range: { path, startLine: relation.line },
    });
  }

  const tables: DataModelFact[] = [...drafts.values()].map((draft) => ({
    name: draft.name,
    kind: "table",
    range: { path, startLine: draft.line, endLine: draft.endLine },
    fieldCount: draft.fields.length,
    fields: draft.fields,
    ...(draft.name !== draft.variable ? { mappedName: draft.variable } : {}),
    primaryKey: [...new Set(draft.primaryKey)],
    uniqueConstraints: draft.uniqueConstraints,
    indexes: draft.indexes,
    indexDetails: draft.indexDetails,
  }));

  const provider = drafts.size > 0 ? [...drafts.values()][0].dialect : null;
  return { tables, enums, provider };
}

function arrowTargetFromExpression(node: ts.Expression | undefined): string | undefined {
  if (!node || !ts.isPropertyAccessExpression(node)) return undefined;
  return ts.isIdentifier(node.expression) ? node.expression.text : undefined;
}

export const drizzleSchemaAnalyzer: DataSchemaAnalyzer = {
  id: "drizzle-schema",
  version: "2.0.0",
  label: "Drizzle schema",
  capabilities: {
    formats: ["drizzle"],
    providers: ["postgresql", "mysql", "sqlite"],
    concepts: ["table", "column", "relation", "enum", "reference", "index", "composite key"],
  },

  detect(context: DataSchemaContext): boolean {
    for (const [path, content] of context.files) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) continue;
      // `includes` is only a cheap pre-filter; the real proof is AST-based.
      if (!content.includes("drizzle-orm")) continue;
      const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
      const bindings = collectDrizzleBindings(sourceFile);
      if (!bindings || bindings.factories.size === 0) continue;
      if (!callsImportedFactory(sourceFile, bindings.factories)) continue;
      return true;
    }
    return false;
  },

  analyze(context: DataSchemaContext): DataSchemaDetection[] {
    const detections: DataSchemaDetection[] = [];
    for (const [path, content] of context.files) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) continue;
      if (!content.includes("drizzle-orm")) continue;
      const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
      const bindings = collectDrizzleBindings(sourceFile);
      if (!bindings || bindings.factories.size === 0) continue;
      if (!callsImportedFactory(sourceFile, bindings.factories)) continue;

      const result = parseDrizzleModule(path, content);
      if (result.tables.length === 0 && result.enums.length === 0) continue;
      detections.push({
        analyzerId: this.id,
        format: "drizzle",
        files: [path],
        provider: result.provider ? { raw: result.provider, range: { path, startLine: 1 } } : null,
        models: result.tables,
        enums: result.enums,
      });
    }
    return detections;
  },
};
