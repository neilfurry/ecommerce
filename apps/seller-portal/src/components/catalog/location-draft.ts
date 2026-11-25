export interface LocationValue {
  regionCode: string;
  provinceCode: string | null;
  cityCode: string;
  barangayCode: string;
}

/** Official names of the chosen places, to fill the address text fields. */
export interface LocationNames {
  region: string;
  province: string | null;
  city: string;
  barangay: string;
}

/** What the picker holds while the user is still choosing. */
export interface LocationDraft {
  regionCode: string;
  /** The second step: a province, or a city outside any province (Metro Manila, HUCs). */
  areaCode: string;
  cityCode: string;
  barangayCode: string;
}

export const emptyLocationDraft: LocationDraft = {
  regionCode: '',
  areaCode: '',
  cityCode: '',
  barangayCode: '',
};

export function draftFromLocation(
  location: {
    regionCode: string;
    provinceCode: string | null;
    cityCode: string;
    barangayCode: string | null;
  } | null,
): LocationDraft {
  if (!location) return emptyLocationDraft;
  return {
    regionCode: location.regionCode,
    areaCode: location.provinceCode ?? location.cityCode,
    cityCode: location.cityCode,
    barangayCode: location.barangayCode ?? '',
  };
}
