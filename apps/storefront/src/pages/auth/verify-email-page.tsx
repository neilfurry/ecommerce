import { VerifyEmailPage as SharedVerifyEmailPage } from '@marketplace/auth-ui';
import { StoreBrand } from '../../components/store-brand';

/** Opened from the confirmation email. */
export function VerifyEmailPage() {
  return <SharedVerifyEmailPage brand={<StoreBrand />} accountPath="/account" />;
}
