import {
  hasPermission,
  toDisplayError,
  useAdminSeller,
  useAdminStores,
  useApiClient,
  useReviewSeller,
  useSellerStatusAction,
  useSession,
} from '@marketplace/api-client';
import { BUSINESS_TYPE_LABELS, SELLER_DOCUMENT_LABELS } from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeader,
  toast,
} from '@marketplace/ui';
import type { SellerDetail, SellerEventDto } from '@marketplace/validation';
import {
  BanIcon,
  CheckIcon,
  FileTextIcon,
  MessageSquareWarningIcon,
  RotateCcwIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ReasonDialog } from '../../components/reason-dialog';
import { SellerStatusBadge } from '../../components/seller-status';
import { StoreStatusBadge } from '../../components/store-status';
import { openBlob, showError } from '../../lib/errors';
import { formatBytes, formatDateTime } from '../../lib/format';

const EVENT_LABELS: Record<SellerEventDto['type'], string> = {
  REGISTERED: 'Registered',
  SUBMITTED: 'Submitted for verification',
  INFO_REQUESTED: 'More information requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  REINSTATED: 'Reinstated',
  CLOSED: 'Closed',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium sm:col-span-2">{children || '—'}</dd>
    </div>
  );
}

function ReviewActions({ seller }: { seller: SellerDetail }) {
  const review = useReviewSeller();
  const missing = seller.missingForSubmission.length > 0;
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        trigger={
          <Button disabled={missing}>
            <CheckIcon /> Approve
          </Button>
        }
        title={`Approve ${seller.businessName}?`}
        description="The seller is verified, can open stores and is told by email."
        confirmLabel="Approve"
        onConfirm={async () => {
          try {
            await review.mutateAsync({ sellerId: seller.id, body: { decision: 'APPROVE' } });
            toast.success('Seller verified');
          } catch (error) {
            showError('Could not approve the seller', error);
            throw error;
          }
        }}
      />
      <ReasonDialog
        trigger={
          <Button variant="outline">
            <MessageSquareWarningIcon /> Request information
          </Button>
        }
        title="Ask the seller for more information"
        description="The application goes back to the seller, who can update it and submit again."
        label="What is needed"
        hint="Emailed to the seller and shown in Seller Center."
        submitLabel="Send request"
        onSubmit={async (note) => {
          await review.mutateAsync({
            sellerId: seller.id,
            body: { decision: 'REQUEST_INFO', note },
          });
          toast.success('Request sent to the seller');
        }}
      />
      <ReasonDialog
        trigger={
          <Button variant="outline">
            <XIcon /> Reject
          </Button>
        }
        title={`Reject ${seller.businessName}?`}
        description="The seller can correct the application and submit again."
        hint="Emailed to the seller and shown in Seller Center."
        submitLabel="Reject application"
        onSubmit={async (note) => {
          await review.mutateAsync({ sellerId: seller.id, body: { decision: 'REJECT', note } });
          toast.success('Application rejected');
        }}
      />
    </div>
  );
}

function StatusActions({ seller }: { seller: SellerDetail }) {
  const action = useSellerStatusAction();
  const run = (kind: 'suspend' | 'reinstate' | 'close', done: string) => async (reason: string) => {
    await action.mutateAsync({ sellerId: seller.id, action: kind, reason });
    toast.success(done);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {seller.status === 'VERIFIED' ? (
        <ReasonDialog
          trigger={
            <Button variant="outline">
              <BanIcon /> Suspend
            </Button>
          }
          title={`Suspend ${seller.businessName}?`}
          description="Their stores are hidden and their team cannot make changes until reinstated."
          hint="Emailed to the seller."
          submitLabel="Suspend seller"
          onSubmit={run('suspend', 'Seller suspended')}
        />
      ) : null}
      {seller.status === 'SUSPENDED' ? (
        <ReasonDialog
          trigger={
            <Button variant="outline">
              <RotateCcwIcon /> Reinstate
            </Button>
          }
          title={`Reinstate ${seller.businessName}?`}
          description="The seller is verified again. Stores they had open become visible again."
          submitLabel="Reinstate seller"
          onSubmit={run('reinstate', 'Seller reinstated')}
        />
      ) : null}
      {seller.status !== 'CLOSED' ? (
        <ReasonDialog
          trigger={
            <Button variant="destructive">
              <XCircleIcon /> Close account
            </Button>
          }
          title={`Close ${seller.businessName}?`}
          description="This cannot be undone. All stores are hidden and every team member is signed out of Seller Center."
          hint="Emailed to the seller."
          submitLabel="Close seller account"
          onSubmit={run('close', 'Seller account closed')}
        />
      ) : null}
    </div>
  );
}

