import { toDisplayError, useEngagementAction, useSession } from '@marketplace/api-client';
import {
  REVIEW_REPORT_REASON_LABELS,
  REVIEW_REPORT_REASONS,
  type ReviewReportReason,
} from '@marketplace/shared-types';
import { Badge, Button, toast } from '@marketplace/ui';
import type { ReviewDto } from '@marketplace/validation';
import { useState } from 'react';

/** Photos, the verified-purchase badge and the seller's reply under a review. */
export function ReviewExtras({
  review,
}: {
  review: Pick<ReviewDto, 'images' | 'sellerReply' | 'verifiedPurchase'>;
}) {
  return (
    <>
      {review.verifiedPurchase ? <Badge variant="success">Verified purchase</Badge> : null}
      {review.images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {review.images.map((i) => (
            <a key={i.id} href={i.url} target="_blank" rel="noreferrer">
              <img
                src={i.url}
                alt="Photo from the reviewer"
                className="size-20 rounded-md object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      ) : null}
      {review.sellerReply ? (
        <p className="rounded-md bg-muted p-2 text-sm">
          <span className="font-medium">Seller reply:</span> {review.sellerReply.body}
        </p>
      ) : null}
    </>
  );
}

/** Report an inappropriate review (signed-in customers, once each). */
export function ReportReviewButton({ reviewId }: { reviewId: string }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReviewReportReason>('SPAM');
  const action = useEngagementAction();
  if (!session.data) return null;
  if (!open)
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setOpen(true)}
      >
        Report
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        action.mutate((api) => api.storefront.reportReview(reviewId, { reason }), {
          onSuccess: () => {
            toast.success('Thanks, our team will look at it.');
            setOpen(false);
          },
          onError: (error) =>
            toast.error(toDisplayError(error)?.message ?? 'Could not report the review.'),
        });
      }}
    >
      <select
        aria-label="Reason"
        className="h-8 rounded border bg-background px-2"
        value={reason}
        onChange={(e) => setReason(e.target.value as ReviewReportReason)}
      >
        {REVIEW_REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {REVIEW_REPORT_REASON_LABELS[r]}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" type="submit" disabled={action.isPending}>
        Send report
      </Button>
    </form>
  );
}

/** Add photos to one of my reviews (at most 5). */
export function ReviewPhotoUpload({ reviewId, count }: { reviewId: string; count: number }) {
  const action = useEngagementAction();
  if (count >= 5) return null;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs underline">
      Add photos
      <input
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).slice(0, 5 - count);
          if (files.length === 0) return;
          action.mutate((api) => api.account.reviewImages(reviewId, files), {
            onSuccess: () => toast.success('Photos added'),
            onError: (error) =>
              toast.error(toDisplayError(error)?.message ?? 'Could not add the photos.'),
          });
          e.target.value = '';
        }}
      />
    </label>
  );
}
