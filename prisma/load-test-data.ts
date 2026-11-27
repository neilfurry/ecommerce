/* eslint-disable no-console -- a command-line script that reports progress */
/**
 * Synthetic data for load tests (never for production). Creates verified sellers with stores
 * and stocked warehouses in real PSGC locations, active products with realistic names and
 * prices, and customers with a default address, then prints the ids the k6 scripts need as
 * JSON (load/data.json).
 *
 *   LOAD_SELLERS=40 LOAD_PRODUCTS_PER_SELLER=125 LOAD_CUSTOMERS=60 \
 *   LOAD_TEST_PASSWORD=... pnpm --filter @marketplace/database exec tsx --conditions=source load-test-data.ts
 *
 * Refuses to run when NODE_ENV=production.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createPgAdapter, hashPassword, Prisma, PrismaClient } from './src';

loadDotenv({ path: path.resolve(__dirname, '../.env'), quiet: true });

const SELLERS = Number(process.env.LOAD_SELLERS ?? 40);
const PRODUCTS_PER_SELLER = Number(process.env.LOAD_PRODUCTS_PER_SELLER ?? 125);
const CUSTOMERS = Number(process.env.LOAD_CUSTOMERS ?? 60);
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? 'Load-test-password-2026!';
const OUT = process.env.LOAD_DATA_FILE ?? path.resolve(__dirname, '../load/data.json');
/** A product with very little stock that every checkout VU tries to buy (contention test). */
const CONTENDED_STOCK = Number(process.env.LOAD_CONTENDED_STOCK ?? 25);

// Warehouses and customer addresses in real barangays across the island groups.
const PLACES = [
  {
    region: '1300000000',
    province: null,
    city: '1381300000',
    barangay: '1381300009',
    cityName: 'Quezon City',
    provinceName: 'Metro Manila',
  },
];

const ADJECTIVES = [
  'Premium',
  'Classic',
  'Organic',
  'Family',
  'Fresh',
  'Deluxe',
  'Everyday',
  'Eco',
  'Pro',
  'Mini',
];
const NOUNS = [
  ['Jasmine Rice', 'kg'],
  ['Brown Rice', 'kg'],
  ['Dried Mangoes', 'g'],
  ['Coconut Oil', 'ml'],
  ['Barako Coffee', 'g'],
  ['Tablea Chocolate', 'g'],
  ['Calamansi Juice', 'ml'],
  ['Banana Chips', 'g'],
  ['Muscovado Sugar', 'kg'],
  ['Pili Nuts', 'g'],
  ['Ube Jam', 'g'],
  ['Danggit', 'g'],
] as const;

