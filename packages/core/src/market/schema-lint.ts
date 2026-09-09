/**
 * C1 schema lint: no market schema may carry a directive field name.
 *
 * Test-time helper, port of dps-market-mcp `guard/schema_lint.py`. Walks zod
 * object shapes recursively (through nullable / optional / default / array /
 * record / effects wrappers) and reports every key whose lower-cased name is in
 * FORBIDDEN_FIELD_NAMES as "schemaName.path.to.key".
 */
import { ZodArray, ZodDefault, ZodEffects, ZodNullable, ZodObject, ZodOptional, ZodRecord, type ZodTypeAny } from "zod";
import { FORBIDDEN_FIELD_NAMES } from "./schemas";

const FORBIDDEN = new Set<string>(FORBIDDEN_FIELD_NAMES.map((name) => name.toLowerCase()));

export function isForbiddenFieldName(name: string): boolean {
  return FORBIDDEN.has(name.toLowerCase());
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  if (schema instanceof ZodNullable || schema instanceof ZodOptional) {
    return unwrap(schema.unwrap());
  }
  if (schema instanceof ZodDefault) {
    return unwrap(schema.removeDefault());
  }
  if (schema instanceof ZodEffects) {
    return unwrap(schema.innerType());
  }
  return schema;
}

function violations(schema: ZodTypeAny, path: string): string[] {
  const inner = unwrap(schema);
  if (inner instanceof ZodArray) {
    return violations(inner.element, `${path}[]`);
  }
  if (inner instanceof ZodRecord) {
    return violations(inner.valueSchema, `${path}{}`);
  }
  if (inner instanceof ZodObject) {
    const shape = inner.shape as Record<string, ZodTypeAny>;
    return Object.entries(shape).flatMap(([key, value]) => {
      const keyPath = `${path}.${key}`;
      const own = isForbiddenFieldName(key) ? [keyPath] : [];
      return [...own, ...violations(value, keyPath)];
    });
  }
  return [];
}

/** "name.path.to.field" for every forbidden field on the given schemas. Empty means clean. */
export function lintSchemaFields(schemas: Record<string, ZodTypeAny>): string[] {
  return Object.entries(schemas).flatMap(([name, schema]) => violations(schema, name));
}
