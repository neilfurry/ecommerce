import { zodResolver } from '@hookform/resolvers/zod';
import {
  useChangePassword,
  useSession,
  useSignOut,
  useSignOutEverywhere,
} from '@marketplace/api-client';
import { ROLE_LABELS } from '@marketplace/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  PasswordInput,
  toast,
} from '@marketplace/ui';
import { changePasswordSchema } from '@marketplace/validation';
import {
  ChevronDownIcon,
  KeyRoundIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { applyApiErrors } from './form-errors';
import { TwoStepDialog } from './mfa';
import { FormAlert, PASSWORD_HINT, SubmitButton } from './pages';

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await change.mutateAsync(values);
      toast.success('Password changed', { description: 'Your other devices were signed out.' });
      form.reset();
      onOpenChange(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            You stay signed in here; other devices will need the new password.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>{PASSWORD_HINT}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={change.isPending}>Change password</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Account menu for the top bar: who is signed in, change password, sign out. */
export function UserMenu({ signInPath = '/sign-in' }: { signInPath?: string }) {
  const session = useSession();
  const signOut = useSignOut();
  const signOutEverywhere = useSignOutEverywhere();
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);
  const [twoStep, setTwoStep] = useState(false);
  const user = session.data?.user;
  if (!user) return null;

  const leave = (mutation: typeof signOut) => {
    mutation.mutate(undefined, { onSettled: () => void navigate(signInPath, { replace: true }) });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="gap-2"
            aria-label={`Account menu for ${user.firstName} ${user.lastName}`}
          >
            <UserIcon aria-hidden="true" />
            <span className="hidden max-w-40 truncate sm:inline">{user.firstName}</span>
            <ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <p className="font-medium">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {user.roles.map((role) => ROLE_LABELS[role]).join(', ')}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <KeyRoundIcon /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTwoStep(true)}>
            <ShieldCheckIcon /> Two-step verification {user.mfaEnabled ? '(on)' : ''}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => leave(signOutEverywhere)}>
            <MonitorSmartphoneIcon /> Sign out of all devices
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => leave(signOut)}>
            <LogOutIcon /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
      <TwoStepDialog open={twoStep} onOpenChange={setTwoStep} />
    </>
  );
}
