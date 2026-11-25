import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Button } from '../components/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/form';
import { Input } from '../components/input';
import { Breadcrumbs } from './breadcrumbs';
import { ConfirmDialog } from './confirm-dialog';
import { DataTable } from './data-table';
import { Pagination, pageWindow } from './pagination';

describe('pageWindow', () => {
  it.each([
    [1, 1, [1]],
    [1, 3, [1, 2, 3]],
    [6, 20, [1, 'gap', 5, 6, 7, 'gap', 20]],
    [1, 20, [1, 2, 'gap', 20]],
    [20, 20, [1, 'gap', 19, 20]],
  ])('page %i of %i', (page, total, expected) => {
    expect(pageWindow(page, total)).toEqual(expected);
  });
});

describe('Pagination', () => {
  it('summarises the range and navigates', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageSize={10} totalItems={35} onPageChange={onPageChange} />);
    expect(screen.getByText('Showing 11–20 of 35')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(onPageChange.mock.calls).toEqual([[3], [4]]);
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  });

  it('disables previous on the first page and next on the last', () => {
    const { rerender } = render(
      <Pagination page={1} pageSize={10} totalItems={20} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    rerender(<Pagination page={2} pageSize={10} totalItems={20} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});

describe('ConfirmDialog', () => {
  it('runs the action and closes when it succeeds', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDialog
        trigger={<Button>Delete</Button>}
        title="Delete file?"
        description="This cannot be undone."
        confirmLabel="Delete file"
        destructive
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('This cannot be undone.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete file' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('stays open when the action fails, so the user can retry', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('network'));
    render(
      <ConfirmDialog
        trigger={<Button>Retry job</Button>}
        title="Retry?"
        description="x"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry job' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirm' }),
    );
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('closes on cancel without running the action', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        trigger={<Button>Open</Button>}
        title="Sure?"
        description="x"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('DataTable', () => {
  const columns = [
    { id: 'name', header: 'Name', cell: (row: { id: string; name: string }) => row.name },
    { id: 'id', header: 'ID', cell: (row: { id: string }) => row.id, hideOnMobile: true },
  ];

  it('shows a loading skeleton', () => {
    render(
      <DataTable
        label="Things"
        columns={columns}
        rows={undefined}
        getRowId={(r) => r.id}
        isLoading
        empty={{ title: 'None' }}
      />,
    );
    expect(screen.getByRole('table', { name: 'Things' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders rows', () => {
    render(
      <DataTable
        label="Things"
        columns={columns}
        rows={[{ id: 'a1', name: 'Rice' }]}
        getRowId={(r) => r.id}
        isLoading={false}
        empty={{ title: 'None' }}
      />,
    );
    expect(screen.getByRole('cell', { name: 'Rice' })).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(
      <DataTable
        label="Things"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        isLoading={false}
        empty={{ icon: InboxIcon, title: 'No things yet' }}
      />,
    );
    expect(screen.getByText('No things yet')).toBeInTheDocument();
  });

  it('shows the error state with a retry action', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        label="Things"
        columns={columns}
        rows={undefined}
        getRowId={(r) => r.id}
        isLoading={false}
        error={{ message: 'Server unavailable' }}
        onRetry={onRetry}
        empty={{ title: 'None' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('Breadcrumbs', () => {
  it('links ancestors and marks the current page', () => {
    render(
      <MemoryRouter>
        <Breadcrumbs
          items={[
            { label: 'Admin', to: '/' },
            { label: 'Developer tools', to: '/dev' },
            { label: 'Jobs' },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Jobs')).toHaveAttribute('aria-current', 'page');
  });
});

describe('Form (React Hook Form + Zod)', () => {
  const schema = z.object({ email: z.email('Enter a valid email address') });

  function EmailForm({ onSubmit }: { onSubmit: (values: z.infer<typeof schema>) => void }) {
    const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: '' } });
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Send</Button>
        </form>
      </Form>
    );
  }

  it('shows the schema message and marks the field invalid', async () => {
    const onSubmit = vi.fn();
    render(<EmailForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits parsed values', async () => {
    const onSubmit = vi.fn();
    render(<EmailForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Email'), 'buyer@example.ph');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ email: 'buyer@example.ph' });
  });
});

describe('formatMoney', () => {
  it('formats API decimal strings as pesos', async () => {
    const { formatMoney } = await import('../lib/money');
    expect(formatMoney('1499.5')).toBe('₱1,499.50');
    expect(formatMoney('390.00')).toBe('₱390.00');
    expect(formatMoney(null)).toBe('—');
  });
});
