import { z } from 'zod';

/**
 * Payloads of the email and SMS jobs the API enqueues and the worker sends.
 * Links are built by the API (which knows the frontend URLs); the worker only renders.
 */
const recipient = { to: z.email(), firstName: z.string() };

export const verifyEmailJobSchema = z.object({ ...recipient, link: z.url() });
export const passwordResetJobSchema = z.object({
  ...recipient,
  link: z.url(),
  expiresInMinutes: z.number().int(),
});
export const staffInvitationJobSchema = z.object({
  ...recipient,
  link: z.url(),
  invitedBy: z.string(),
  roles: z.array(z.string()),
  expiresInHours: z.number().int(),
});
export const wholesaleDecisionJobSchema = z.object({
  ...recipient,
  decision: z.enum(['APPROVED', 'REJECTED']),
  businessName: z.string(),
  note: z.string().nullable(),
  link: z.url(),
});
export const smsOtpJobSchema = z.object({
  /** E.164 */
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  code: z.string().regex(/^\d{6}$/),
  expiresInMinutes: z.number().int(),
});

export type VerifyEmailJob = z.infer<typeof verifyEmailJobSchema>;
export type PasswordResetJob = z.infer<typeof passwordResetJobSchema>;
export type StaffInvitationJob = z.infer<typeof staffInvitationJobSchema>;
export type WholesaleDecisionJob = z.infer<typeof wholesaleDecisionJobSchema>;
export type SmsOtpJob = z.infer<typeof smsOtpJobSchema>;
