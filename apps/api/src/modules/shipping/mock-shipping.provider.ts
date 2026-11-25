import { Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import { SHIPPING_METHOD_LABELS } from '@marketplace/shared-types';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import {
  ShippingProvider,
  type ShippingQuoteRequest,
  type ShippingRate,
} from './shipping-provider';

/** Island groups by PSGC region code (first two digits). */
const ISLAND_GROUP: Record<string, 'LUZON' | 'VISAYAS' | 'MINDANAO'> = {
  '01': 'LUZON', // Ilocos
  '02': 'LUZON', // Cagayan Valley
  '03': 'LUZON', // Central Luzon
  '04': 'LUZON', // CALABARZON
  '05': 'LUZON', // Bicol
  '13': 'LUZON', // NCR
  '14': 'LUZON', // CAR
  '17': 'LUZON', // MIMAROPA
  '06': 'VISAYAS', // Western Visayas
  '07': 'VISAYAS', // Central Visayas
  '08': 'VISAYAS', // Eastern Visayas
  '18': 'VISAYAS', // Negros Island Region
  '09': 'MINDANAO', // Zamboanga Peninsula
  '10': 'MINDANAO', // Northern Mindanao
  '11': 'MINDANAO', // Davao
  '12': 'MINDANAO', // SOCCSKSARGEN
  '16': 'MINDANAO', // Caraga
  '19': 'MINDANAO', // BARMM
};

export type Route = 'sameCity' | 'sameRegion' | 'sameIslandGroup' | 'otherIslandGroup';

export function routeBetween(
  a: ShippingQuoteRequest['origin'],
  b: ShippingQuoteRequest['destination'],
): Route {
  if (a.cityCode === b.cityCode) return 'sameCity';
  if (a.regionCode === b.regionCode) return 'sameRegion';
  const ga = ISLAND_GROUP[a.regionCode.slice(0, 2)];
  const gb = ISLAND_GROUP[b.regionCode.slice(0, 2)];
  return ga && ga === gb ? 'sameIslandGroup' : 'otherIslandGroup';
}

const ETA: Record<Route, [number, number]> = {
  sameCity: [1, 2],
  sameRegion: [2, 3],
  sameIslandGroup: [3, 5],
  otherIslandGroup: [5, 8],
};

/**
 * Development shipping rates from the table in Admin Console > Settings (no carrier is
 * called). Fee = route base for the first kilogram + a rate per additional kilogram, on the
 * larger of actual and volumetric weight; express multiplies the fee; same-day is a flat fee
 * within the same city.
 */
@Injectable()
export class MockShippingProvider extends ShippingProvider {
  readonly name = 'mock';

  constructor(private readonly settings: PlatformSettingsService) {
    super();
  }

  async quote(request: ShippingQuoteRequest, db?: Prisma.TransactionClient): Promise<ShippingRate[]> {
    const rates = await this.settings.shippingRates(db);
    const route = routeBetween(request.origin, request.destination);
    const volumetricGrams = Math.ceil((request.parcel.volumeCm3 / rates.volumetricDivisor) * 1000);
    const chargeableWeightGrams = Math.max(request.parcel.weightGrams, volumetricGrams);
    const kilograms = Math.max(1, Math.ceil(chargeableWeightGrams / 1000));
    const standard = new Prisma.Decimal(rates.base[route]).plus(
      new Prisma.Decimal(rates.perAdditionalKg).times(kilograms - 1),
    );
    const [min, max] = ETA[route];
    const options: ShippingRate[] = [
      {
        method: 'STANDARD',
        carrier: 'Mock Express',
        serviceName: SHIPPING_METHOD_LABELS.STANDARD,
        fee: standard.toDecimalPlaces(2),
        chargeableWeightGrams,
        etaMinDays: min,
        etaMaxDays: max,
      },
      {
        method: 'EXPRESS',
        carrier: 'Mock Express',
        serviceName: SHIPPING_METHOD_LABELS.EXPRESS,
        fee: standard.times(rates.expressMultiplier).toDecimalPlaces(2),
        chargeableWeightGrams,
        etaMinDays: Math.max(1, Math.floor(min / 2)),
        etaMaxDays: Math.max(1, Math.ceil(max / 2)),
      },
    ];
    if (route === 'sameCity' && rates.sameDayFee !== null && chargeableWeightGrams <= 20_000) {
      options.push({
        method: 'SAME_DAY',
        carrier: 'Mock Express',
        serviceName: SHIPPING_METHOD_LABELS.SAME_DAY,
        fee: new Prisma.Decimal(rates.sameDayFee).toDecimalPlaces(2),
        chargeableWeightGrams,
        etaMinDays: 0,
        etaMaxDays: 0,
      });
    }
    return options;
  }
}
