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
const TABLE_FACTORIES: Record<string, string> = {
  pgTable: "postgresql",
  mysqlTable: "mysql",
  sqliteTable: "sqlite",
};

interface TableDraft {
  name: string;
  variable: string;
  dialect: string;
  line: number;
  endLine: number;
  fields: DataFieldFact[];
  relations: Array<{ field: string; targetVar: string; cardinality: "one" | "many" }>;
  primaryKey: string[];
}

function scriptKind(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function callChain(node: ts.Expression): { base: string; methods: Array<{ name: string; args: ts.NodeArray<ts.Expression> }> } {
  const methods: Array<{ name: string; args: ts.NodeArray<ts.Expression> }> = [];
  let current: ts.Expression = node;
  while (ts.isCallExpression(current)) {
    if (ts.isPropertyAccessExpression(current.expression)) {
      methods.unshift({ name: current.expression.name.text, args: current.arguments });
      current = current.expression.expression;
    } else {
      // Plain identifier callee, e.g. `serial("id")`.
      current = current.expression;
      break;
    }
  }
  const base = ts.isIdentifier(current) ? current.text : ts.isPropertyAccessExpression(current) ? current.name.text : "";
  return { base, methods };
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

export function parseDrizzleModule(path: string, content: string): {
  tables: DataModelFact[];
  enums: DataEnumFact[];
  provider: string | null;
} {
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const drafts = new Map<string, TableDraft>();
  const enums: DataEnumFact[] = [];
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

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
      if (callee === "pgEnum") {
        enumVariableToName.set(
          declaration.name.text,
          stringArg(declaration.initializer.arguments[0]) ?? declaration.name.text,
        );
      }
    }
  }

  const relationCalls: Array<{ fromVar: string; field: string; targetVar: string; cardinality: "one" | "many"; line: number }> = [];

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

      // pgTable("users", { ... }) / mysqlTable / sqliteTable
      if (TABLE_FACTORIES[calleeName] && drafts.size < MAX_TABLES) {
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
                relation = { target, cardinality: "one", optional: !notNull };
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

        drafts.set(declaration.name.text, {
          name: tableName,
          variable: declaration.name.text,
          dialect: TABLE_FACTORIES[calleeName],
          line: lineOf(statement),
          endLine: lineOf(statement),
          fields,
          relations: [],
          primaryKey: fields.filter((field) => field.primaryKey).map((field) => field.name),
        });
        continue;
      }

      // pgEnum("role", ["admin", "user"])
      if (calleeName === "pgEnum" && enums.length < MAX_ENUMS) {
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
      if (calleeName === "relations" && initializer.arguments[0] && ts.isIdentifier(initializer.arguments[0])) {
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
              if (!targetNode || !ts.isIdentifier(targetNode) || (helper !== "one" && helper !== "many")) continue;
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
      relation: { target, cardinality: relation.cardinality, optional: false },
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
    primaryKey: draft.primaryKey,
    uniqueConstraints: [],
    indexes: [],
  }));

  const provider = drafts.size > 0 ? [...drafts.values()][0].dialect : null;
  return { tables, enums, provider };
}

function targetFromArrow(node: ts.Expression | undefined): string | null {
  if (!node || !ts.isArrowFunction(node)) return null;
  const body = skipParentheses(node.body);
  if (ts.isPropertyAccessExpression(body)) {
    return ts.isIdentifier(body.expression) ? body.expression.text : null;
  }
  return null;
}

export const drizzleSchemaAnalyzer: DataSchemaAnalyzer = {
  id: "drizzle-schema",
  version: "1.0.0",
  label: "Drizzle schema",
  capabilities: {
    formats: ["drizzle"],
    providers: ["postgresql", "mysql", "sqlite"],
    concepts: ["table", "column", "relation", "enum", "reference"],
  },

  detect(context: DataSchemaContext): boolean {
    for (const [path, content] of context.files) {
      if (!/\.(ts|tsx|js|mjs)$/i.test(path)) continue;
      if (!content.includes("drizzle-orm")) continue;
      if (/(pgTable|mysqlTable|sqliteTable)\s*\(/.test(content)) return true;
    }
    return false;
  },

  analyze(context: DataSchemaContext): DataSchemaDetection[] {
    const detections: DataSchemaDetection[] = [];
    for (const [path, content] of context.files) {
      if (!/\.(ts|tsx|js|mjs)$/i.test(path)) continue;
      if (!content.includes("drizzle-orm")) continue;
      if (!/(pgTable|mysqlTable|sqliteTable)\s*\(/.test(content)) continue;
      const result = parseDrizzleModule(path, content);
      if (result.tables.length === 0 && result.enums.length === 0) continue;
      detections.push({
        analyzerId: this.id,
        format: "drizzle",
        files: [path],
        provider: result.provider
          ? { raw: result.provider, range: { path, startLine: 1 } }
          : null,
        models: result.tables,
        enums: result.enums,
      });
    }
    return detections;
  },
};
