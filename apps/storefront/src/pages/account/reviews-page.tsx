import { toDisplayError, useMyReviews, useReviewMutations } from '@marketplace/api-client';
import type { MyReviews } from '@marketplace/validation';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  Textarea,
  toast,
} from '@marketplace/ui';
import { ImageIcon, StarIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { productPath } from '../../lib/paths';
import { StarInput, Stars } from '../../components/shop/rating';

type Target =
  | { kind: 'new'; item: MyReviews['toReview'][number] }
  | { kind: 'edit'; review: MyReviews['reviews'][number] };

/** Mounted per target (key), so the form starts from that review or blank. */
function ReviewDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const { create, update } = useReviewMutations();
  const existing = target?.kind === 'edit' ? target.review : null;
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const product = target?.kind === 'new' ? target.item.product : target?.review.product;
  const pending = create.isPending || update.isPending;
  const save = () => {
    const done = {
      onSuccess: () => {
        toast.success('Thank you for your review');
        onClose();
      },
      onError: (error: unknown) =>
        toast.error(toDisplayError(error)?.message ?? 'Could not save the review.'),
    };
    if (target?.kind === 'new')
      create.mutate({ orderItemId: target.item.orderItemId, rating, title, body }, done);
    else if (target?.kind === 'edit')
      update.mutate({ id: target.review.id, body: { rating, title, body } }, done);
  };
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review {product?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <StarInput value={rating} onChange={setRating} />
          <div className="space-y-1">
            <Label htmlFor="review-title">Headline (optional)</Label>
            <Input
              id="review-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="review-body">Your review (optional)</Label>
            <Textarea
              id="review-body"
              rows={4}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewsPage() {
  const reviews = useMyReviews();
  const [params, setParams] = useSearchParams();
  const [chosenTarget, setTarget] = useState<Target | null>(null);
  const preselect = params.get('item');
  // Arriving from an order ("Write a review"): open that item.
  const preselected = reviews.data?.toReview.find((t) => t.orderItemId === preselect);
  const target: Target | null =
    chosenTarget ?? (preselected ? { kind: 'new', item: preselected } : null);
  const close = () => {
    setTarget(null);
    if (preselect) setParams({});
  };
  if (reviews.isPending) return <Skeleton className="h-64" />;
  if (reviews.isError)
    return (
      <ErrorState
        message={toDisplayError(reviews.error)?.message ?? 'Could not load reviews.'}
        onRetry={() => void reviews.refetch()}
      />
    );
  const { toReview, reviews: mine } = reviews.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Reviews" description="Rate what you bought to help other shoppers." />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Waiting for your review ({toReview.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {toReview.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to review right now.</p>
          ) : (
            <ul className="divide-y">
              {toReview.map((item) => (
                <li key={item.orderItemId} className="flex items-center gap-3 py-3">
                  <span className="size-12 shrink-0 overflow-hidden rounded border bg-muted">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <ImageIcon className="m-3 size-5 text-muted-foreground" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium">{item.product.name}</span>
                    <span className="text-muted-foreground">
                      Order {item.orderNumber}
                      {item.variantTitle !== 'Default' ? ` · ${item.variantTitle}` : ''}
                    </span>
                  </span>
                  <Button size="sm" onClick={() => setTarget({ kind: 'new', item })}>
                    <StarIcon aria-hidden="true" /> Review
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {mine.length === 0 ? (
        <EmptyState icon={StarIcon} title="You have not written reviews yet" />
      ) : (
        <ul className="space-y-3">
          {mine.map((r) => (
            <li key={r.id} className="rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={productPath(r.product)} className="font-medium hover:underline">
                  {r.product.name}
                </Link>
                <div className="flex items-center gap-2">
                  {r.status === 'HIDDEN' ? (
                    <Badge variant="secondary">Hidden by the marketplace</Badge>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTarget({ kind: 'edit', review: r })}
                  >
                    Edit
                  </Button>
                </div>
              </div>
              <Stars value={r.rating} className="mt-1" />
              {r.title ? <p className="mt-1 font-medium">{r.title}</p> : null}
              {r.body ? <p className="text-muted-foreground">{r.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <ReviewDialog
        key={target ? (target.kind === 'new' ? target.item.orderItemId : target.review.id) : 'none'}
        target={target}
        onClose={close}
      />
    </div>
  );
}
