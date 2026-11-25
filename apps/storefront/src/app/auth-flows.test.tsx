import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { routes } from './routes';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const apiError = (code: string, message: string, statusCode: number, fieldErrors?: unknown[]) =>
  json({ error: { code, message, statusCode, fieldErrors } }, statusCode);

const challenge = {
  challengeId: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
  destination: '+63 917 *** 4567',
  expiresAt: '2099-01-01T00:05:00.000Z',
  resendAvailableAt: '2000-01-01T00:00:00.000Z',
};
const session = (overrides: Record<string, unknown> = {}) => ({
  user: {
    id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6f',
    firstName: 'Maria',
    lastName: 'Santos',
    email: 'maria@example.ph',
    emailVerified: false,
    mobile: '+639171234567',
    mobileVerified: true,
    roles: ['CUSTOMER'],
    permissions: [],
    wholesaleStatus: null,
    mfaEnabled: false,
    seller: null,
    ...overrides,
  },
  app: 'storefront',
  accessTokenExpiresAt: '2099-01-01T00:15:00.000Z',
});

type Handler = (body: unknown) => Response;

/** Fake API: routes by method + path; starts signed out until a handler signs in. */
function fakeApi(handlers: Record<string, Handler>) {
  const state = { signedIn: false, calls: [] as { route: string; body: unknown }[] };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!.replace('/api/v1', '');
    const route = `${init?.method ?? 'GET'} ${path}`;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    state.calls.push({ route, body });
    if (route === 'GET /auth/csrf') return json({ csrfToken: 'csrf' });
    const handler = handlers[route];
    if (handler) return handler(body);
    if (route === 'GET /auth/session') {
      return state.signedIn ? json(session()) : apiError('UNAUTHENTICATED', 'Sign in', 401);
    }
    if (route === 'GET /account/wholesale-application') return json({ application: null });
    if (route === 'GET /cart')
      return json({
        groups: [],
        saved: [],
        itemCount: 0,
        subtotal: '0.00',
        wholesaleSavings: '0.00',
        currency: 'PHP',
        buyerIsWholesale: false,
        ready: false,
      });
    return apiError('NOT_FOUND', 'Not found', 404);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, state };
}

function renderAt(path: string, fetchImpl: typeof fetch) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  render(
    <AppProviders
      apiClient={createApiClient({ baseUrl: '/api', app: 'storefront', fetchImpl })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('customer sign-up', () => {
  it('collects details, confirms the SMS code and opens the account', async () => {
    const api = fakeApi({
      'POST /auth/customers/sign-up': () => json(challenge, 202),
      'POST /auth/customers/sign-up/verify': (body) => {
        if ((body as { code: string }).code !== '123456') {
          return apiError('OTP_INVALID', 'That code is not correct. 4 attempts left.', 400);
        }
        api.state.signedIn = true;
        return json(session(), 201);
      },
    });
    const router = renderAt('/sign-up', api.fetchImpl);

    await userEvent.type(await screen.findByLabelText('First name'), 'Maria');
    await userEvent.type(screen.getByLabelText('Last name'), 'Santos');
    await userEvent.type(screen.getByRole('textbox', { name: 'Mobile number' }), '0917 123 4567');
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'Maria@Example.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/We sent a 6-digit code to/)).toHaveTextContent(
      '+63 917 *** 4567',
    );
    const sent = api.state.calls.find((c) => c.route === 'POST /auth/customers/sign-up')?.body;
    // Normalised by the shared schema before sending; no business details for retail.
    expect(sent).toMatchObject({
      mobile: '+639171234567',
      email: 'maria@example.ph',
      accountType: 'RETAIL',
    });
    expect(sent).not.toHaveProperty('business');

    await userEvent.type(screen.getByLabelText('Code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('4 attempts left');
    expect(screen.getByLabelText('Code')).toHaveValue('');

    await userEvent.type(screen.getByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Hello, Maria' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account');
    expect(screen.getByTestId('account-type')).toHaveTextContent('Retail');
    await userEvent.click(screen.getByRole('link', { name: 'Profile and security' }));
    expect(await screen.findByText('Not confirmed')).toBeInTheDocument();
  });

  it('asks for business details only for wholesale accounts and shows API field errors', async () => {
    const api = fakeApi({
      'POST /auth/customers/sign-up': () =>
        apiError('CONFLICT', 'An account with these details already exists.', 409, [
          { path: 'email', message: 'This email is already registered. Sign in instead.' },
        ]),
    });
    renderAt('/sign-up', api.fetchImpl);
    expect(await screen.findByLabelText('First name')).toBeInTheDocument();
    expect(screen.queryByLabelText('TIN')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Business \(wholesale\)/));
    expect(screen.getByLabelText('TIN')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('First name'), 'Jose');
    await userEvent.type(screen.getByLabelText('Last name'), 'Rizal');
    await userEvent.type(screen.getByRole('textbox', { name: 'Mobile number' }), '09171234567');
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'jose@example.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter a valid TIN, e.g. 123-456-789-000')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Registered business name'), 'Rizal Trading');
    await userEvent.type(screen.getByLabelText('TIN'), '123-456-789-000');
    await userEvent.type(screen.getByLabelText('Business address'), '12 Rizal Ave, Manila City');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText('This email is already registered. Sign in instead.'),
    ).toBeInTheDocument();
  });
});

describe('customer sign-in', () => {
  it('signs in with a mobile number and SMS code, then returns to the page that asked', async () => {
    const api = fakeApi({
      'POST /auth/customers/sign-in/otp': () => json(challenge, 202),
      'POST /auth/customers/sign-in/otp/verify': () => {
        api.state.signedIn = true;
        return json(session({ emailVerified: true }));
      },
    });
    const router = renderAt('/account', api.fetchImpl);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Mobile number' }), '0917 123 4567');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await userEvent.type(await screen.findByLabelText('Code'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Hello, Maria' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account');
  });

  it('offers email and password as the other method', async () => {
    const api = fakeApi({
      'POST /auth/sign-in': () =>
        apiError(
          'EMAIL_NOT_VERIFIED',
          'Verify your email address first, or sign in with your mobile number.',
          403,
        ),
    });
    renderAt('/sign-in', api.fetchImpl);
    await userEvent.click(await screen.findByRole('tab', { name: 'Email' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'maria@example.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sign in with your mobile number');
  });

  it('shows the account links in the header', async () => {
    const api = fakeApi({});
    renderAt('/', api.fetchImpl);
    const header = await screen.findByRole('banner');
    expect(await within(header).findByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});

describe('email confirmation link', () => {
  it('confirms the address once', async () => {
    const api = fakeApi({ 'POST /auth/email/verify': () => new Response(null, { status: 204 }) });
    renderAt('/verify-email?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', api.fetchImpl);
    expect(await screen.findByText('Email address confirmed')).toBeInTheDocument();
    expect(api.state.calls.filter((c) => c.route === 'POST /auth/email/verify')).toHaveLength(1);
  });
});
