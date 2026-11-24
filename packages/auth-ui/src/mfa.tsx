import { zodResolver } from '@hookform/resolvers/zod';
import {
  useMfaDisable,
  useMfaEnable,
  useMfaRegenerate,
  useMfaSetup,
  useMfaStatus,
  useVerifyMfa,
} from '@marketplace/api-client';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  LoadingState,
  PasswordInput,
  toast,
} from '@marketplace/ui';
import type { MfaChallengeResponse, MfaSetupResponse } from '@marketplace/validation';
import { mfaCodeSchema } from '@marketplace/validation';
import { CopyIcon, DownloadIcon, ShieldCheckIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { applyApiErrors } from './form-errors';
import { FormAlert, SubmitButton } from './pages';

const codeSchema = z.object({ code: mfaCodeSchema });
const sixDigitSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
const passwordOnlySchema = z.object({ password: z.string().min(1, 'Enter your password') });

function CodeField({ label = 'Code', description }: { label?: string; description?: string }) {
  return (
    <FormField
      name="code"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              autoComplete="one-time-code"
              inputMode="text"
              autoFocus
              className="font-mono tracking-widest"
              {...field}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Second sign-in step when the account uses two-step verification. */
export function MfaCodeForm({
  challenge,
  onSignedIn,
  onCancel,
}: {
  challenge: MfaChallengeResponse;
  onSignedIn: () => void;
  onCancel: () => void;
}) {
  const verify = useVerifyMfa();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
  const submit = form.handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      await verify.mutateAsync({ mfaToken: challenge.mfaToken, code });
      onSignedIn();
    } catch (error) {
      form.resetField('code');
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Open your authenticator app and enter the 6-digit code for this account. Lost your phone?
          Use one of your recovery codes.
        </p>
        <FormAlert message={formError} />
        <CodeField label="Authentication code" />
        <SubmitButton pending={verify.isPending}>Verify</SubmitButton>
        <Button type="button" variant="link" className="h-auto self-start p-0" onClick={onCancel}>
          Back to sign in
        </Button>
      </form>
    </Form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <ShieldCheckIcon />
        <AlertDescription>
          Save these recovery codes somewhere safe. Each works once if you lose your authenticator.
          They will not be shown again.
        </AlertDescription>
      </Alert>
      <ul
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(() => toast.success('Codes copied'))
          }
        >
          <CopyIcon /> Copy
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <DownloadIcon /> Download
        </Button>
        <Button type="button" className="ml-auto" onClick={onDone}>
          I saved them
        </Button>
      </div>
    </div>
  );
}

function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { margin: 1, width: 200 }).then((data) => {
      if (!cancelled) setSrc(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return src ? (
    <img
      src={src}
      alt="QR code for your authenticator app"
      width={200}
      height={200}
      className="rounded-md border"
    />
  ) : (
    <LoadingState />
  );
}

function EnableFlow({ onFinished }: { onFinished: () => void }) {
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const [secret, setSecret] = useState<MfaSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const passwordForm = useForm<z.infer<typeof passwordOnlySchema>>({
    resolver: zodResolver(passwordOnlySchema),
    defaultValues: { password: '' },
  });
  const codeForm = useForm<z.infer<typeof sixDigitSchema>>({
    resolver: zodResolver(sixDigitSchema),
    defaultValues: { code: '' },
  });

  if (codes) return <RecoveryCodes codes={codes} onDone={onFinished} />;

  if (!secret) {
    const submit = passwordForm.handleSubmit(async ({ password }) => {
      setFormError(null);
      try {
        setSecret(await setup.mutateAsync(password));
      } catch (error) {
        setFormError(applyApiErrors(passwordForm, error));
      }
    });
    return (
      <Form {...passwordForm}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Each time you sign in you will also enter a code from an authenticator app such as
            Google Authenticator, Microsoft Authenticator or 1Password. Confirm your password to
            start.
          </p>
          <FormAlert message={formError} />
          <FormField
            control={passwordForm.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="current-password" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SubmitButton pending={setup.isPending}>Continue</SubmitButton>
        </form>
      </Form>
    );
  }

  const submit = codeForm.handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      setCodes((await enable.mutateAsync(code)).recoveryCodes);
      toast.success('Two-step verification is on');
    } catch (error) {
      codeForm.resetField('code');
      setFormError(applyApiErrors(codeForm, error));
    }
  });
  return (
    <Form {...codeForm}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Scan this code with your authenticator app, then enter the code it shows.
        </p>
        <div className="flex justify-center">
          <QrImage url={secret.otpauthUrl} />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Can’t scan? Enter this key:{' '}
          <code className="break-all font-mono text-foreground" data-testid="mfa-secret">
            {secret.secret}
          </code>
        </p>
        <FormAlert message={formError} />
        <CodeField label="Code from the app" />
        <SubmitButton pending={enable.isPending}>Turn on</SubmitButton>
      </form>
    </Form>
  );
}

function ManageFlow({ onClose }: { onClose: () => void }) {
  const status = useMfaStatus();
  const regenerate = useMfaRegenerate();
  const disable = useMfaDisable();
  const [mode, setMode] = useState<'menu' | 'regenerate' | 'disable'>('menu');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const codeForm = useForm<z.input<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
  const disableForm = useForm<{ password: string; code: string }>({
    resolver: zodResolver(passwordOnlySchema.extend(codeSchema.shape)),
    defaultValues: { password: '', code: '' },
  });

  if (codes) return <RecoveryCodes codes={codes} onDone={onClose} />;

  if (mode === 'regenerate') {
    const submit = codeForm.handleSubmit(async ({ code }) => {
      setFormError(null);
      try {
        setCodes((await regenerate.mutateAsync(code)).recoveryCodes);
      } catch (error) {
        setFormError(applyApiErrors(codeForm, error));
      }
    });
    return (
      <Form {...codeForm}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Your old recovery codes will stop working.
          </p>
          <FormAlert message={formError} />
          <CodeField label="Code from your authenticator app" />
          <SubmitButton pending={regenerate.isPending}>Get new recovery codes</SubmitButton>
        </form>
      </Form>
    );
  }

  if (mode === 'disable') {
    const submit = disableForm.handleSubmit(async (values) => {
      setFormError(null);
      try {
        await disable.mutateAsync(values);
        toast.success('Two-step verification is off');
        onClose();
      } catch (error) {
        setFormError(applyApiErrors(disableForm, error));
      }
    });
    return (
      <Form {...disableForm}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormAlert message={formError} />
          <FormField
            control={disableForm.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <CodeField label="Code from your authenticator app, or a recovery code" />
          <SubmitButton pending={disable.isPending}>Turn off two-step verification</SubmitButton>
        </form>
      </Form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm">
        <Badge variant="success">On</Badge>
        {status.data ? `${status.data.recoveryCodesRemaining} recovery codes left` : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setMode('regenerate')}>
          New recovery codes
        </Button>
        <Button variant="destructive" onClick={() => setMode('disable')}>
          Turn off
        </Button>
      </div>
    </div>
  );
}

/** Turn two-step verification on or off and manage recovery codes (all apps). */
export function TwoStepDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useMfaStatus();
  // Each opening starts from the first step.
  const [instance, setInstance] = useState(0);
  const close = () => onOpenChange(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setInstance((n) => n + 1);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Two-step verification</DialogTitle>
          <DialogDescription>
            Protects your account even if someone learns your password.
          </DialogDescription>
        </DialogHeader>
        {status.isPending ? (
          <LoadingState />
        ) : status.data?.enabled ? (
          <ManageFlow key={instance} onClose={close} />
        ) : (
          <EnableFlow key={instance} onFinished={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
