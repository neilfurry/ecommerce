import {
  hasPermission,
  toDisplayError,
  useApiClient,
  useDeleteSellerDocument,
  useSellerProfile,
  useSession,
  useSubmitSellerApplication,
  useUploadSellerDocument,
} from '@marketplace/api-client';
import {
  REQUIRED_SELLER_DOCUMENTS,
  SELLER_DOCUMENT_LABELS,
  SELLER_DOCUMENT_TYPES,
  SELLER_STATUS_LABELS,
  type SellerDocumentType,
} from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from '@marketplace/ui';
import type { SellerDetail, SellerEventDto } from '@marketplace/validation';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleIcon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  SendIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { SellerStatusBadge } from '../../components/seller-status';
import { openBlob, showError } from '../../lib/errors';
import { formatBytes, formatDateTime } from '../../lib/format';

const EVENT_LABELS: Record<SellerEventDto['type'], string> = {
  REGISTERED: 'Registered',
  SUBMITTED: 'Submitted for verification',
  INFO_REQUESTED: 'More information requested',
  APPROVED: 'Verified',
  REJECTED: 'Not approved',
  SUSPENDED: 'Suspended',
  REINSTATED: 'Suspension lifted',
  CLOSED: 'Closed',
};

function StatusMessage({ seller }: { seller: SellerDetail }) {
  if (seller.status === 'VERIFIED') {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Your business is verified</AlertTitle>
        <AlertDescription>
          You can now{' '}
          <Link to="/stores" className="underline">
            create your store
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }
  if (seller.status === 'UNDER_REVIEW') {
    return (
      <Alert>
        <ClockIcon />
        <AlertTitle>Under review</AlertTitle>
        <AlertDescription>
          Our team is checking your details. Documents are locked until there is a decision.
        </AlertDescription>
      </Alert>
    );
  }
  if (seller.statusNote) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>
          {seller.status === 'REJECTED'
            ? 'Not approved'
            : seller.status === 'PENDING'
              ? 'More information needed'
              : SELLER_STATUS_LABELS[seller.status]}
        </AlertTitle>
        <AlertDescription>{seller.statusNote}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function Checklist({ seller, canSubmit }: { seller: SellerDetail; canSubmit: boolean }) {
  const submit = useSubmitSellerApplication();
  const editable = seller.status === 'PENDING' || seller.status === 'REJECTED';
  if (!editable) return null;
  const ready = seller.missingForSubmission.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Before you submit</h2>
        </CardTitle>
        <CardDescription>
          {ready
            ? 'Everything is ready.'
            : 'Complete these items, then submit your application for verification.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!ready ? (
          <ul className="space-y-2 text-sm" aria-label="Missing items">
            {seller.missingForSubmission.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CircleIcon
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {item.startsWith('Add the') ? (
                  <span>
                    {item}{' '}
                    <Link to="/profile" className="underline">
                      Edit profile
                    </Link>
                  </span>
                ) : (
                  item
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {canSubmit ? (
          <ConfirmDialog
            trigger={
              <Button disabled={!ready}>
                <SendIcon /> Submit for verification
              </Button>
            }
            title="Submit your application?"
            description="Our team will review your details and documents. You cannot change them during the review."
            confirmLabel="Submit"
            onConfirm={async () => {
              try {
                await submit.mutateAsync();
                toast.success('Application submitted', {
                  description: 'We will email you when there is a decision.',
                });
              } catch (error) {
                showError('Could not submit', error);
                throw error;
              }
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function UploadForm() {
  const upload = useUploadSellerDocument();
  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<SellerDocumentType | ''>('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const file = fileInput.current?.files?.[0];
    if (!type) return setError('Choose the document type.');
    if (!file) return setError('Choose a file (PDF, JPEG or PNG).');
    try {
      await upload.mutateAsync({ file, type, description: description.trim() || undefined });
      toast.success('Document uploaded');
      setType('');
      setDescription('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (uploadError) {
      setError(toDisplayError(uploadError)?.message ?? 'Upload failed.');
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2" noValidate>
      {error ? (
        <Alert variant="destructive" role="alert" className="sm:col-span-2">
          <AlertCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="document-type">Document type</Label>
        <Select value={type} onValueChange={(v) => setType(v as SellerDocumentType)}>
          <SelectTrigger id="document-type" className="w-full">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {SELLER_DOCUMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {SELLER_DOCUMENT_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="document-file">File (PDF, JPEG or PNG)</Label>
        <Input
          id="document-file"
          ref={fileInput}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="document-description">Note (optional)</Label>
        <Input
          id="document-description"
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <Button type="submit" disabled={upload.isPending}>
          {upload.isPending ? <Spinner className="text-primary-foreground" /> : <UploadIcon />}{' '}
          Upload
        </Button>
      </div>
    </form>
  );
}

function Documents({ seller, canEdit }: { seller: SellerDetail; canEdit: boolean }) {
  const client = useApiClient();
  const remove = useDeleteSellerDocument();
  const editable = canEdit && (seller.status === 'PENDING' || seller.status === 'REJECTED');
  const uploaded = new Set(seller.documents.map((d) => d.type));
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Documents</h2>
        </CardTitle>
        <CardDescription>
          Required: {REQUIRED_SELLER_DOCUMENTS.map((t) => SELLER_DOCUMENT_LABELS[t]).join('; ')}.
          Only you and the marketplace verification team can open them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ul className="divide-y rounded-md border" aria-label="Uploaded documents">
          {seller.documents.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">No documents yet.</li>
          ) : (
            seller.documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 p-3">
                <FileTextIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{SELLER_DOCUMENT_LABELS[doc.type]}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {doc.fileName} · {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                    {doc.description ? ` · ${doc.description}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void client.seller
                      .document(doc.id)
                      .then((blob) => openBlob(blob, doc.fileName))
                      .catch((error: unknown) => showError('Could not open the document', error))
                  }
                >
                  <EyeIcon /> View
                </Button>
                {editable ? (
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="ghost" aria-label={`Remove ${doc.fileName}`}>
                        <Trash2Icon />
                      </Button>
                    }
                    title="Remove this document?"
                    description={`${doc.fileName} will be deleted.`}
                    confirmLabel="Remove"
                    destructive
                    onConfirm={async () => {
                      try {
                        await remove.mutateAsync(doc.id);
                      } catch (error) {
                        showError('Could not remove the document', error);
                        throw error;
                      }
                    }}
                  />
                ) : null}
              </li>
            ))
          )}
        </ul>
        {REQUIRED_SELLER_DOCUMENTS.some((t) => !uploaded.has(t)) && editable ? (
          <p className="text-sm text-muted-foreground">
            Still needed:{' '}
            {REQUIRED_SELLER_DOCUMENTS.filter((t) => !uploaded.has(t))
              .map((t) => SELLER_DOCUMENT_LABELS[t])
              .join('; ')}
            .
          </p>
        ) : null}
        {editable ? <UploadForm /> : null}
      </CardContent>
    </Card>
  );
}

function History({ events }: { events: SellerEventDto[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>History</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3 border-l pl-4" aria-label="Verification history">
          {[...events].reverse().map((event) => (
            <li key={event.id}>
              <p className="text-sm font-medium">{EVENT_LABELS[event.type]}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(event.createdAt)}
                {event.actor ? ` · ${event.actor}` : ''}
              </p>
              {event.note ? <p className="mt-1 text-sm">{event.note}</p> : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function VerificationPage() {
  const session = useSession();
  const profile = useSellerProfile();
  const canEdit = hasPermission(session.data, 'seller.profile.manage');
  if (profile.isPending) return <LoadingState />;
  if (profile.isError) {
    return (
      <ErrorState
        message={toDisplayError(profile.error)?.message ?? 'Could not load your application.'}
        onRetry={() => void profile.refetch()}
      />
    );
  }
  const seller = profile.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Verification"
        description="We verify every seller's business before it can sell."
        actions={<SellerStatusBadge status={seller.status} />}
      />
      {!session.data?.user.emailVerified ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Confirm your email address</AlertTitle>
          <AlertDescription>
            Open the link we sent to {session.data?.user.email}. You can resend it from Account
            settings.
          </AlertDescription>
        </Alert>
      ) : null}
      <StatusMessage seller={seller} />
      <Checklist seller={seller} canSubmit={canEdit} />
      <Documents seller={seller} canEdit={canEdit} />
      <History events={seller.events} />
    </div>
  );
}
