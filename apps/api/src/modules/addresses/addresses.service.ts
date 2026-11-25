import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@marketplace/database';
import { type AuthenticatedUser, MAX_ADDRESSES } from '@marketplace/shared-types';
import type { AddressDto, AddressInput } from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { areaName, LocationsService, type ResolvedPlace } from '../locations/locations.service';

const include = {
  region: true,
  province: true,
  city: true,
  barangay: true,
} satisfies Prisma.CustomerAddressInclude;
type AddressRow = Prisma.CustomerAddressGetPayload<{ include: typeof include }>;

const loc = (l: { code: string; name: string; level: AddressDto['region']['level'] }) => ({
  code: l.code,
  name: l.name,
  level: l.level,
});

export function formatAddress(a: {
  streetAddress: string;
  addressLine2: string | null;
  postalCode: string;
  place: Pick<ResolvedPlace, 'region' | 'province' | 'city' | 'barangay'>;
}): string {
  return [
    a.streetAddress,
    a.addressLine2,
    a.place.barangay.name,
    a.place.city.name,
    areaName(a.place),
    a.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}

export function addressDto(row: AddressRow): AddressDto {
  const place = {
    region: loc(row.region),
    province: row.province ? loc(row.province) : null,
    city: loc(row.city),
    barangay: loc(row.barangay),
  };
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    mobile: row.mobile,
    ...place,
    postalCode: row.postalCode,
    streetAddress: row.streetAddress,
    addressLine2: row.addressLine2,
    isDefault: row.isDefault,
    formatted: formatAddress({ ...row, place }),
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Address not found.');

/** A customer's address book. Each customer only ever reaches their own addresses. */
@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {}

  async list(user: AuthenticatedUser): Promise<AddressDto[]> {
    const rows = await this.prisma.customerAddress.findMany({
      where: { userId: user.id },
      include,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(addressDto);
  }

  /** One of the customer's addresses (404 for anyone else's). */
  async own(
    userId: string,
    id: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await db.customerAddress.findFirst({ where: { id, userId }, include });
    if (!row) throw notFound();
    return row;
  }

  async create(user: AuthenticatedUser, input: AddressInput): Promise<AddressDto> {
    const place = await this.locations.resolve(input);
    const count = await this.prisma.customerAddress.count({ where: { userId: user.id } });
    if (count >= MAX_ADDRESSES) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        `You can save up to ${MAX_ADDRESSES} addresses. Remove one first.`,
      );
    }
    const makeDefault = input.isDefault === true || count === 0;
    const row = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.customerAddress.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.create({
        data: {
          userId: user.id,
          label: input.label ?? null,
          recipientName: input.recipientName.trim(),
          mobile: input.mobile,
          regionCode: place.region.code,
          provinceCode: place.province?.code ?? null,
          cityCode: place.city.code,
          barangayCode: place.barangay.code,
          postalCode: input.postalCode.trim(),
          streetAddress: input.streetAddress.trim(),
          addressLine2: input.addressLine2 ?? null,
          isDefault: makeDefault,
        },
        include,
      });
    });
    return addressDto(row);
  }

  async update(user: AuthenticatedUser, id: string, input: AddressInput): Promise<AddressDto> {
    const current = await this.own(user.id, id);
    const place = await this.locations.resolve(input);
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true && !current.isDefault) {
        await tx.customerAddress.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.update({
        where: { id },
        data: {
          label: input.label ?? null,
          recipientName: input.recipientName.trim(),
          mobile: input.mobile,
          regionCode: place.region.code,
          provinceCode: place.province?.code ?? null,
          cityCode: place.city.code,
          barangayCode: place.barangay.code,
          postalCode: input.postalCode.trim(),
          streetAddress: input.streetAddress.trim(),
          addressLine2: input.addressLine2 ?? null,
          // The default can be moved to another address, not simply switched off.
          isDefault: current.isDefault || input.isDefault === true,
        },
        include,
      });
    });
    return addressDto(row);
  }

  async setDefault(user: AuthenticatedUser, id: string): Promise<AddressDto[]> {
    await this.own(user.id, id);
    await this.prisma.$transaction([
      this.prisma.customerAddress.updateMany({
        where: { userId: user.id, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      }),
      this.prisma.customerAddress.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.list(user);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const current = await this.own(user.id, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id } });
      if (current.isDefault) {
        const next = await tx.customerAddress.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });
        if (next)
          await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }
}
