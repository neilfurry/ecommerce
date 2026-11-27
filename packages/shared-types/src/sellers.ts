/** Seller verification lifecycle (Phase 2 brief §3). */
export const SELLER_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
  'CLOSED',
] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

export const SELLER_STATUS_LABELS: Record<SellerStatus, string> = {
  PENDING: 'Not yet submitted',
  UNDER_REVIEW: 'Under review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
};

/** Philippine business forms and the agency that registers them. */
export const BUSINESS_TYPES = [
  'SOLE_PROPRIETORSHIP',
  'PARTNERSHIP',
  'CORPORATION',
  'ONE_PERSON_CORPORATION',
  'COOPERATIVE',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_TYPE_LABELS: Record<BusinessType, { label: string; registry: string }> = {
  SOLE_PROPRIETORSHIP: {
    label: 'Sole proprietorship',
    registry: 'DTI business name registration number',
  },
  PARTNERSHIP: { label: 'Partnership', registry: 'SEC registration number' },
  CORPORATION: { label: 'Corporation', registry: 'SEC registration number' },
  ONE_PERSON_CORPORATION: { label: 'One Person Corporation', registry: 'SEC registration number' },
  COOPERATIVE: { label: 'Cooperative', registry: 'CDA registration number' },
};

export const SELLER_DOCUMENT_TYPES = [
  'BUSINESS_REGISTRATION',
  'BIR_REGISTRATION',
  'SWORN_DECLARATION',
  'MAYORS_PERMIT',
  'OWNER_ID',
  'OTHER',
] as const;
export type SellerDocumentType = (typeof SELLER_DOCUMENT_TYPES)[number];
export const SELLER_DOCUMENT_LABELS: Record<SellerDocumentType, string> = {
  BUSINESS_REGISTRATION: 'DTI / SEC / CDA registration certificate',
  BIR_REGISTRATION: 'BIR Certificate of Registration (Form 2303)',
  SWORN_DECLARATION: 'Sworn declaration for the withholding tax exemption (BIR-received)',
  MAYORS_PERMIT: "Mayor's or business permit",
  OWNER_ID: "Owner's government-issued ID",
  OTHER: 'Other supporting document',
};
/** A seller cannot submit for verification without at least one of each. */
export const REQUIRED_SELLER_DOCUMENTS: readonly SellerDocumentType[] = [
  'BUSINESS_REGISTRATION',
  'BIR_REGISTRATION',
  'OWNER_ID',
];

export const SELLER_EVENT_TYPES = [
  'REGISTERED',
  'SUBMITTED',
  'INFO_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'REINSTATED',
  'CLOSED',
] as const;
export type SellerEventType = (typeof SELLER_EVENT_TYPES)[number];

export const SELLER_MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type SellerMemberStatus = (typeof SELLER_MEMBER_STATUSES)[number];

/** Stores: sellers open and close their own; only admins suspend. */
export const STORE_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];
export const MAX_STORES_PER_SELLER = 5;
export const SELLER_INVITATION_TTL_HOURS = 168;
