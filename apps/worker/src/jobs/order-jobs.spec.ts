import { EMAIL_JOBS, ORDER_JOBS } from '@marketplace/config';
import type { Job, Queue } from 'bullmq';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../database/database.provider';
import type { MailerService } from '../mail/mailer.service';
import { orderPlacedTemplate, sellerNewOrderTemplate } from '../mail/templates';
import {
  OrderCancelledEmailHandler,
  OrderPlacedEmailHandler,
  SellerNewOrderEmailHandler,
} from './transactional-email.handlers';
import { ExpireUnpaidOrdersHandler } from './unpaid-order-sweep';
import type { PaymentReconciler } from './payment-reconciliation';

jest.mock('@marketplace/database', () => ({ expireUnpaidOrders: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked module
const { expireUnpaidOrders } = require('@marketplace/database') as {
  expireUnpaidOrders: jest.Mock;
};

const job = (data: unknown) => ({ id: '1', name: 'x', data }) as unknown as Job;
const placed = {
  to: 'juan@example.com',
  firstName: 'Juan',
  orderNumber: 'MP261125ABCDEF',
  status: 'PLACED' as const,
  paymentMethod: 'Cash on delivery',
  paymentDueAt: null,
  grandTotal: '36447.00',
  sellers: [
    {
      storeName: 'Isla Tech',
      lines: [
        { productName: 'Aero 14', variantTitle: '512 GB', quantity: 1, lineTotal: '32999.00' },
      ],
    },
    {
      storeName: 'Click & Type',
      lines: [
        { productName: 'Mouse', variantTitle: 'Default', quantity: 1, lineTotal: '599.00' },
        {
          productName: '<b>Keyboard</b>',
          variantTitle: 'Default',
          quantity: 1,
          lineTotal: '2499.00',
        },
      ],
    },
  ],
  address: '45 Kalayaan Street, Bagong Pag-asa, Quezon City, Metro Manila, 1105',
  link: 'http://localhost:5173/account/orders/1',
};

describe('order emails', () => {
  const send = jest.fn().mockResolvedValue({ messageId: 'm1', accepted: ['juan@example.com'] });
  const mailer = { send } as unknown as MailerService;
  beforeEach(() => send.mockClear());

  it('lists every store’s items, the total and the address, escaped in HTML', () => {
    const email = orderPlacedTemplate(placed);
    expect(email.subject).toBe('Order MP261125ABCDEF placed');
    expect(email.text).toContain('From Click & Type:');
    expect(email.text).toContain('1 × Aero 14 (512 GB): ₱32,999.00');
    expect(email.text).toContain('₱36,447.00');
    expect(email.text).toContain('Each store ships its items separately');
    expect(email.html).toContain('&lt;b&gt;Keyboard&lt;/b&gt;');
    expect(email.html).not.toContain('<b>Keyboard</b>');
  });

  it('tells the customer the payment deadline of an unpaid order', () => {
    const email = orderPlacedTemplate({
      ...placed,
      status: 'AWAITING_PAYMENT',
      paymentMethod: 'GCash',
      paymentDueAt: '2026-11-25T09:00:00.000Z',
    });
    expect(email.subject).toBe('Order MP261125ABCDEF: waiting for payment');
    expect(email.text).toMatch(/Please pay ₱36,447\.00 by GCash before Nov 25, 2026, 5:00\s?PM/);
  });

  it('warns sellers not to ship orders that are not paid yet', () => {
    const email = sellerNewOrderTemplate({
      to: 'shop@example.com',
      businessName: 'Click & Type',
      number: 'MP261125ABCDEF-2',
      paymentMethod: 'GCash',
      awaitingPayment: true,
      total: '3183.00',
      lines: placed.sellers[1]!.lines,
      link: 'http://localhost:5174/orders/2',
    });
    expect(email.subject).toBe('New order MP261125ABCDEF-2');
    expect(email.text).toContain('Do not ship it until it is paid.');
  });

  it('registers handlers for each order email and refuses bad payloads', async () => {
    expect(new OrderPlacedEmailHandler(mailer).jobName).toBe(EMAIL_JOBS.ORDER_PLACED);
    expect(new SellerNewOrderEmailHandler(mailer).jobName).toBe(EMAIL_JOBS.SELLER_NEW_ORDER);
    const cancelled = new OrderCancelledEmailHandler(mailer);
    await cancelled.handle(
      job({
        to: 'juan@example.com',
        firstName: 'Juan',
        orderNumber: 'MP1',
        reason: 'Payment was not received in time.',
        link: 'http://localhost:5173/x',
      }),
    );
    expect((send.mock.calls[0]![0] as { text: string }).text).toContain(
      'You have not been charged.',
    );
    await expect(
      new OrderPlacedEmailHandler(mailer).handle(job({ to: 'juan@example.com' })),
    ).rejects.toThrow();
  });
});

describe('unpaid order sweep', () => {
  const add = jest.fn();
  const queue = { add } as unknown as Queue;
  const config = { storefrontUrl: 'http://localhost:5173' } as WorkerConfig;
  const run = jest.fn();
  const expire = jest.fn();
  const reconciler = {
    run,
    gateway: (provider: string) => (provider === 'MOCK' ? { expire } : null),
  } as unknown as PaymentReconciler;
  beforeEach(() => {
    expireUnpaidOrders.mockReset();
    add.mockReset();
    run.mockReset().mockResolvedValue({ checked: 0, paid: 0, closed: 0 });
    expire.mockReset().mockResolvedValue(undefined);
  });

  it('cancels overdue orders and emails each customer', async () => {
    expireUnpaidOrders.mockResolvedValue([
      {
        id: 'o1',
        orderNumber: 'MP1',
        customerEmail: 'a@example.com',
        customerFirstName: 'Ana',
        moneyReceived: false,
        closedPayments: [{ provider: 'MOCK', providerReference: 'cs_mock_1' }],
      },
      {
        id: 'o2',
        orderNumber: 'MP2',
        customerEmail: 'b@example.com',
        customerFirstName: 'Ben',
        moneyReceived: false,
        closedPayments: [],
      },
    ]);
    const handler = new ExpireUnpaidOrdersHandler(
      { client: {} } as WorkerDatabase,
      config,
      queue,
      reconciler,
    );
    expect(handler.jobName).toBe(ORDER_JOBS.EXPIRE_UNPAID_ORDERS);
    await expect(handler.handle()).resolves.toEqual({ cancelled: 2 });
    // Providers are asked before anything expires, and the closed checkout is expired there.
    expect(run).toHaveBeenCalledWith({ dueOnly: true });
    expect(expire).toHaveBeenCalledWith('cs_mock_1');
    expect(add).toHaveBeenCalledWith(
      EMAIL_JOBS.ORDER_CANCELLED,
      expect.objectContaining({
        to: 'a@example.com',
        orderNumber: 'MP1',
        link: 'http://localhost:5173/account/orders/o1',
      }),
    );
  });

  it('does nothing without a database', async () => {
    const handler = new ExpireUnpaidOrdersHandler(
      { client: null } as WorkerDatabase,
      config,
      queue,
      reconciler,
    );
    await expect(handler.handle()).resolves.toEqual({ cancelled: 0 });
    expect(expireUnpaidOrders).not.toHaveBeenCalled();
  });
});
