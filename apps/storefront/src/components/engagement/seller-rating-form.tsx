import { toDisplayError, useEngagementAction } from '@marketplace/api-client';
import { Button, toast } from '@marketplace/ui';
import { useState } from 'react';

const SCORES = [
  ['productQuality', 'Product quality'],
  ['shippingSpeed', 'Shipping'],
  ['communication', 'Communication'],
] as const;
type Scores = Record<(typeof SCORES)[number][0], number>;

/** Rate the store for a delivered package (verified purchase). */
export function SellerRatingForm({
  sellerOrderId,
  storeName,
}: {
  sellerOrderId: string;
  storeName: string;
}) {
  const [scores, setScores] = useState<Scores>({
    productQuality: 0,
    shippingSpeed: 0,
    communication: 0,
  });
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const action = useEngagementAction();
  if (done) return <p className="text-sm text-emerald-700">Thanks for rating {storeName}!</p>;
  const ready = Object.values(scores).every((v) => v > 0);
  return (
    <form
      className="space-y-2 rounded-md border p-3"
      aria-label={`Rate ${storeName}`}
      onSubmit={(e) => {
        e.preventDefault();
        action.mutate(
          (api) => api.account.rateSeller(sellerOrderId, { ...scores, comment: comment || null }),
          {
            onSuccess: () => setDone(true),
            onError: (error) =>
              toast.error(toDisplayError(error)?.message ?? 'Could not save the rating.'),
          },
        );
      }}
    >
      <p className="text-sm font-medium">Rate {storeName}</p>
      {SCORES.map(([key, label]) => (
        <fieldset key={key} className="flex items-center gap-2 text-sm">
          <legend className="w-36 float-left">{label}</legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${label}: ${n} star${n > 1 ? 's' : ''}`}
              aria-pressed={scores[key] === n}
              className={scores[key] >= n ? 'text-amber-500' : 'text-muted-foreground/40'}
              onClick={() => setScores({ ...scores, [key]: n })}
            >
              ★
            </button>
          ))}
        </fieldset>
      ))}
      <input
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        aria-label="Comment (optional)"
        placeholder="Comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={!ready || action.isPending}>
        Submit rating
      </Button>
    </form>
  );
}
