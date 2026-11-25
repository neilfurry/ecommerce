import { useProductImages } from '@marketplace/api-client';
import { MAX_PRODUCT_IMAGES, PRODUCT_IMAGE_MIN_EDGE } from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Input,
  Spinner,
  toast,
} from '@marketplace/ui';
import type { ProductDetail, ProductImageDto } from '@marketplace/validation';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImageIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { showError } from '../../lib/errors';

const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

/** Photos: upload (several at once), order (the first is the main photo), replace, delete. */
export function PhotosTab({ product, editable }: { product: ProductDetail; editable: boolean }) {
  const images = useProductImages();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const approved = product.status === 'ACTIVE' || product.status === 'INACTIVE';

  const upload = async (files: FileList | null) => {
    const list = [...(files ?? [])].slice(0, MAX_PRODUCT_IMAGES - product.images.length);
    for (const file of list) {
      setUploading((n) => n + 1);
      try {
        await images.add.mutateAsync({ productId: product.id, file });
      } catch (error) {
        showError(`Could not upload ${file.name}`, error);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (list.length) toast.success(`${list.length} photo(s) added`);
  };

  const move = (index: number, delta: number) => {
    const ids = product.images.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    images.reorder.mutate(
      { productId: product.id, imageIds: ids },
      { onError: (error) => showError('Could not reorder', error) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>
            Photos ({product.images.length}/{MAX_PRODUCT_IMAGES})
          </h2>
        </CardTitle>
        <CardDescription>
          JPEG, PNG or WebP, at least {PRODUCT_IMAGE_MIN_EDGE} × {PRODUCT_IMAGE_MIN_EDGE} pixels and
          up to 5 MB. Photos are optimised automatically and location data is removed. The first
          photo is the main one.
          {approved ? ' Adding or replacing a photo sends the product back for approval.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editable && product.images.length < MAX_PRODUCT_IMAGES ? (
          <div>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              aria-label="Upload photos"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              onClick={() => input.current?.click()}
              disabled={uploading > 0}
            >
              {uploading > 0 ? <Spinner /> : <UploadIcon />}{' '}
              {uploading > 0 ? `Uploading ${uploading}…` : 'Add photos'}
            </Button>
          </div>
        ) : null}
        {product.images.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-sm text-muted-foreground">
            <ImageIcon className="size-6" aria-hidden="true" />
            No photos yet. Products need at least one photo to be submitted.
          </div>
        ) : (
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Product photos">
            {product.images.map((image, index) => (
              <PhotoCard
                key={image.id}
                image={image}
                index={index}
                count={product.images.length}
                productId={product.id}
                editable={editable}
                onMove={move}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function PhotoCard({
  image,
  index,
  count,
  productId,
  editable,
  onMove,
}: {
  image: ProductImageDto;
  index: number;
  count: number;
  productId: string;
  editable: boolean;
  onMove: (index: number, delta: number) => void;
}) {
  const images = useProductImages();
  const replaceInput = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState(image.altText ?? '');
  const label = `Photo ${index + 1}`;
  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="relative">
        <img
          src={image.thumbnailUrl}
          alt={image.altText ?? label}
          className="aspect-square w-full rounded object-contain bg-muted/30"
        />
        {index === 0 ? <Badge className="absolute left-2 top-2">Main photo</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {image.width} × {image.height}
      </p>
      {editable ? (
        <>
          <Input
            aria-label={`${label} description`}
            placeholder="Describe the photo (for screen readers)"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onBlur={() => {
              if (alt !== (image.altText ?? '')) {
                images.update.mutate(
                  { productId, imageId: image.id, body: { altText: alt || null } },
                  { onError: (error) => showError('Could not save the description', error) },
                );
              }
            }}
          />
          <div className="flex flex-wrap gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move ${label} earlier`}
              disabled={index === 0}
              onClick={() => onMove(index, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move ${label} later`}
              disabled={index === count - 1}
              onClick={() => onMove(index, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <input
              ref={replaceInput}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              aria-label={`Replace ${label}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  images.replace.mutate(
                    { productId, imageId: image.id, file },
                    {
                      onSuccess: () => toast.success('Photo replaced'),
                      onError: (error) => showError('Could not replace the photo', error),
                    },
                  );
                }
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => replaceInput.current?.click()}>
              <RefreshCwIcon /> Replace
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost">
                  <Trash2Icon /> Delete
                </Button>
              }
              title={`Delete ${label.toLowerCase()}?`}
              description="The photo is removed from the product and from storage."
              confirmLabel="Delete"
              destructive
              onConfirm={async () => {
                try {
                  await images.remove.mutateAsync({ productId, imageId: image.id });
                } catch (error) {
                  showError('Could not delete the photo', error);
                  throw error;
                }
              }}
            />
          </div>
        </>
      ) : null}
    </li>
  );
}
