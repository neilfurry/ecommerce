import { APP_NAME } from '@marketplace/config';
import { BrandMark } from '@marketplace/ui';
import { StoreIcon } from 'lucide-react';

export function SellerBrand() {
  return (
    <>
      <BrandMark icon={StoreIcon} />
      <span>{APP_NAME} Seller Center</span>
    </>
  );
}
