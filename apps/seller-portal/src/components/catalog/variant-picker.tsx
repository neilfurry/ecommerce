import { useMyProducts, useSellerProduct } from '@marketplace/api-client';
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@marketplace/ui';
import { useDeferredValue, useState } from 'react';

/** Find a product by name or SKU, then choose one of its stock-tracked variants. */
export function VariantPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: string;
  onChange: (variantId: string) => void;
  idPrefix: string;
}) {
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const deferred = useDeferredValue(search.trim());
  const products = useMyProducts({ search: deferred || undefined, pageSize: 20 });
  const product = useSellerProduct(productId || undefined);
  const variants = (product.data?.variants ?? []).filter((v) => v.trackInventory);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-search`}>Find product</Label>
        <Input
          id={`${idPrefix}-search`}
          type="search"
          placeholder="Name or SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-product`}>Product</Label>
        <Select
          value={productId}
          onValueChange={(v) => {
            setProductId(v);
            onChange('');
          }}
        >
          <SelectTrigger id={`${idPrefix}-product`}>
            <SelectValue placeholder="Choose a product" />
          </SelectTrigger>
          <SelectContent>
            {(products.data?.items ?? [])
              .filter((p) => p.status !== 'ARCHIVED')
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-variant`}>Variant</Label>
        <Select value={value} onValueChange={onChange} disabled={!productId}>
          <SelectTrigger id={`${idPrefix}-variant`}>
            <SelectValue placeholder={productId ? 'Choose a variant' : 'Choose a product first'} />
          </SelectTrigger>
          <SelectContent>
            {variants.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.title} · {v.sku} ({v.stock.available} available)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
