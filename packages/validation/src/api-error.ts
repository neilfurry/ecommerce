import { API_ERROR_CODES, type ApiErrorBody } from '@marketplace/types';
import { z } from 'zod';

export const apiFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    statusCode: z.number().int(),
    requestId: z.string().optional(),
    fieldErrors: z.array(apiFieldErrorSchema).optional(),
  }),
}) satisfies z.ZodType<ApiErrorBody>;
