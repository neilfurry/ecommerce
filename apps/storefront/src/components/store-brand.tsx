import { APP_NAME } from '@marketplace/config';
import { BrandMark } from '@marketplace/ui';
import { Link } from 'react-router';

/** Logo for the sign-in and sign-up screens; links back to the shop. */
export function StoreBrand() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-md">
      <BrandMark />
      <span className="text-lg">{APP_NAME}</span>
    </Link>
  );
}
