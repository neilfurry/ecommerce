import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@marketplace/database';
import type { LocationDto } from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** PSGC code of the National Capital Region, shown to shoppers as "Metro Manila". */
export const NCR_CODE = '1300000000';

export interface ResolvedPlace {
  region: LocationDto;
  province: LocationDto | null;
  city: LocationDto;
  barangay: LocationDto;
}

const dto = (row: { code: string; name: string; level: LocationDto['level'] }): LocationDto => ({
  code: row.code,
  name: row.name,
  level: row.level,
});

/** The province (or "Metro Manila") part of an address line. */
export const areaName = (place: Pick<ResolvedPlace, 'region' | 'province'>) =>
  place.province?.name ?? (place.region.code === NCR_CODE ? 'Metro Manila' : place.region.name);

/**
 * Philippine locations from the PSGC tables, one address step at a time, and checks that a
 * chosen region, province, city and barangay really belong together.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async children(parentCode?: string): Promise<LocationDto[]> {
    const select = { code: true, name: true, level: true } as const;
    if (!parentCode) {
      const rows = await this.prisma.phLocation.findMany({
        where: { level: 'REGION', isActive: true },
        select,
        orderBy: { code: 'asc' },
      });
      return rows.map(dto);
    }
    const parent = await this.prisma.phLocation.findUnique({ where: { code: parentCode } });
    if (!parent || !parent.isActive) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Location not found.');
    }
    let where: Prisma.PhLocationWhereInput;
    if (parent.level === 'CITY' || parent.level === 'MUNICIPALITY') {
      // Barangays of the city, including those inside Manila's districts.
      where = { cityCode: parent.code, level: 'BARANGAY' };
    } else if (parent.level === 'BARANGAY') {
      return [];
    } else {
      where = { parentCode: parent.code };
    }
    const rows = await this.prisma.phLocation.findMany({
      where: { ...where, isActive: true },
      select,
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
    return rows.map(dto);
  }

  /**
   * Checks that the codes form one real address: the barangay is in the city, the city in the
   * province (or directly in the region for Metro Manila and independent cities) and region.
   */
  async resolve(
    input: {
      regionCode: string;
      provinceCode?: string | null;
      cityCode: string;
      barangayCode: string;
    },
    path = '',
  ): Promise<ResolvedPlace> {
    const codes = [input.regionCode, input.provinceCode, input.cityCode, input.barangayCode].filter(
      (c): c is string => !!c,
    );
    const rows = await this.prisma.phLocation.findMany({ where: { code: { in: codes } } });
    const get = (code: string | null | undefined) => rows.find((r) => r.code === code);
    const region = get(input.regionCode);
    const province = input.provinceCode ? get(input.provinceCode) : undefined;
    const city = get(input.cityCode);
    const barangay = get(input.barangayCode);
    const fail = (field: string, message: string): never => {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
        { path: `${path}${field}`, message },
      ]);
    };
    if (!region || region.level !== 'REGION' || !region.isActive)
      fail('regionCode', 'Choose a region');
    if (input.provinceCode && (!province || province.level !== 'PROVINCE' || !province.isActive)) {
      fail('provinceCode', 'Choose a province');
    }
    if (
      !city ||
      (city.level !== 'CITY' && city.level !== 'MUNICIPALITY') ||
      !city.isActive ||
      city.regionCode !== region!.code ||
      city.provinceCode !== (province?.code ?? null)
    ) {
      fail('cityCode', 'Choose a city or municipality in this province');
    }
    if (
      !barangay ||
      barangay.level !== 'BARANGAY' ||
      !barangay.isActive ||
      barangay.cityCode !== city!.code
    ) {
      fail('barangayCode', 'Choose a barangay in this city or municipality');
    }
    return {
      region: dto(region!),
      province: province ? dto(province) : null,
      city: dto(city!),
      barangay: dto(barangay!),
    };
  }
}
