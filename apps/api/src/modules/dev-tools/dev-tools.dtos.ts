import { QUEUE_NAMES } from '@marketplace/config';
import {
  devSampleJobRequestSchema,
  devTestEmailRequestSchema,
  paginationQuerySchema,
} from '@marketplace/validation';
import { z } from 'zod';
import { createZodDto } from '../../common/validation/zod-dto';

export class DevSampleJobDto extends createZodDto(devSampleJobRequestSchema) {}
export class DevTestEmailDto extends createZodDto(devTestEmailRequestSchema) {}
export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}

export const queueNameParamSchema = z.enum(Object.values(QUEUE_NAMES) as [string, ...string[]]);
/** BullMQ ids: numeric for generated ids, "<queue>__<id>" for dead letters. */
export const jobIdParamSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid job id');
