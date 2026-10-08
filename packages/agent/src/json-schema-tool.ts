import { defineTool } from '@earendil-works/pi-durable';
import type { ToolRegistration } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { JsonValue } from '@earendil-works/chord';

/** A JSON Schema for a tool's arguments: an object schema, as providers require. */
export interface JsonObjectSchema {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [keyword: string]: unknown;
}

type JsonSchemaParameters<Args> = ReturnType<typeof Type.Unsafe<Args>>;
export type JsonSchemaToolOptions<Args, TDetails extends JsonValue = JsonValue> =
  Omit<ToolRegistration<JsonSchemaParameters<Args>, TDetails>, 'parameters'> & { readonly parameters: JsonObjectSchema | Readonly<Record<string, unknown>> };

/**
 * A native tool registration from a raw JSON Schema (an MCP server's `inputSchema`, an agent-written `.agent/tools/*.json`): the schema
 * becomes Pi's parameters through typebox's `Type.Unsafe`, so `execute` gets typed arguments without a cast. Validation is Pi's own: the
 * Harness checks every call's arguments against `parameters` before `execute` runs (`validateToolArguments` of `@earendil-works/pi-ai`,
 * which compiles plain JSON Schema with typebox) and answers a call that does not match with an `invalid_arguments` error result that
 * names the failing fields. Nothing is validated twice here. Refuses, at registration, a schema that is not an object schema, and gives one
 * without `properties` an empty one (some providers reject it otherwise).
 */
export function jsonSchemaTool<Args = Record<string, unknown>, TDetails extends JsonValue = JsonValue>(tool: JsonSchemaToolOptions<Args, TDetails>): ToolRegistration<JsonSchemaParameters<Args>, TDetails> {
  const schema = tool.parameters;
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema) || schema['type'] !== 'object') throw new TypeError(`${tool.name}: parameters must be a JSON Schema object with "type": "object"`);
  const properties = schema['properties'];
  if (properties !== undefined && (properties === null || typeof properties !== 'object' || Array.isArray(properties))) throw new TypeError(`${tool.name}: parameters.properties must be an object`);
  return defineTool({ ...tool, parameters: Type.Unsafe<Args>({ ...schema, properties: properties ?? {} }) });
}
