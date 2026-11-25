import { EMAIL_JOBS, ORDER_JOBS } from '@marketplace/config';
import type { Job } from 'bullmq';
import type { WorkerDatabase } from '../database/database.provider';
import type { MailerService } from '../mail/mailer.service';
import { lowStockTemplate, productDecisionTemplate } from '../mail/templates';
import { ReleaseExpiredReservationsHandler } from './reservation-sweep';
import { LowStockEmailHandler, ProductDecisionEmailHandler } from './transactional-email.handlers';

jest.mock('@marketplace/database', () => ({
  releaseExpiredReservations: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked module
const { releaseExpiredReservations } = require('@marketplace/database') as {
  releaseExpiredReservations: jest.Mock;
};

const job = (data: unknown, name = 'x') => ({ id: '1', name, data }) as unknown as Job;

describe('catalog and inventory emails', () => {
  const send = jest.fn().mockResolvedValue({ messageId: 'm1', accepted: ['s@example.com'] });
  const mailer = { send } as unknown as MailerService;
  beforeEach(() => send.mockClear());

  it('emails the product decision with the reviewer note', async () => {
    const handler = new ProductDecisionEmailHandler(mailer);
    expect(handler.jobName).toBe(EMAIL_JOBS.PRODUCT_DECISION);
    await handler.handle(
      job({
        to: 'shop@example.com',
        businessName: 'Santos Trading',
        productName: 'Rice 25 kg',
        decision: 'REJECTED',
        note: 'Add a clear photo of the sack.',
        link: 'http://localhost:5174/products/1',
      }),
    );
    const sent = send.mock.calls[0]![0] as { to: string; subject: string; text: string };
    expect(sent.to).toBe('shop@example.com');
    expect(sent.subject).toBe('Product not approved: Rice 25 kg');
    expect(sent.text).toContain('Add a clear photo of the sack.');
  });

  it('lists every low-stock item, and escapes names in HTML', () => {
    const email = lowStockTemplate({
      to: 'shop@example.com',
      businessName: 'Santos <Trading>',
      items: [
        {
          productName: 'Rice',
          variantTitle: 'Default',
          sku: 'R-1',
          warehouse: 'Main (QC-1)',
          available: 3,
          threshold: 10,
        },
        {
          productName: 'Oil',
          variantTitle: '1 L',
          sku: 'O-1',
          warehouse: 'Main (QC-1)',
          available: 0,
          threshold: 5,
        },
      ],
      link: 'http://localhost:5174/inventory?lowStock=true',
    });
    expect(email.subject).toBe('Low stock: 2 items');
    expect(email.text).toContain('Rice — Default (R-1) in Main (QC-1): 3 available (alert at 10).');
    expect(email.html).toContain('Santos &lt;Trading&gt;');
    expect(email.html).not.toContain('<Trading>');
  });

  it('dead-letters an invalid low-stock payload at once', async () => {
    await expect(
      new LowStockEmailHandler(mailer).handle(job({ to: 'x@example.com', items: [] })),
    ).rejects.toThrow(/Invalid/);
  });

  it('has copy for every product decision', () => {
    for (const decision of ['APPROVED', 'REJECTED', 'TAKEN_DOWN'] as const) {
      const email = productDecisionTemplate({
        to: 'a@example.com',
        businessName: 'B',
        productName: 'P',
        decision,
        note: null,
        link: 'http://localhost/x',
      });
      expect(email.subject).toMatch(/: P$/);
    }
  });
});

describe('reservation expiry sweep', () => {
  beforeEach(() => releaseExpiredReservations.mockReset());

  it('releases in batches until nothing is due', async () => {
    releaseExpiredReservations.mockResolvedValueOnce(500).mockResolvedValueOnce(120);
    const handler = new ReleaseExpiredReservationsHandler({ client: {} } as WorkerDatabase);
    expect(handler.jobName).toBe(ORDER_JOBS.RELEASE_EXPIRED_RESERVATIONS);
    await expect(handler.handle()).resolves.toEqual({ expired: 620 });
    expect(releaseExpiredReservations).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a database', async () => {
    const handler = new ReleaseExpiredReservationsHandler({ client: null } as WorkerDatabase);
    await expect(handler.handle()).resolves.toEqual({ expired: 0 });
    expect(releaseExpiredReservations).not.toHaveBeenCalled();
  });
});
