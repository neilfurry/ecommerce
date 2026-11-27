import { hasPermission, queryKeys, useSession } from '@marketplace/api-client';
import { TwoStepDialog, UserMenu } from '@marketplace/auth-ui';
import { APP_NAME } from '@marketplace/config';
import { BrandMark, Button, SidebarLayout } from '@marketplace/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import { Navigate } from 'react-router';
import { buildNavSections } from './navigation';

export function AdminLayout({ devToolsEnabled }: { devToolsEnabled: boolean }) {
  const session = useSession();
  if (session.data?.user.mfaEnrollmentRequired) return <MfaEnrollmentRequired />;
  return (
    <SidebarLayout
      appName="Admin Console"
      appTagline={APP_NAME}
      logo={<BrandMark icon={ShieldCheckIcon} className="bg-foreground text-background" />}
      sections={buildNavSections(devToolsEnabled, session.data?.user.permissions ?? [])}
      headerActions={<UserMenu />}
    />
  );
}

/** Lands each user on the first page their permissions allow. */
export function HomeRedirect() {
  const session = useSession();
  return (
    <Navigate
      to={hasPermission(session.data, 'users.read') ? '/users' : '/system-health'}
      replace
    />
  );
}

/**
 * Staff must turn on two-step verification before using the Admin Console (STAFF_MFA_REQUIRED;
 * the API refuses everything else until then).
 */
function MfaEnrollmentRequired() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
      <BrandMark icon={ShieldCheckIcon} className="bg-foreground text-background" />
      <h1 className="text-2xl font-semibold">Turn on two-step verification</h1>
      <p className="text-muted-foreground">
        Staff accounts can reach payouts, refunds and customer data, so the Admin Console asks for a
        code from an authenticator app at every sign-in. Set it up to continue.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={() => setOpen(true)}>Set up two-step verification</Button>
        <UserMenu />
      </div>
      <TwoStepDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) void queryClient.invalidateQueries({ queryKey: queryKeys.session });
        }}
      />
    </main>
  );
}
