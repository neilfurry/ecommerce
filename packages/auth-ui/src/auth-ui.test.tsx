import {
  ApiClientProvider,
  ApiError,
  createApiClient,
  createQueryClient,
} from '@marketplace/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { applyApiErrors } from './form-errors';
import { RequirePermission, RequireSession } from './guards';
import { StaffSignInPage } from './pages';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const session = {
  user: {
    id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
    firstName: 'Ana',
    lastName: 'Reyes',
    email: 'ana@example.ph',
    emailVerified: true,
    mobile: null,
    mobileVerified: false,
    roles: ['CUSTOMER_SUPPORT'],
    permissions: ['users.read'],
    wholesaleStatus: null,
  },
  app: 'admin',
  accessTokenExpiresAt: '2026-11-25T09:15:00.000Z',
};
const unauthenticated = () =>
  json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in', statusCode: 401 } }, 401);

function renderRoutes(fetchImpl: typeof fetch, initial: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const router = createMemoryRouter(
    [
      {
        path: '/sign-in',
        element: <StaffSignInPage brand={<span>Brand</span>} appName="Admin Console" />,
      },
      {
        element: <RequireSession />,
        children: [
          {
            path: '/users',
            element: <RequirePermission permission="users.read">Users page</RequirePermission>,
          },
          {
            path: '/roles',
            element: <RequirePermission permission="roles.update">Roles page</RequirePermission>,
          },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={createApiClient({ baseUrl: '/api', app: 'admin', fetchImpl })}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('route guards', () => {
  it('sends signed-out users to sign-in, then back to the page they wanted', async () => {
    let signedIn = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/csrf')) return json({ csrfToken: 't' });
      if (url.endsWith('/auth/sign-in')) {
        signedIn = true;
        return json(session);
      }
      if (url.endsWith('/auth/session')) return signedIn ? json(session) : unauthenticated();
      return unauthenticated();
    });
    const router = renderRoutes(fetchImpl as unknown as typeof fetch, '/users');
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Admin Console' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');

    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Users page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/users');
  });

  it('shows the sign-in error and clears the password', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/csrf')) return json({ csrfToken: 't' });
      if (url.endsWith('/auth/sign-in')) {
        return json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Incorrect email or password.',
              statusCode: 401,
            },
          },
          401,
        );
      }
      return unauthenticated();
    });
    renderRoutes(fetchImpl as unknown as typeof fetch, '/sign-in');
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('hides pages the user has no permission for', async () => {
    const fetchImpl = vi.fn(async () => json(session));
    renderRoutes(fetchImpl as unknown as typeof fetch, '/roles');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByText('Roles page')).not.toBeInTheDocument();
  });
});

describe('applyApiErrors', () => {
  function Harness({
    error,
    onResult,
  }: {
    error: unknown;
    onResult: (message: string | null, fields: string[]) => void;
  }) {
    const form = useForm({ defaultValues: { email: '', mobile: '' } });
    return (
      <button
        type="button"
        onClick={() => {
          const message = applyApiErrors(form, error);
          onResult(
            message,
            (['email', 'mobile'] as const).filter((name) => form.getFieldState(name).error),
          );
        }}
      >
        apply
      </button>
    );
  }

  it('puts field errors on their fields and returns the rest as a message', async () => {
    const onResult = vi.fn();
    const error = new ApiError('CONFLICT', 'Already registered.', 409, 'req-1', [
      { path: 'email', message: 'Taken' },
      { path: 'other', message: 'x' },
    ]);
    render(<Harness error={error} onResult={onResult} />);
    await userEvent.click(screen.getByRole('button', { name: 'apply' }));
    expect(onResult).toHaveBeenCalledWith('Already registered.', ['email']);
  });

  it('returns the message and reference for errors without fields', async () => {
    const onResult = vi.fn();
    render(
      <Harness
        error={new ApiError('INTERNAL_ERROR', 'Server error.', 500, 'req-9')}
        onResult={onResult}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'apply' }));
    expect(onResult).toHaveBeenCalledWith('Server error. (ref req-9)', []);
  });
});
