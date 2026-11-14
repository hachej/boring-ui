import { defineTool } from '@earendil-works/pi-durable';
import type { ToolRegistration } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord/json';

/** A JSON Schema for a tool's arguments: an object schema, as providers require. */
export interface JsonObjectSchema {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [keyword: string]: unknown;
}

/** The schema object, carrying the arguments type `Args` for `execute` (a type-level mark; nothing extra exists at run time). */
type JsonSchemaParameters<Args> = { readonly '~unsafe': Args };
export type JsonSchemaToolOptions<Args, TDetails extends JsonValue = JsonValue> =
  Omit<ToolRegistration<JsonSchemaParameters<Args>, TDetails>, 'parameters'> & { readonly parameters: JsonObjectSchema | Readonly<Record<string, unknown>> };

/**
 * A native tool registration from a raw JSON Schema (an MCP server's `inputSchema`, an agent-written `.agent/tools/*.json`): the schema
 * becomes Pi's parameters as it is, marked with `Args`, so `execute` gets typed arguments without a cast. Validation is Pi's own: the
 * Harness checks every call's arguments against `parameters` before `execute` runs (`validateToolArguments` of `@earendil-works/pi-ai`,
 * which compiles plain JSON Schema) and answers a call that does not match with an `invalid_arguments` error result that
 * names the failing fields. Nothing is validated twice here. Refuses, at registration, a schema that is not an object schema, and gives one
 * without `properties` an empty one (some providers reject it otherwise).
 */
export function jsonSchemaTool<Args = Record<string, unknown>, TDetails extends JsonValue = JsonValue>(tool: JsonSchemaToolOptions<Args, TDetails>): ToolRegistration<JsonSchemaParameters<Args>, TDetails> {
  const schema = tool.parameters;
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema) || schema['type'] !== 'object') throw new TypeError(`${tool.name}: parameters must be a JSON Schema object with "type": "object"`);
  const properties = schema['properties'];
  if (properties !== undefined && (properties === null || typeof properties !== 'object' || Array.isArray(properties))) throw new TypeError(`${tool.name}: parameters.properties must be an object`);
  return defineTool({ ...tool, parameters: { ...schema, properties: properties ?? {} } as unknown as JsonSchemaParameters<Args> });
}
