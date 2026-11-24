import {
  hasPermission,
  toDisplayError,
  useMyStores,
  useSellerProfile,
  useSession,
} from '@marketplace/api-client';
import { BUSINESS_TYPE_LABELS } from '@marketplace/shared-types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@marketplace/ui';
import type { SellerDetail } from '@marketplace/validation';
import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { SellerStatusBadge } from '../../components/seller-status';

/** The one thing the seller should do next, depending on the verification status. */
function NextStep({ seller }: { seller: SellerDetail }) {
  const step: { title: string; text: string; to: string; action: string } | null = (() => {
    switch (seller.status) {
      case 'PENDING':
        return seller.statusNote
          ? {
              title: 'More information needed',
              text: seller.statusNote,
              to: '/verification',
              action: 'Update application',
            }
          : {
              title: 'Complete your application',
              text: `${seller.missingForSubmission.length} item(s) left before you can submit for verification.`,
              to: '/verification',
              action: 'Continue',
            };
      case 'UNDER_REVIEW':
        return {
          title: 'Application under review',
          text: 'We will email you when there is a decision.',
          to: '/verification',
          action: 'View application',
        };
      case 'REJECTED':
        return {
          title: 'Application not approved',
          text: seller.statusNote ?? '',
          to: '/verification',
          action: 'Fix and resubmit',
        };
      case 'VERIFIED':
        return seller.storeCount === 0
          ? {
              title: 'You are verified',
              text: 'Create your first store to start selling.',
              to: '/stores',
              action: 'Create a store',
            }
          : null;
      default:
        return null;
    }
  })();
  if (!step) return null;
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>
          <h2>{step.title}</h2>
        </CardTitle>
        <CardDescription>{step.text}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to={step.to}>
            {step.action} <ArrowRightIcon />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, to }: { label: string; value: ReactNode; to?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {to ? (
        <CardContent>
          <Link to={to} className="text-sm underline-offset-4 hover:underline">
            Manage
          </Link>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function DashboardPage() {
  const session = useSession();
  const profile = useSellerProfile();
  const stores = useMyStores();
  if (profile.isPending) return <LoadingState />;
  if (profile.isError) {
    return (
      <ErrorState
        message={toDisplayError(profile.error)?.message ?? 'Could not load your business.'}
        onRetry={() => void profile.refetch()}
      />
    );
  }
  const seller = profile.data;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`Hello, ${session.data?.user.firstName ?? ''}`}
        description={`${seller.businessName} · ${BUSINESS_TYPE_LABELS[seller.businessType].label}`}
        actions={<SellerStatusBadge status={seller.status} />}
      />
      <NextStep seller={seller} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Verification"
          value={<SellerStatusBadge status={seller.status} />}
          to="/verification"
        />
        <Stat label="Stores" value={stores.data?.stores.length ?? seller.storeCount} to="/stores" />
        <Stat
          label="Employees"
          value={seller.memberCount}
          to={hasPermission(session.data, 'seller.members.read') ? '/employees' : undefined}
        />
      </div>
    </div>
  );
}
