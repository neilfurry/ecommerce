import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ApiFieldError } from '@marketplace/shared-types';
import type { z } from 'zod';
import { ApiException } from '../errors/api.exception';

export function zodIssuesToFieldErrors(error: z.ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Validates and transforms a request part with a shared Zod schema.
 * Usage: @Body(new ZodValidationPipe(createThingSchema)) body: CreateThingInput
 * Returns the parsed output, so defaults and coercions are applied.
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Request validation failed.',
        zodIssuesToFieldErrors(result.error),
      );
    }
    return result.data;
  }
}
