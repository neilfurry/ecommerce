import { useLocations } from '@marketplace/api-client';
import { Label, cn } from '@marketplace/ui';
import type { LocationDto } from '@marketplace/validation';
import { useId } from 'react';
import {
  emptyLocationDraft,
  type LocationDraft,
  type LocationNames,
  type LocationValue,
} from './location-draft';

function Step({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  options: LocationDto[] | undefined;
  placeholder: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        disabled={disabled || !options}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50',
        )}
      >
        <option value="">{disabled ? '—' : options ? placeholder : 'Loading…'}</option>
        {options?.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
            {o.level === 'CITY' && id.endsWith('area') ? ' (city)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Region → province (or independent city) → city or municipality → barangay, from the PSGC
 * tables. Calls `onComplete` with codes and official names once a barangay is chosen, and
 * with null while the choice is incomplete.
 */
export function LocationPicker({
  draft,
  onDraftChange,
  onComplete,
}: {
  draft: LocationDraft;
  onDraftChange: (draft: LocationDraft) => void;
  onComplete: (value: LocationValue | null, names: LocationNames | null) => void;
}) {
  const ids = useId();
  const regions = useLocations(undefined);
  const areas = useLocations(draft.regionCode || null);
  const area = areas.data?.find((a) => a.code === draft.areaCode);
  const isProvince = area?.level === 'PROVINCE';
  const cities = useLocations(isProvince ? draft.areaCode : null);
  const barangays = useLocations(draft.cityCode || null);

  const nameOf = (list: LocationDto[] | undefined, code: string) =>
    list?.find((l) => l.code === code)?.name ?? '';

  const update = (next: LocationDraft) => {
    onDraftChange(next);
    if (!next.barangayCode) onComplete(null, null);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Step
        id={`${ids}-region`}
        label="Region"
        value={draft.regionCode}
        options={regions.data}
        placeholder="Choose a region"
        onChange={(code) => update({ ...emptyLocationDraft, regionCode: code })}
      />
      <Step
        id={`${ids}-area`}
        label="Province"
        value={draft.areaCode}
        options={areas.data}
        disabled={!draft.regionCode}
        placeholder="Province or city"
        onChange={(code) => {
          const chosen = areas.data?.find((a) => a.code === code);
          update({
            regionCode: draft.regionCode,
            areaCode: code,
            cityCode: chosen && chosen.level !== 'PROVINCE' ? code : '',
            barangayCode: '',
          });
        }}
      />
      <Step
        id={`${ids}-city`}
        label="City or municipality"
        value={draft.cityCode}
        options={isProvince ? cities.data : area ? [area] : undefined}
        disabled={!draft.areaCode}
        placeholder="Choose a city or municipality"
        onChange={(code) => update({ ...draft, cityCode: code, barangayCode: '' })}
      />
      <Step
        id={`${ids}-barangay`}
        label="Barangay"
        value={draft.barangayCode}
        options={barangays.data}
        disabled={!draft.cityCode}
        placeholder="Choose a barangay"
        onChange={(code) => {
          const next = { ...draft, barangayCode: code };
          onDraftChange(next);
          if (!code) return onComplete(null, null);
          const cityName = isProvince ? nameOf(cities.data, draft.cityCode) : (area?.name ?? '');
          onComplete(
            {
              regionCode: draft.regionCode,
              provinceCode: isProvince ? draft.areaCode : null,
              cityCode: draft.cityCode,
              barangayCode: code,
            },
            {
              region: nameOf(regions.data, draft.regionCode),
              province: isProvince ? (area?.name ?? null) : null,
              city: cityName,
              barangay: nameOf(barangays.data, code),
            },
          );
        }}
      />
    </div>
  );
}
