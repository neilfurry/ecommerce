import { APP_NAME } from '@marketplace/config';
import type {
  PasswordResetJob,
  SellerInvitationJob,
  SellerStatusJob,
  StaffInvitationJob,
  VerifyEmailJob,
  WholesaleDecisionJob,
} from '@marketplace/validation';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/** Every value from a job payload goes through this before entering HTML. */
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

interface Layout {
  greeting: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

/** Plain, accessible layout that renders in every mail client (inline styles, one column). */
function render(subject: string, layout: Layout): RenderedEmail {
  const text = [
    layout.greeting,
    '',
    ...layout.paragraphs.flatMap((p) => [p, '']),
    ...(layout.action ? [`${layout.action.label}: ${layout.action.url}`, ''] : []),
    ...(layout.footnote ? [layout.footnote, ''] : []),
    `— ${APP_NAME}`,
  ].join('\n');

  const button = layout.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(layout.action.url)}" style="background:#0f172a;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(layout.action.label)}</a></p>` +
      `<p style="font-size:13px;color:#475569">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(layout.action.url)}</span></p>`
    : '';
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">` +
    `<p style="font-size:18px;font-weight:bold;margin:0 0 24px">${escapeHtml(APP_NAME)}</p>` +
    `<p>${escapeHtml(layout.greeting)}</p>` +
    layout.paragraphs.map((p) => `<p style="line-height:1.5">${escapeHtml(p)}</p>`).join('') +
    button +
    (layout.footnote
      ? `<p style="font-size:13px;color:#475569">${escapeHtml(layout.footnote)}</p>`
      : '') +
    `</div></body></html>`;
  return { subject, text, html };
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

export function verifyEmailTemplate(job: VerifyEmailJob): RenderedEmail {
  return render(`Confirm your email address`, {
    greeting: `Hi ${job.firstName},`,
    paragraphs: [
      `Welcome to ${APP_NAME}! Please confirm that this is your email address so we can send you order updates and receipts.`,
    ],
    action: { label: 'Confirm email address', url: job.link },
    footnote:
      'This link expires in 3 days. If you did not create an account, you can ignore this email.',
  });
}

export function passwordResetTemplate(job: PasswordResetJob): RenderedEmail {
  return render(`Reset your ${APP_NAME} password`, {
    greeting: `Hi ${job.firstName},`,
    paragraphs: [
      'We received a request to reset your password. Choose a new one with the button below.',
    ],
    action: { label: 'Choose a new password', url: job.link },
    footnote:
      `This link expires in ${plural(job.expiresInMinutes, 'minute')} and works once. ` +
      'If you did not ask for this, ignore this email; your password stays the same.',
  });
}

export function staffInvitationTemplate(job: StaffInvitationJob): RenderedEmail {
  return render(`You're invited to the ${APP_NAME} team`, {
    greeting: `Hi ${job.firstName},`,
    paragraphs: [
      `${job.invitedBy} created a staff account for you with the role${job.roles.length === 1 ? '' : 's'}: ${job.roles.join(', ')}.`,
      'Set your password to activate the account.',
    ],
    action: { label: 'Set password and sign in', url: job.link },
    footnote: `This invitation expires in ${plural(job.expiresInHours, 'hour')}. If you were not expecting it, ignore this email.`,
  });
}

export function wholesaleDecisionTemplate(job: WholesaleDecisionJob): RenderedEmail {
  if (job.decision === 'APPROVED') {
    return render('Your wholesale account is approved', {
      greeting: `Hi ${job.firstName},`,
      paragraphs: [
        `Good news: ${job.businessName} is approved for wholesale buying. Wholesale prices now appear when you are signed in.`,
      ],
      action: { label: 'Start shopping', url: job.link },
    });
  }
  return render('About your wholesale application', {
    greeting: `Hi ${job.firstName},`,
    paragraphs: [
      `We could not approve the wholesale application for ${job.businessName}.`,
      ...(job.note ? [`Reason: ${job.note}`] : []),
      'You can keep shopping at retail prices, and you can correct your details and apply again from your account.',
    ],
    action: { label: 'Review my application', url: job.link },
  });
}

const SELLER_STATUS_COPY: Record<
  SellerStatusJob['event'],
  { subject: string; body: string; action: string }
> = {
  SUBMITTED: {
    subject: 'We received your seller application',
    body: 'Thank you. Our team is checking your business details and documents. We will email you when there is a decision.',
    action: 'View application',
  },
  INFO_REQUESTED: {
    subject: 'More information needed for your seller application',
    body: 'Our team needs more information before we can verify your business. Update your application and submit it again.',
    action: 'Update application',
  },
  APPROVED: {
    subject: 'Your seller account is verified',
    body: 'Congratulations! Your business is verified. You can now create your store in the Seller Center.',
    action: 'Create your store',
  },
  REJECTED: {
    subject: 'Your seller application was not approved',
    body: 'We could not verify your business. You can correct your details and documents and submit the application again.',
    action: 'Review application',
  },
  SUSPENDED: {
    subject: 'Your seller account is suspended',
    body: 'Your stores are hidden from shoppers and changes are paused. Contact marketplace support if you have questions.',
    action: 'Open the Seller Center',
  },
  REINSTATED: {
    subject: 'Your seller account is active again',
    body: 'The suspension has been lifted. Your stores can be shown to shoppers again.',
    action: 'Open the Seller Center',
  },
  CLOSED: {
    subject: 'Your seller account is closed',
    body: 'Your seller account has been closed and your stores are no longer available.',
    action: 'Open the Seller Center',
  },
};

export function sellerStatusTemplate(job: SellerStatusJob): RenderedEmail {
  const copy = SELLER_STATUS_COPY[job.event];
  return render(`${copy.subject}: ${job.businessName}`, {
    greeting: `Hi ${job.firstName},`,
    paragraphs: [
      copy.body,
      ...(job.note ? [`Message from the marketplace team: ${job.note}`] : []),
    ],
    action: { label: copy.action, url: job.link },
  });
}

export function sellerInvitationTemplate(job: SellerInvitationJob): RenderedEmail {
  return render(`Join ${job.sellerName} on ${APP_NAME}`, {
    greeting: 'Hello,',
    paragraphs: [
      `${job.invitedBy} invited you to work for ${job.sellerName} in the ${APP_NAME} Seller Center as: ${job.roles.join(', ')}.`,
    ],
    action: { label: 'Accept invitation', url: job.link },
    footnote: `This invitation expires in ${plural(job.expiresInHours, 'hour')}. If you were not expecting it, ignore this email.`,
  });
}

/** SMS body: short, code first (some phones show only the start), and a warning not to share it. */
export function otpSmsBody(code: string, expiresInMinutes: number): string {
  return `${code} is your ${APP_NAME} code. It expires in ${expiresInMinutes} min. Never share this code with anyone, including our staff.`;
}
