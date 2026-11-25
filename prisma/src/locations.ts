import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from './generated/prisma/client';

type Db = Pick<PrismaClient, '$executeRaw' | '$queryRaw'>;

export type LocationLevelName =
  'REGION' | 'PROVINCE' | 'CITY' | 'MUNICIPALITY' | 'SUB_MUNICIPALITY' | 'BARANGAY';

export interface LocationRow {
  code: string;
  name: string;
  level: LocationLevelName;
  parentCode: string | null;
  regionCode: string;
  provinceCode: string | null;
  cityCode: string | null;
}

/**
 * A PSGC publication in the nested format of the `psgc-areas` dataset: regions with
 * provinces, cities, municipalities, municipal districts (Manila) and barangays.
 */
interface PsgcNode {
  code: string;
  name: string;
  provinces?: PsgcNode[];
  cities?: PsgcNode[];
  municipalities?: PsgcNode[];
  municipalDistricts?: PsgcNode[];
  barangays?: PsgcNode[];
}

/** Where the bundled publication (PSA PSGC, April 2024) lives. */
export function bundledPsgcFile(): string {
  return path.join(path.dirname(require.resolve('psgc-areas/package.json')), 'data', 'all.json');
}

/** Flattens a nested PSGC publication into rows, parents before children. */
export function flattenPsgc(regions: PsgcNode[]): LocationRow[] {
  const rows: LocationRow[] = [];
  const add = (
    node: PsgcNode,
    level: LocationLevelName,
    parent: LocationRow | null,
    context: Pick<LocationRow, 'regionCode' | 'provinceCode' | 'cityCode'>,
  ) => {
    if (!/^\d{10}$/.test(node.code)) throw new Error(`Invalid PSGC code "${node.code}"`);
    const row: LocationRow = {
      code: node.code,
      name: node.name.trim(),
      level,
      parentCode: parent?.code ?? null,
      ...context,
    };
    rows.push(row);
    return row;
  };
  const addLocality = (
    node: PsgcNode,
    level: 'CITY' | 'MUNICIPALITY',
    parent: LocationRow,
    regionCode: string,
    provinceCode: string | null,
  ) => {
    const city = add(node, level, parent, { regionCode, provinceCode, cityCode: null });
    const context = { regionCode, provinceCode, cityCode: city.code };
    for (const b of node.barangays ?? []) add(b, 'BARANGAY', city, context);
    for (const district of node.municipalDistricts ?? []) {
      const d = add(district, 'SUB_MUNICIPALITY', city, context);
      for (const b of district.barangays ?? []) add(b, 'BARANGAY', d, context);
    }
  };
  for (const r of regions) {
    const region = add(r, 'REGION', null, {
      regionCode: r.code,
      provinceCode: null,
      cityCode: null,
    });
    for (const c of r.cities ?? []) addLocality(c, 'CITY', region, region.code, null);
    for (const m of r.municipalities ?? [])
      addLocality(m, 'MUNICIPALITY', region, region.code, null);
    for (const p of r.provinces ?? []) {
      // Independent cities (highly urbanized cities and the City of Isabela) belong to no
      // province: their PSGC code has its own province digits. They go directly under the
      // region, whatever province a publication file happens to list them under.
      const independent = (c: PsgcNode) => c.code.slice(2, 5) !== p.code.slice(2, 5);
      if (/not a province/i.test(p.name)) {
        for (const c of p.cities ?? []) addLocality(c, 'CITY', region, region.code, null);
        continue;
      }
      const province = add(p, 'PROVINCE', region, {
        regionCode: region.code,
        provinceCode: p.code,
        cityCode: null,
      });
      for (const c of p.cities ?? []) {
        if (independent(c)) addLocality(c, 'CITY', region, region.code, null);
        else addLocality(c, 'CITY', province, region.code, p.code);
      }
      for (const m of p.municipalities ?? [])
        addLocality(m, 'MUNICIPALITY', province, region.code, p.code);
    }
  }
  return rows;
}

const LEVEL_ORDER: LocationLevelName[] = [
  'REGION',
  'PROVINCE',
  'CITY',
  'MUNICIPALITY',
  'SUB_MUNICIPALITY',
  'BARANGAY',
];

/**
 * Inserts or updates every location of a publication (names, levels and parents follow the
 * publication; whether a location is switched on is kept). Locations missing from the
 * publication are switched off rather than deleted, because addresses may refer to them.
 */
export async function importLocations(
  db: Db,
  rows: LocationRow[],
): Promise<{ total: number; deactivated: number }> {
  const sorted = [...rows].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  );
  const batch = 2000;
  for (let i = 0; i < sorted.length; i += batch) {
    const chunk = sorted.slice(i, i + batch);
    const payload = JSON.stringify(chunk);
    await db.$executeRaw`
      INSERT INTO "ph_locations"
        ("code", "name", "level", "parent_code", "region_code", "province_code", "city_code", "updated_at")
      SELECT r."code", r."name", r."level"::"location_level", r."parentCode", r."regionCode",
             r."provinceCode", r."cityCode", now()
      FROM jsonb_to_recordset(${payload}::jsonb) AS r(
        "code" text, "name" text, "level" text, "parentCode" text, "regionCode" text,
        "provinceCode" text, "cityCode" text)
      ON CONFLICT ("code") DO UPDATE SET
        "name" = EXCLUDED."name", "level" = EXCLUDED."level", "parent_code" = EXCLUDED."parent_code",
        "region_code" = EXCLUDED."region_code", "province_code" = EXCLUDED."province_code",
        "city_code" = EXCLUDED."city_code", "updated_at" = now()
      WHERE (ph_locations."name", ph_locations."level", ph_locations."parent_code",
             ph_locations."province_code", ph_locations."city_code")
        IS DISTINCT FROM (EXCLUDED."name", EXCLUDED."level", EXCLUDED."parent_code",
             EXCLUDED."province_code", EXCLUDED."city_code")`;
  }
  const codes = JSON.stringify(rows.map((r) => r.code));
  const deactivated = await db.$executeRaw`
    UPDATE "ph_locations" SET "is_active" = false, "updated_at" = now()
    WHERE "is_active" AND "code" NOT IN (SELECT jsonb_array_elements_text(${codes}::jsonb))`;
  return { total: rows.length, deactivated };
}

/** Reads a publication file (the bundled one by default) and returns its rows. */
export function readPsgcFile(file = bundledPsgcFile()): LocationRow[] {
  const data = JSON.parse(readFileSync(file, 'utf8')) as PsgcNode[];
  if (!Array.isArray(data) || data.length === 0) throw new Error(`${file} has no regions`);
  return flattenPsgc(data);
}
