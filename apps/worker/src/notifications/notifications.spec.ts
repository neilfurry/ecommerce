import { fillTemplate, notificationEmail } from '../mail/templates';
import { maskEmail } from './notification-dispatcher';
import { maskEndpoint, MockPushProvider } from './push-provider';

describe('notification templates', () => {
  it('fills {{variables}} and leaves unknown ones empty', () => {
    expect(
      fillTemplate('Hi {{ firstName }}, order {{orderNumber}}{{missing}}', {
        firstName: 'Ana',
        orderNumber: 'MP1',
      }),
    ).toBe('Hi Ana, order MP1');
  });

  it('renders template emails in the shared layout with escaped values', () => {
    const email = notificationEmail(
      'Shipped',
      'Hi <Ana>,\n\nYour parcel is on its way.',
      'https://shop.test/o/1',
    );
    expect(email.html).toContain('Hi &lt;Ana&gt;,');
    expect(email.html).toContain('https://shop.test/o/1');
    expect(email.text).toContain('Your parcel is on its way.');
  });

  it('masks destinations for the delivery log', () => {
    expect(maskEmail('juan.cruz@example.com')).toBe('j***@example.com');
    expect(maskEndpoint('https://fcm.googleapis.com/fcm/send/abcdef123456')).toBe(
      'fcm.googleapis.com/…123456',
    );
  });

  it('keeps mock push messages for inspection', async () => {
    const push = new MockPushProvider();
    await push.send({ endpoint: 'https://push.test/x', title: 'T', body: 'B', link: null });
    expect(push.sent).toHaveLength(1);
  });
});
