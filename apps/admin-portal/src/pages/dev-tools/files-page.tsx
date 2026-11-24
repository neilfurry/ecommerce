import { zodResolver } from '@hookform/resolvers/zod';
import {
  toDisplayError,
  useApiClient,
  useDeleteDevFile,
  useDevFiles,
  useUploadDevFile,
} from '@marketplace/api-client';
import {
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
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
  Input,
  PageHeader,
  Spinner,
  toast,
} from '@marketplace/ui';
import type { StoredFileDto } from '@marketplace/validation';
import { DownloadIcon, FileUpIcon, FolderOpenIcon, InfoIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { formatBytes, formatDateTime } from '../../lib/format';

const PAGE_SIZE = 10;
/** Mirrors the API default (UPLOAD_MAX_BYTES); the API remains the authority. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain';

const uploadSchema = z.object({
  file: z
    .instanceof(File, { message: 'Choose a file to upload' })
    .refine((file) => file.size > 0, 'The file is empty')
    .refine(
      (file) => file.size <= MAX_UPLOAD_BYTES,
      `Files may be at most ${formatBytes(MAX_UPLOAD_BYTES)}`,
    ),
});

function showError(title: string, error: unknown) {
  const display = toDisplayError(error);
  toast.error(title, {
    description: display?.requestId
      ? `${display.message} (ref ${display.requestId})`
      : display?.message,
  });
}

function UploadCard() {
  const upload = useUploadDevFile();
  const [inputKey, setInputKey] = useState(0);
  const form = useForm({ resolver: zodResolver(uploadSchema) });

  const onSubmit = form.handleSubmit(async ({ file }) => {
    try {
      const stored = await upload.mutateAsync(file);
      toast.success('File uploaded', {
        description: `${stored.originalName} (${formatBytes(stored.sizeBytes)})`,
      });
      form.reset();
      setInputKey((key) => key + 1);
    } catch (error) {
      showError('Upload failed', error);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a test file</CardTitle>
        <CardDescription>
          Stored in object storage (MinIO locally) with its metadata in PostgreSQL. The file type is
          checked from its content, not its name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-4 sm:flex-row sm:items-start"
            noValidate
          >
            <FormField
              control={form.control}
              name="file"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>File</FormLabel>
                  <FormControl>
                    <Input
                      key={inputKey}
                      type="file"
                      accept={ACCEPT}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(event.target.files?.[0])}
                    />
                  </FormControl>
                  <FormDescription>
                    PNG, JPEG, GIF, WebP, PDF or plain text, up to 5 MB.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="sm:mt-[22px]" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Spinner className="text-current" /> : <FileUpIcon />}
              Upload
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function FileActions({ file }: { file: StoredFileDto }) {
  const client = useApiClient();
  const remove = useDeleteDevFile();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      // Short-lived signed URL: the browser downloads straight from storage.
      const { url } = await client.devTools.getFileDownloadUrl(file.id);
      window.location.assign(url);
    } catch (error) {
      showError('Download failed', error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex justify-end gap-1">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Details of ${file.originalName}`}>
            <InfoIcon />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-all">{file.originalName}</DialogTitle>
            <DialogDescription>File metadata</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">ID</dt>
            <dd className="font-mono break-all">{file.id}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{file.contentType}</dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd>
              {formatBytes(file.sizeBytes)} ({file.sizeBytes.toLocaleString()} bytes)
            </dd>
            <dt className="text-muted-foreground">SHA-256</dt>
            <dd className="font-mono text-xs break-all">{file.checksumSha256}</dd>
            <dt className="text-muted-foreground">Uploaded</dt>
            <dd>{formatDateTime(file.createdAt)}</dd>
          </dl>
        </DialogContent>
      </Dialog>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void download()}
        disabled={downloading}
        aria-label={`Download ${file.originalName}`}
      >
        {downloading ? <Spinner /> : <DownloadIcon />}
        <span className="hidden sm:inline">Download</span>
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm" aria-label={`Delete ${file.originalName}`}>
            <Trash2Icon className="text-destructive" />
          </Button>
        }
        title="Delete this file?"
        description={`"${file.originalName}" is removed from storage. Its metadata is kept as deleted for auditing.`}
        confirmLabel="Delete file"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(file.id);
            toast.success('File deleted');
          } catch (error) {
            showError('Delete failed', error);
            throw error;
          }
        }}
      />
    </div>
  );
}

const COLUMNS: DataTableColumn<StoredFileDto>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (file) => <span className="font-medium break-all">{file.originalName}</span>,
  },
  { id: 'type', header: 'Type', hideOnMobile: true, cell: (file) => file.contentType },
  {
    id: 'size',
    header: 'Size',
    className: 'tabular-nums',
    cell: (file) => formatBytes(file.sizeBytes),
  },
  {
    id: 'uploaded',
    header: 'Uploaded',
    hideOnMobile: true,
    cell: (file) => formatDateTime(file.createdAt),
  },
  {
    id: 'actions',
    header: <span className="sr-only">Actions</span>,
    cell: (file) => <FileActions file={file} />,
  },
];

export function FilesPage() {
  const [page, setPage] = useState(1);
  const files = useDevFiles(page, PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Admin Console', to: '/' },
          { label: 'Developer tools', to: '/dev-tools' },
          { label: 'File storage' },
        ]}
      />
      <PageHeader
        title="File storage"
        description="Development only. Proves upload, metadata, signed-URL download and delete against S3-compatible storage."
      />
      <UploadCard />
      <Card>
        <CardHeader>
          <CardTitle>Uploaded files</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Uploaded files"
            columns={COLUMNS}
            rows={files.data?.items}
            getRowId={(file) => file.id}
            isLoading={files.isPending}
            error={toDisplayError(files.error)}
            onRetry={() => void files.refetch()}
            empty={{
              icon: FolderOpenIcon,
              title: 'No files yet',
              description: 'Upload a file above to try the storage service.',
            }}
            pagination={
              files.data
                ? {
                    page,
                    pageSize: PAGE_SIZE,
                    totalItems: files.data.totalItems,
                    onPageChange: setPage,
                    isFetching: files.isFetching,
                  }
                : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
