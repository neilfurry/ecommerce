import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { z } from 'zod';

export type OpenApiSchema = ApiResponseSchemaHost['schema'];

/**
 * Converts a shared Zod schema into an OpenAPI 3.0 schema object for Swagger decorators,
 * so request/response documentation is generated from the same schema that validates them.
 *   @ApiOkResponse({ schema: zodToOpenApi(healthResponseSchema) })
 */
export function zodToOpenApi(schema: z.ZodType, io: 'input' | 'output' = 'output'): OpenApiSchema {
  const jsonSchema = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' });
  const { $schema: _ignored, ...rest } = jsonSchema as Record<string, unknown>;
  return rest as OpenApiSchema;
}