function Documents({ seller }: { seller: SellerDetail }) {
  const client = useApiClient();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Documents</h2>
        </CardTitle>
        <CardDescription>Private files. Each view is recorded in the audit log.</CardDescription>
      </CardHeader>
      <CardContent>
        {seller.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded.</p>
        ) : (
          <ul className="divide-y">
            {seller.documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{SELLER_DOCUMENT_LABELS[doc.type]}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {doc.fileName} · {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                    {doc.description ? ` · ${doc.description}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      openBlob(
                        await client.admin.sellers.document(seller.id, doc.id),
                        doc.fileName,
                      );
                    } catch (error) {
                      showError('Could not open the document', error);
                    }
                  }}
                >
                  <FileTextIcon /> View
                </Button>
              </li>
            ))}
          </ul>
        )}
        {seller.missingForSubmission.length ? (
          <Alert className="mt-4">
            <AlertTitle>Still missing</AlertTitle>
            <AlertDescription>{seller.missingForSubmission.join(', ')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stores({ sellerId }: { sellerId: string }) {
  const stores = useAdminStores({ sellerId, pageSize: 20 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Stores</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stores.isPending ? (
          <LoadingState />
        ) : stores.data?.items.length ? (
          <ul className="divide-y">
            {stores.data.items.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {store.name} <span className="text-xs text-muted-foreground">/{store.slug}</span>
                </span>
                <StoreStatusBadge status={store.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No stores yet.</p>
        )}
        <Link
          to={`/stores?sellerId=${sellerId}`}
          className="mt-3 inline-block text-sm underline-offset-4 hover:underline"
        >
          Manage stores
        </Link>
      </CardContent>
    </Card>
  );
}

export function SellerDetailPage() {
  const { sellerId } = useParams();
  const session = useSession();
  const seller = useAdminSeller(sellerId);
  const canReview = hasPermission(session.data, 'sellers.review');
  const canSuspend = hasPermission(session.data, 'sellers.suspend');
  const canSeeStores = hasPermission(session.data, 'stores.read');

  if (seller.isPending) return <LoadingState />;
  if (seller.isError) {
    return (
      <ErrorState
        message={toDisplayError(seller.error)?.message ?? 'Could not load the seller.'}
        onRetry={() => void seller.refetch()}
      />
    );
  }
  const s = seller.data;
  const address = [s.addressLine1, s.addressLine2, s.barangay, s.city, s.province, s.postalCode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Breadcrumbs items={[{ label: 'Sellers', to: '/sellers' }, { label: s.businessName }]} />
      <PageHeader
        title={s.businessName}
        description={BUSINESS_TYPE_LABELS[s.businessType].label}
        actions={<SellerStatusBadge status={s.status} />}
      />
      {s.statusNote ? (
        <Alert>
          <AlertTitle>Latest note to the seller</AlertTitle>
          <AlertDescription>{s.statusNote}</AlertDescription>
        </Alert>
      ) : null}
      {canReview && s.status === 'UNDER_REVIEW' ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Decision</h2>
            </CardTitle>
            <CardDescription>
              Check the documents against the business details before approving.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewActions seller={s} />
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Business</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label="Owner">
                <Link to={`/users/${s.owner.id}`} className="underline-offset-4 hover:underline">
                  {s.owner.name}
                </Link>{' '}
                <span className="text-muted-foreground">{s.owner.email}</span>
              </Row>
              <Row label="Business email">{s.email}</Row>
              <Row label="Mobile">{s.mobile}</Row>
              <Row label="Address">{address}</Row>
              <Row label={BUSINESS_TYPE_LABELS[s.businessType].registry}>
                {s.registrationNumber}
              </Row>
              <Row label="TIN">{s.tin}</Row>
              <Row label="VAT registered">{s.vatRegistered ? 'Yes' : 'No'}</Row>
              <Row label="Registered">{formatDateTime(s.createdAt)}</Row>
              <Row label="Submitted">{s.submittedAt ? formatDateTime(s.submittedAt) : null}</Row>
              <Row label="Verified">{s.verifiedAt ? formatDateTime(s.verifiedAt) : null}</Row>
              <Row label="Team">{s.memberCount} member(s)</Row>
            </dl>
          </CardContent>
        </Card>
        <Documents seller={s} />
      </div>
      {canSeeStores ? <Stores sellerId={s.id} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>History</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {s.events.map((event) => (
              <li key={event.id} className="text-sm">
                <p className="font-medium">
                  {EVENT_LABELS[event.type]}
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {formatDateTime(event.createdAt)}
                    {event.actor ? ` · ${event.actor}` : ''}
                  </span>
                </p>
                {event.note ? <p className="text-muted-foreground">{event.note}</p> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      {canSuspend && s.status !== 'CLOSED' ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Account status</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusActions seller={s} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
