import type { Prisma } from '@marketplace/database';
import type { ShippingMethod } from '@marketplace/shared-types';

/** A place on a shipping label, by PSGC codes. */
export interface ShippingPlace {
  regionCode: string;
  provinceCode: string | null;
  cityCode: string;
  /** For display, e.g. "Lahug, City of Cebu, Cebu". */
  label: string;
}

/** The package of one shipping group (one seller's items). */
export interface ShippingPackage {
  /** Actual weight. */
  weightGrams: number;
  /** Total volume of the items, for volumetric weight (0 when sizes are unknown). */
  volumeCm3: number;
}

export interface ShippingQuoteRequest {
  origin: ShippingPlace;
  destination: ShippingPlace;
  parcel: ShippingPackage;
}

export interface ShippingRate {
  method: ShippingMethod;
  carrier: string;
  serviceName: string;
  fee: Prisma.Decimal;
  /** The weight the fee is based on (the larger of actual and volumetric weight). */
  chargeableWeightGrams: number;
  etaMinDays: number;
  etaMaxDays: number;
}

/**
 * What every shipping integration provides: rates for a package between two places, one per
 * delivery method the carrier offers on that route. Carriers (J&T, LBC, Ninja Van...) plug in
 * behind this interface; the mock provider answers from an editable rate table.
 */
export abstract class ShippingProvider {
  abstract readonly name: string;
  /**
   * `db` is the transaction checkout runs in, for providers that read settings from the
   * database (so a checkout never needs a second connection while it holds row locks).
   */
  abstract quote(
    request: ShippingQuoteRequest,
    db?: Prisma.TransactionClient,
  ): Promise<ShippingRate[]>;
}
