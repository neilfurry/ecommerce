import { decimalStringSchema } from '@marketplace/validation';
import { z } from 'zod';
import { ApiException } from '../errors/api.exception';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(1),
    price: decimalStringSchema(),
    quantity: z.coerce.number().int().positive().default(1),
  });
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed output with defaults applied', () => {
    expect(pipe.transform({ name: 'Rice 5kg', price: '289.00' })).toEqual({
      name: 'Rice 5kg',
      price: '289.00',
      quantity: 1,
    });
  });

  it('throws VALIDATION_FAILED with one field error per issue', () => {
    expect.assertions(4);
    try {
      pipe.transform({ name: '', price: 289 });
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      const apiError = error as ApiException;
      expect(apiError.getStatus()).toBe(400);
      expect(apiError.code).toBe('VALIDATION_FAILED');
      expect(apiError.fieldErrors?.map((e) => e.path).sort()).toEqual(['name', 'price']);
    }
  });

  it('reports nested paths with dot notation', () => {
    const nested = new ZodValidationPipe(
      z.object({ items: z.array(z.object({ qty: z.number() })) }),
    );
    try {
      nested.transform({ items: [{ qty: 1 }, { qty: 'x' }] });
      fail('expected validation error');
    } catch (error) {
      expect((error as ApiException).fieldErrors?.[0]?.path).toBe('items.1.qty');
    }
  });
});
