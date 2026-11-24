import { CompassIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../components/button';
import { EmptyState } from './empty-state';

export function NotFound({ homePath = '/' }: { homePath?: string }) {
  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      description="The page you are looking for does not exist or has moved."
      action={
        <Button asChild>
          <Link to={homePath}>Go to home</Link>
        </Button>
      }
    />
  );
}
