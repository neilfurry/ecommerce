import { createApiClient, createQueryClient } from '@marketplace/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { buildRoutes } from '../../app/routes';

const now = '2026-11-24T09:00:00.000Z';
const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

const queues = {
  queues: ['system', 'email', 'dead-letter'].map((name) => ({
    name,
    description: `${name} queue`,
    attempts: name === 'dead-letter' ? 1 : 3,
    backoffDelayMs: 1000,
    counts: { waiting: 0, active: 0, delayed: 0, completed: 4, failed: 1 },
  })),
};
const deadLetter = {
  id: 'system__7',
  sourceQueue: 'system',
  sourceJobId: '7',
  jobName: 'system.dev-sample',
  data: { message: 'boom' },
  failedReason: 'Simulated failure on attempt 3 of 5',
  attemptsMade: 3,
  failedAt: now,
};
const storedFile = {
  id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
  originalName: 'invoice.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  checksumSha256: 'a'.repeat(64),
  purpose: 'DEV_TEST',
  status: 'AVAILABLE',
  createdAt: now,
  updatedAt: now,
};
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 10,
  totalItems: items.length,
  totalPages: 1,
});

/** A tiny fake of the dev-tools API, routed by method + path. */
function fakeApi(overrides: Record<string, () => Response> = {}) {
  const deadLetters = [deadLetter];
  const routes: Record<string, () => Response> = {
    'GET /api/v1/auth/csrf': () => json({ csrfToken: 'csrf-test' }),
    'GET /api/v1/dev/queues': () => json(queues),
    'GET /api/v1/dev/dead-letters': () => json(page(deadLetters)),
    'POST /api/v1/dev/jobs/sample': () => json({ queue: 'system', jobId: '42' }, 202),
    'GET /api/v1/dev/jobs/system/42': () =>
      json({
        queue: 'system',
        jobId: '42',
        name: 'system.dev-sample',
        state: 'completed',
        attemptsMade: 1,
        maxAttempts: 3,
        progress: 100,
        returnValue: { message: 'Hello', attempt: 1, processedAt: now },
        failedReason: null,
        createdAt: now,
        processedAt: now,
        finishedAt: now,
      }),
    'DELETE /api/v1/dev/dead-letters/system__7': () => {
      deadLetters.length = 0;
      return json(undefined, 204);
    },
    'GET /api/v1/dev/files': () => json(page([storedFile])),
    'POST /api/v1/dev/files': () => json(storedFile, 201),
    ...overrides,
  };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]!;
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return handler
      ? handler()
      : json({ error: { code: 'NOT_FOUND', message: 'nope', statusCode: 404 } }, 404);
  });
}

function renderAt(path: string, fetchImpl: ReturnType<typeof fakeApi>, devTools = true) {
  const router = createMemoryRouter(buildRoutes(devTools), { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  render(
    <AppProviders
      apiClient={createApiClient({
        baseUrl: '/api',
        app: 'admin',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('Background jobs page', () => {
  it('runs the sample job and shows its live status', async () => {
    const api = fakeApi();
    renderAt('/dev-tools/jobs', api);
    await userEvent.click(await screen.findByRole('button', { name: /run job/i }));
    expect(await screen.findByTestId('job-state')).toHaveTextContent('Completed');
    const call = api.mock.calls.find(([url]) => url === '/api/v1/dev/jobs/sample');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      message: 'Hello from the Admin Console',
      simulateFailures: 0,
      durationMs: 1500,
    });
  });

  it('validates the form with the shared schema before calling the API', async () => {
    const api = fakeApi();
    renderAt('/dev-tools/jobs', api);
    const message = await screen.findByLabelText('Message');
    await userEvent.clear(message);
    await userEvent.click(screen.getByRole('button', { name: /run job/i }));
    expect(await screen.findByText('Enter a message')).toBeInTheDocument();
    expect(api.mock.calls.some(([url]) => url === '/api/v1/dev/jobs/sample')).toBe(false);
  });

  it('lists queues and dead letters, and discards after confirmation', async () => {
    renderAt('/dev-tools/jobs', fakeApi());
    expect(await screen.findByRole('cell', { name: /email queue/ })).toBeInTheDocument();
    const deadLetters = await screen.findByRole('table', { name: 'Dead letters' });
    expect(
      within(deadLetters).getByText('Simulated failure on attempt 3 of 5'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard system__7' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('No dead letters')).toBeInTheDocument();
  });

  it('shows breadcrumbs', async () => {
    renderAt('/dev-tools/jobs', fakeApi());
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Background jobs')).toHaveAttribute('aria-current', 'page');
  });
});

describe('File storage page', () => {
  it('lists files and uploads a new one', async () => {
    const api = fakeApi();
    renderAt('/dev-tools/files', api);
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument();

    const file = new File(['%PDF-1.7'], 'invoice.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('File'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([url, init]) => url === '/api/v1/dev/files' && init?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('requires a file', async () => {
    renderAt('/dev-tools/files', fakeApi());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('Choose a file to upload')).toBeInTheDocument();
  });
});

describe('when developer tools are disabled', () => {
  it('hides the navigation and routes', async () => {
    renderAt('/dev-tools/jobs', fakeApi(), false);
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Background jobs' })).not.toBeInTheDocument();
  });
});
