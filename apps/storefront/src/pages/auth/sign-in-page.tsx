import { zodResolver } from '@hookform/resolvers/zod';
import { useCompleteSignInWithCode, useRequestSignInCode } from '@marketplace/api-client';
import {
  applyApiErrors,
  FormAlert,
  PasswordSignInForm,
  SubmitButton,
  useReturnTo,
} from '@marketplace/auth-ui';
import {
  AuthShell,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@marketplace/ui';
import { mobileSignInSchema, type OtpChallengeResponse } from '@marketplace/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { OtpStep } from '../../components/otp-step';
import { StoreBrand } from '../../components/store-brand';

function MobileSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const requestCode = useRequestSignInCode();
  const complete = useCompleteSignInWithCode();
  const [challenge, setChallenge] = useState<OtpChallengeResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof mobileSignInSchema>>({
    resolver: zodResolver(mobileSignInSchema),
    defaultValues: { mobile: '' },
  });

  if (challenge) {
    return (
      <OtpStep
        challenge={challenge}
        onChallengeChange={setChallenge}
        pending={complete.isPending}
        submitLabel="Sign in"
        backLabel="Use a different number"
        onBack={() => setChallenge(null)}
        onSubmit={async (code) => {
          await complete.mutateAsync({ challengeId: challenge.challengeId, code });
          onSignedIn();
        }}
      />
    );
  }

  const submit = form.handleSubmit(async ({ mobile }) => {
    setFormError(null);
    try {
      setChallenge(await requestCode.mutateAsync(mobile));
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormAlert message={formError} />
        <FormField
          control={form.control}
          name="mobile"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mobile number</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="0917 123 4567"
                  {...field}
                />
              </FormControl>
              <FormDescription>We'll text you a 6-digit code.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={requestCode.isPending}>Send code</SubmitButton>
      </form>
    </Form>
  );
}

export function SignInPage() {
  const navigate = useNavigate();
  const returnTo = useReturnTo('/account');
  const done = () => void navigate(returnTo, { replace: true });
  return (
    <AuthShell
      brand={<StoreBrand />}
      title="Sign in"
      description="Use your mobile number or your email address."
      footer={
        <p>
          New here?{' '}
          <Link to="/sign-up" className="font-medium text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </p>
      }
    >
      <Tabs defaultValue="mobile">
        <TabsList className="w-full" aria-label="Sign-in method">
          <TabsTrigger value="mobile">Mobile number</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
        </TabsList>
        <TabsContent value="mobile">
          <MobileSignIn onSignedIn={done} />
        </TabsContent>
        <TabsContent value="email">
          <PasswordSignInForm onSignedIn={done} />
        </TabsContent>
      </Tabs>
    </AuthShell>
  );
}
