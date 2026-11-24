import { EMAIL_JOBS, NOTIFICATION_JOBS } from '@marketplace/config';
import { type Job, UnrecoverableError } from 'bullmq';
import type { MailerService } from '../mail/mailer.service';
import { escapeHtml, otpSmsBody, wholesaleDecisionTemplate } from '../mail/templates';
import { deadLetterSafeData } from '../queues/dead-letter.service';
import { PermanentSmsError, type SmsProvider } from '../sms/sms-provider';
import { SmsOtpHandler } from './sms-otp.handler';
import {
  PasswordResetEmailHandler,
  SellerInvitationEmailHandler,
  SellerStatusEmailHandler,
  StaffInvitationEmailHandler,
  VerifyEmailHandler,
  WholesaleDecisionEmailHandler,
} from './transactional-email.handlers';

const job = (data: unknown, name = 'x') => ({ id: '1', name, data }) as unknown as Job;

describe('transactional email handlers', () => {
  const send = jest.fn().mockResolvedValue({ messageId: 'm1', accepted: ['a@example.com'] });
  const mailer = { send } as unknown as MailerService;
  beforeEach(() => send.mockClear());

  it.each([
    [
      new VerifyEmailHandler(mailer),
      EMAIL_JOBS.VERIFY_ADDRESS,
      { link: 'http://localhost:5173/verify-email?token=abc' },
      'Confirm your email',
    ],
    [
      new PasswordResetEmailHandler(mailer),
      EMAIL_JOBS.PASSWORD_RESET,
      { link: 'http://localhost:5173/reset?token=abc', expiresInMinutes: 30 },
      'Reset your',
    ],
    [
      new StaffInvitationEmailHandler(mailer),
      EMAIL_JOBS.STAFF_INVITATION,
      {
        link: 'http://localhost:5175/accept-invitation?token=abc',
        invitedBy: 'Super Admin',
        roles: ['Customer support'],
        expiresInHours: 168,
      },
      'invited',
    ],
    [
      new WholesaleDecisionEmailHandler(mailer),
      EMAIL_JOBS.WHOLESALE_DECISION,
      {
        decision: 'APPROVED',
        businessName: 'Acme',
        note: null,
        link: 'http://localhost:5173/account',
      },
      'approved',
    ],
  ] as const)('%#: %s renders and sends', async (handler, jobName, extra, subject) => {
    expect(handler.jobName).toBe(jobName);
    await handler.handle(job({ to: 'a@example.com', firstName: 'Ana', ...extra }));
    const email = send.mock.calls[0]![0] as {
      to: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(email.to).toBe('a@example.com');
    expect(email.subject).toContain(subject);
    expect(email.text).toContain(extra.link);
    expect(email.html).toContain('Ana');
  });

  it('renders seller status emails with the note from the marketplace team', async () => {
    await new SellerStatusEmailHandler(mailer).handle(
      job({
        to: 'owner@example.ph',
        firstName: 'Lito',
        businessName: 'Lito Trading',
        event: 'INFO_REQUESTED',
        note: 'Please upload a clearer permit.',
        link: 'http://localhost:5174/verification',
      }),
    );
    const email = send.mock.calls[0]![0] as { subject: string; text: string };
    expect(email.subject).toBe('More information needed for your seller application: Lito Trading');
    expect(email.text).toContain('Please upload a clearer permit.');
    expect(email.text).toContain('http://localhost:5174/verification');
  });

  it('renders seller invitations', async () => {
    await new SellerInvitationEmailHandler(mailer).handle(
      job({
        to: 'new.staff@example.ph',
        sellerName: 'Lito Trading',
        invitedBy: 'Lito Santos',
        roles: ['Seller encoder'],
        link: 'http://localhost:5174/join?token=abc',
        expiresInHours: 168,
      }),
    );
    const email = send.mock.calls[0]![0] as { subject: string; text: string };
    expect(email.subject).toContain('Join Lito Trading');
    expect(email.text).toContain('Seller encoder');
    expect(email.text).toContain('168 hours');
  });

  it('dead-letters invalid payloads immediately', async () => {
    await expect(
      new VerifyEmailHandler(mailer).handle(job({ to: 'not-an-email' })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(send).not.toHaveBeenCalled();
  });

  it('escapes user-supplied text in HTML', () => {
    const email = wholesaleDecisionTemplate({
      to: 'a@example.com',
      firstName: '<script>alert(1)</script>',
      decision: 'REJECTED',
      businessName: 'A & B "Trading"',
      note: '<b>bad TIN</b>',
      link: 'http://localhost:5173/account',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;b&gt;bad TIN&lt;/b&gt;');
    expect(email.html).toContain('A &amp; B &quot;Trading&quot;');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
});

describe('SmsOtpHandler', () => {
  const data = { to: '+639171234567', code: '042137', expiresInMinutes: 5 };

  it('texts the code and keeps it out of the job result', async () => {
    const send = jest.fn().mockResolvedValue({ provider: 'mock', messageId: null });
    const result = await new SmsOtpHandler({ name: 'mock', send } as unknown as SmsProvider).handle(
      job(data, NOTIFICATION_JOBS.SMS_OTP),
    );
    expect(send).toHaveBeenCalledWith({ to: '+639171234567', body: otpSmsBody('042137', 5) });
    expect(JSON.stringify(result)).not.toContain('042137');
    expect(result.to).toBe('+63 917 *** 4567');
  });

  it('dead-letters permanent provider failures and retries transient ones', async () => {
    const permanent = new SmsOtpHandler({
      send: jest.fn().mockRejectedValue(new PermanentSmsError('bad key')),
    } as unknown as SmsProvider);
    await expect(permanent.handle(job(data))).rejects.toBeInstanceOf(UnrecoverableError);
    const transient = new SmsOtpHandler({
      send: jest.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as SmsProvider);
    const error = await transient.handle(job(data)).catch((e: Error) => e);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  it('rejects malformed payloads', async () => {
    const handler = new SmsOtpHandler({ send: jest.fn() } as unknown as SmsProvider);
    await expect(handler.handle(job({ ...data, code: '12' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('starts the SMS with the code and warns against sharing it', () => {
    const body = otpSmsBody('123456', 5);
    expect(body.startsWith('123456')).toBe(true);
    expect(body).toMatch(/never share/i);
    expect(body.length).toBeLessThanOrEqual(160);
  });
});

describe('deadLetterSafeData', () => {
  it('removes one-time codes before a job is kept as a dead letter', () => {
    expect(
      deadLetterSafeData(NOTIFICATION_JOBS.SMS_OTP, { to: '+639171234567', code: '123456' }),
    ).toEqual({
      to: '+639171234567',
      code: '[removed]',
    });
    expect(deadLetterSafeData(EMAIL_JOBS.DEV_TEST, { to: 'a@b.co' })).toEqual({ to: 'a@b.co' });
  });
});
