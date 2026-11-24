import { zodResolver } from '@hookform/resolvers/zod';
import { useResendCode } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from '@marketplace/ui';
import { type OtpChallengeResponse, otpCodeSchema } from '@marketplace/validation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const codeFormSchema = z.object({ code: otpCodeSchema });

const secondsUntil = (iso: string) =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));

function useSecondsUntil(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // `now` only drives re-rendering once a second.
  void now;
  return secondsUntil(iso);
}

/**
 * Second step of SMS sign-up and sign-in: enter the 6-digit code. Codes expire after
 * 5 minutes; a new one can be requested after a short wait.
 */
export function OtpStep({
  challenge,
  onChallengeChange,
  onSubmit,
  pending,
  submitLabel,
  onBack,
  backLabel,
}: {
  challenge: OtpChallengeResponse;
  onChallengeChange: (challenge: OtpChallengeResponse) => void;
  onSubmit: (code: string) => Promise<void>;
  pending: boolean;
  submitLabel: string;
  onBack: () => void;
  backLabel: string;
}) {
  const resend = useResendCode();
  const [formError, setFormError] = useState<string | null>(null);
  const wait = useSecondsUntil(challenge.resendAvailableAt);
  const form = useForm<z.infer<typeof codeFormSchema>>({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  const submit = form.handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      await onSubmit(code);
    } catch (error) {
      form.resetField('code');
      setFormError(applyApiErrors(form, error));
    }
  });

  const requestNewCode = async () => {
    setFormError(null);
    try {
      onChallengeChange(await resend.mutateAsync(challenge.challengeId));
      form.resetField('code');
      toast.success('New code sent', {
        description: `Check the text message sent to ${challenge.destination}.`,
      });
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to{' '}
          <span className="font-medium text-foreground">{challenge.destination}</span>. It expires
          in 5 minutes.
        </p>
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  className="text-center font-mono text-lg tracking-[0.5em]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button type="button" variant="link" className="h-auto p-0" onClick={onBack}>
            {backLabel}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            disabled={wait > 0 || resend.isPending}
            onClick={() => void requestNewCode()}
          >
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
