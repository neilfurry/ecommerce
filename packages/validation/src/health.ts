import { COMPONENT_STATUSES, HEALTH_COMPONENT_NAMES, SYSTEM_STATUSES } from '@marketplace/types';
import { z } from 'zod';

export const componentHealthSchema = z.object({
  name: z.enum(HEALTH_COMPONENT_NAMES),
  status: z.enum(COMPONENT_STATUSES),
  /** Critical components make the whole API "down" (HTTP 503) when they fail. */
  critical: z.boolean(),
  /** Round-trip time of the check in milliseconds; null if the check did not complete. */
  latencyMs: z.number().nonnegative().nullable(),
  /** Short, non-sensitive explanation when status is "down". */
  message: z.string().optional(),
});
export type ComponentHealth = z.infer<typeof componentHealthSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(SYSTEM_STATUSES),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
  components: z.array(componentHealthSchema),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
