import { zodResolver } from '@hookform/resolvers/zod';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from '@marketplace/ui';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const reasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Explain the reason (at least 5 characters)')
    .max(1000, 'At most 1000 characters'),
});

/** A dialog that asks for a written reason before a consequential action. */
export function ReasonDialog({
  trigger,
  title,
  description,
  label = 'Reason',
  hint,
  submitLabel,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  label?: string;
  hint?: string;
  submitLabel: string;
  /** Rejects to keep the dialog open with the error shown. */
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof reasonSchema>>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  });
  const submit = form.handleSubmit(async ({ reason }) => {
    setFormError(null);
    setPending(true);
    try {
      await onSubmit(reason);
      form.reset();
      setOpen(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    } finally {
      setPending(false);
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  {hint ? <FormDescription>{hint}</FormDescription> : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