function pick<T>(list: readonly T[], i: number): T {
  return list[i % list.length]!;
}

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Load-test data is never created in production.');
  const prisma = new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL!) });
  const run = Date.now().toString(36);
  const passwordHash = await hashPassword(PASSWORD);
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'rice-and-grains' } });
  // More locations from the database (barangays of a few big cities), so routes and fees vary.
  const extra = await prisma.$queryRaw<
    {
      code: string;
      region_code: string;
      province_code: string | null;
      city_code: string;
      city: string;
    }[]
  >`SELECT b."code", b."region_code", b."province_code", b."city_code", c."name" AS "city"
      FROM "ph_locations" b JOIN "ph_locations" c ON c."code" = b."city_code"
     WHERE b."level" = 'BARANGAY' AND c."name" IN ('City of Cebu', 'City of Davao', 'City of Makati', 'City of Iloilo')
     ORDER BY b."code" LIMIT 40`;
  const places = [
    ...PLACES,
    ...extra.map((r) => ({
      region: r.region_code,
      province: r.province_code,
      city: r.city_code,
      barangay: r.code,
      cityName: r.city,
      provinceName: r.city,
    })),
  ];

  const products: { id: string; variantId: string; name: string }[] = [];
  let contended: { id: string; variantId: string } | null = null;
  const started = Date.now();
  for (let s = 0; s < SELLERS; s += 1) {
    const place = pick(places, s * 7);
    const owner = await prisma.user.create({
      data: {
        email: `load.seller.${run}.${s}@loadtest.invalid`,
        emailVerifiedAt: new Date(),
        passwordHash,
        firstName: 'Load',
        lastName: `Seller ${s}`,
        status: 'ACTIVE',
        roles: { create: [{ roleCode: 'SELLER_OWNER' }] },
      },
    });
    const seller = await prisma.seller.create({
      data: {
        businessName: `Load Test Trading ${run}-${s}`,
        businessType: 'SOLE_PROPRIETORSHIP',
        ownerId: owner.id,
        email: owner.email,
        mobile: `+63917${String(1_000_000 + s).slice(-7)}`,
        addressLine1: `${s + 1} Rizal Street`,
        city: place.cityName,
        province: place.provinceName,
        postalCode: '1105',
        registrationNumber: `DTI-${run}-${s}`,
        tin: '123456789000',
        status: 'VERIFIED',
        submittedAt: new Date(),
        reviewedAt: new Date(),
        verifiedAt: new Date(),
        members: { create: [{ userId: owner.id }] },
      },
    });
    const store = await prisma.store.create({
      data: { sellerId: seller.id, name: `Load Store ${s}`, slug: `load-${run}-${s}` },
    });
    const warehouse = await prisma.warehouse.create({
      data: {
        sellerId: seller.id,
        name: 'Main',
        code: 'MAIN',
        addressLine1: `${s + 1} Rizal Street`,
        city: place.cityName,
        province: place.provinceName,
        postalCode: '1105',
        isDefault: true,
        regionCode: place.region,
        provinceCode: place.province,
        cityCode: place.city,
        barangayCode: place.barangay,
      },
    });
    for (let p = 0; p < PRODUCTS_PER_SELLER; p += 1) {
      const n = s * PRODUCTS_PER_SELLER + p;
      const [noun] = pick(NOUNS, n);
      const name = `${pick(ADJECTIVES, n * 3)} ${noun} ${n}`;
      const price = new Prisma.Decimal(80 + ((n * 37) % 1900)).toDecimalPlaces(2);
      const isContended = s === 0 && p === 0;
      const stock = isContended ? CONTENDED_STOCK : 100_000;
      const product = await prisma.product.create({
        data: {
          sellerId: seller.id,
          storeId: store.id,
          categoryId: category.id,
          name: isContended ? `Load Test Limited Edition ${run}` : name,
          slug: `load-${run}-${n}`,
          description: `${name}: synthetic product for load testing, packed and shipped from ${place.cityName}.`,
          attributeValues: { net_weight: 1 },
          status: 'ACTIVE',
          submittedAt: new Date(),
          approvedAt: new Date(),
          reviewedAt: new Date(),
          createdById: owner.id,
          variants: {
            create: {
              sellerId: seller.id,
              sku: `LOAD-${run}-${n}`.toUpperCase(),
              title: 'Default',
              regularPrice: price,
              weightGrams: 500 + (n % 5) * 250,
              lengthCm: new Prisma.Decimal(20),
              widthCm: new Prisma.Decimal(15),
              heightCm: new Prisma.Decimal(10),
            },
          },
        },
        include: { variants: true },
      });
      const variant = product.variants[0]!;
      await prisma.stockLevel.create({
        data: {
          sellerId: seller.id,
          warehouseId: warehouse.id,
          variantId: variant.id,
          quantityOnHand: stock,
        },
      });
      if (isContended) contended = { id: product.id, variantId: variant.id };
      else products.push({ id: product.id, variantId: variant.id, name });
    }
    if ((s + 1) % 10 === 0)
      console.log(`${s + 1}/${SELLERS} sellers (${Math.round((Date.now() - started) / 1000)} s)`);
  }

  const customers: string[] = [];
  for (let c = 0; c < CUSTOMERS; c += 1) {
    const place = pick(places, c * 3 + 1);
    const email = `load.customer.${run}.${c}@loadtest.invalid`;
    const user = await prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        mobile: `+63918${String(1_000_000 + c).slice(-7)}`,
        mobileVerifiedAt: new Date(),
        passwordHash,
        firstName: 'Load',
        lastName: `Customer ${c}`,
        status: 'ACTIVE',
        roles: { create: [{ roleCode: 'CUSTOMER' }] },
      },
    });
    await prisma.customerAddress.create({
      data: {
        userId: user.id,
        recipientName: `Load Customer ${c}`,
        mobile: `+63918${String(1_000_000 + c).slice(-7)}`,
        regionCode: place.region,
        provinceCode: place.province,
        cityCode: place.city,
        barangayCode: place.barangay,
        postalCode: '1105',
        streetAddress: `${c + 1} Mabini Street`,
        isDefault: true,
      },
    });
    customers.push(email);
  }

  // Search terms that match many products, a few, or none.
  const searchTerms = [
    'rice',
    'mangoes',
    'coffee',
    'premium oil',
    'organic',
    'chips',
    'pili',
    'durian',
  ];
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        run,
        password: PASSWORD,
        products,
        contended,
        contendedStock: CONTENDED_STOCK,
        customers,
        searchTerms,
      },
      null,
      1,
    ),
  );
  console.log(
    `Created ${SELLERS} sellers, ${products.length + 1} products and ${CUSTOMERS} customers in ${Math.round((Date.now() - started) / 1000)} s -> ${OUT}`,
  );
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
