import type { z } from 'zod';
import { zodToOpenApi, type OpenApiSchema } from '../openapi/zod-openapi';

/** Static side of a DTO class created by createZodDto. */
export interface ZodDtoClass<TSchema extends z.ZodType = z.ZodType> {
  new (): z.output<TSchema>;
  readonly zodSchema: TSchema;
  /** OpenAPI schema of the request shape, for @ApiBody / @ApiQuery. */
  readonly openApiSchema: OpenApiSchema;
}

/**
 * Turns a shared Zod schema into a class usable as a controller parameter type.
 * The global ZodGlobalValidationPipe validates and transforms any parameter whose type
 * is such a class, so controllers stay declarative:
 *
 *   export class CreateThingDto extends createZodDto(createThingSchema) {}
 *   @Post() create(@Body() body: CreateThingDto) { ... }   // body is already parsed
 */
export function createZodDto<TSchema extends z.ZodType>(schema: TSchema): ZodDtoClass<TSchema> {
  class ZodDto {
    static readonly zodSchema = schema;
    static readonly openApiSchema = zodToOpenApi(schema, 'input');
  }
  return ZodDto as unknown as ZodDtoClass<TSchema>;
}

export function isZodDtoClass(value: unknown): value is ZodDtoClass {
  return (
    typeof value === 'function' &&
    'zodSchema' in value &&
    typeof (value as { zodSchema?: { safeParse?: unknown } }).zodSchema?.safeParse === 'function'
  );
}
