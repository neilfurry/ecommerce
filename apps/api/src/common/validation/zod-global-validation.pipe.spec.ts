import { paginationQuerySchema } from '@marketplace/validation';
import { z } from 'zod';
import { ApiException } from '../errors/api.exception';
import { createZodDto } from './zod-dto';
import { ZodGlobalValidationPipe } from './zod-global-validation.pipe';

class PaginationDto extends createZodDto(paginationQuerySchema) {}
class CreateDto extends createZodDto(z.object({ name: z.string().min(1) })) {}

describe('ZodGlobalValidationPipe', () => {
  const pipe = new ZodGlobalValidationPipe();

  it('parses parameters typed with a Zod DTO, applying coercion and defaults', () => {
    expect(pipe.transform({ page: '2' }, { type: 'query', metatype: PaginationDto })).toEqual({
      page: 2,
      pageSize: 20,
    });
  });

  it('rejects invalid input with VALIDATION_FAILED field errors', () => {
    try {
      pipe.transform({ name: '' }, { type: 'body', metatype: CreateDto });
      fail('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).code).toBe('VALIDATION_FAILED');
      expect((error as ApiException).fieldErrors?.[0]?.path).toBe('name');
    }
  });

  it('passes through parameters that are not Zod DTOs', () => {
    const raw = { anything: true };
    expect(pipe.transform(raw, { type: 'body', metatype: Object })).toBe(raw);
    expect(pipe.transform('abc', { type: 'param', metatype: String })).toBe('abc');
  });

  it('ignores custom decorators such as @CurrentUser()', () => {
    const user = { id: 'u1' };
    expect(pipe.transform(user, { type: 'custom', metatype: CreateDto })).toBe(user);
  });

  it('exposes an OpenAPI schema for Swagger', () => {
    expect(CreateDto.openApiSchema).toMatchObject({ type: 'object', required: ['name'] });
  });
});
