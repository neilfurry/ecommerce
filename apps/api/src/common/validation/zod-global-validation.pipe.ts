import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe';
import { isZodDtoClass } from './zod-dto';

/**
 * Registered globally in bootstrap.ts. Validates every @Body(), @Query() and @Param()
 * whose declared type was created with createZodDto(), using the shared Zod schema, and
 * replaces the raw value with the parsed output (defaults and coercions applied).
 * Parameters with other types pass through untouched; use ZodValidationPipe explicitly
 * for one-off schemas such as a single path parameter.
 */
@Injectable()
export class ZodGlobalValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom' || !isZodDtoClass(metadata.metatype)) return value;
    return new ZodValidationPipe(metadata.metatype.zodSchema).transform(value);
  }
}
