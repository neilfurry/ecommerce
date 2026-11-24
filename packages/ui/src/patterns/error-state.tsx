import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../components/alert';
import { Button } from '../components/button';

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** Request id from the API error, shown so users can quote it to support. */
  requestId?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  requestId,
  onRetry,
  isRetrying = false,
}: ErrorStateProps) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {requestId ? (
          <p className="text-xs">
            Reference: <code className="font-mono">{requestId}</code>
          </p>
        ) : null}
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onRetry}
            disabled={isRetrying}
          >
            <RefreshCwIcon className={isRetrying ? 'animate-spin' : undefined} />
            {isRetrying ? 'Retrying…' : 'Try again'}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
