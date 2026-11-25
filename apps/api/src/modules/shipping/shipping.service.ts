import { Injectable } from '@nestjs/common';
import type { Prisma } from '@marketplace/database';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { areaName } from '../locations/locations.service';
import { ShippingProvider, type ShippingPlace, type ShippingRate } from './shipping-provider';

/** Weight used for items whose seller did not enter one. */
export const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

export interface ShippingOrigin {
  warehouseId: string;
  place: ShippingPlace;
}

export interface PackageItem {
  quantity: number;
  weightGrams: number | null;
  lengthCm: Prisma.Decimal | null;
  widthCm: Prisma.Decimal | null;
  heightCm: Prisma.Decimal | null;
}

/** Shipping for checkout: where each seller ships from, package size and the provider's rates. */
@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ShippingProvider,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  /**
   * Each seller's shipping origin: their default warehouse, when it has a located address
   * (PSGC codes). Sellers without one cannot ship yet (checkout reports it).
   */
  async origins(
    sellerIds: string[],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, ShippingOrigin>> {
    const warehouses = await db.warehouse.findMany({
      where: { sellerId: { in: sellerIds }, status: 'ACTIVE', cityCode: { not: null } },
      include: {
        regionLocation: true,
        provinceLocation: true,
        cityLocation: true,
        barangayLocation: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const result = new Map<string, ShippingOrigin>();
    for (const w of warehouses) {
      if (result.has(w.sellerId) || !w.regionLocation || !w.cityLocation) continue;
      result.set(w.sellerId, {
        warehouseId: w.id,
        place: {
          regionCode: w.regionLocation.code,
          provinceCode: w.provinceLocation?.code ?? null,
          cityCode: w.cityLocation.code,
          label: [
            w.barangayLocation?.name,
            w.cityLocation.name,
            areaName({ region: w.regionLocation, province: w.provinceLocation }),
          ]
            .filter(Boolean)
            .join(', '),
        },
      });
    }
    return result;
  }

  /** Total weight and volume of a seller's items (default weight for items without one). */
  packageOf(items: PackageItem[]) {
    let weightGrams = 0;
    let volumeCm3 = 0;
    for (const item of items) {
      weightGrams += (item.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS) * item.quantity;
      if (item.lengthCm && item.widthCm && item.heightCm) {
        volumeCm3 +=
          item.lengthCm.times(item.widthCm).times(item.heightCm).toNumber() * item.quantity;
      }
    }
    return { weightGrams, volumeCm3: Math.round(volumeCm3) };
  }

  /** An estimated single box with the package's volume, for the order record. */
  parcelsOf(pkg: { weightGrams: number; volumeCm3: number }) {
    const side = pkg.volumeCm3 > 0 ? Math.round(Math.cbrt(pkg.volumeCm3) * 10) / 10 : null;
    return [{ weightGrams: pkg.weightGrams, lengthCm: side, widthCm: side, heightCm: side }];
  }

  rates(
    origin: ShippingPlace,
    destination: ShippingPlace,
    pkg: { weightGrams: number; volumeCm3: number },
  ): Promise<ShippingRate[]> {
    return this.provider.quote({ origin, destination, parcel: pkg });
  }
}
