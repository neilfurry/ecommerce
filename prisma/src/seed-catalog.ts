import { Prisma, type PrismaClient } from './generated/prisma/client';

/**
 * Development-only demo catalog (see docs/development/LOCAL_DATABASE.md): a small category
 * tree with attributes, a few invented brands, and for the demo seller two warehouses and
 * one approved product with wholesale tiers and stock. Idempotent.
 */

interface CategorySeed {
  slug: string;
  name: string;
  description?: string;
  children?: CategorySeed[];
  attributes?: {
    code: string;
    name: string;
    type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT';
    options?: string[];
    unit?: string;
    isRequired?: boolean;
  }[];
}

const CATEGORIES: CategorySeed[] = [
  {
    slug: 'groceries',
    name: 'Groceries',
    description: 'Rice, canned goods, snacks and pantry staples.',
    children: [
      {
        slug: 'rice-and-grains',
        name: 'Rice & Grains',
        attributes: [
          { code: 'net_weight', name: 'Net weight', type: 'NUMBER', unit: 'kg', isRequired: true },
          {
            code: 'variety',
            name: 'Variety',
            type: 'SELECT',
            options: ['Sinandomeng', 'Dinorado', 'Jasmine', 'Brown'],
          },
        ],
      },
      { slug: 'canned-goods', name: 'Canned Goods' },
      { slug: 'snacks', name: 'Snacks' },
    ],
  },
  {
    slug: 'electronics',
    name: 'Electronics',
    children: [
      {
        slug: 'mobile-phones',
        name: 'Mobile Phones',
        attributes: [
          {
            code: 'storage',
            name: 'Storage',
            type: 'SELECT',
            options: ['64 GB', '128 GB', '256 GB', '512 GB'],
            isRequired: true,
          },
          { code: 'screen_size', name: 'Screen size', type: 'NUMBER', unit: 'in' },
          { code: 'dual_sim', name: 'Dual SIM', type: 'BOOLEAN' },
        ],
      },
      { slug: 'phone-accessories', name: 'Phone Accessories' },
    ],
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    attributes: [{ code: 'material', name: 'Material', type: 'TEXT' }],
    children: [
      {
        slug: 'mens-clothing',
        name: "Men's Clothing",
        children: [{ slug: 'mens-t-shirts', name: "Men's T-Shirts" }],
      },
      { slug: 'womens-clothing', name: "Women's Clothing" },
    ],
  },
];

const BRANDS = [
  { slug: 'bukid-fresh', name: 'Bukid Fresh', description: 'Locally milled rice and grains.' },
  { slug: 'isla-tech', name: 'Isla Tech' },
  { slug: 'habi-wear', name: 'Habi Wear' },
];

export async function ensureCatalogReference(prisma: PrismaClient): Promise<void> {
  const upsert = async (
    node: CategorySeed,
    parentId: string | null,
    depth: number,
    sortOrder: number,
  ) => {
    const row = await prisma.category.upsert({
      where: { slug: node.slug },
      create: {
        slug: node.slug,
        name: node.name,
        description: node.description ?? null,
        parentId,
        depth,
        sortOrder,
      },
      update: {},
    });
    for (const [index, a] of (node.attributes ?? []).entries()) {
      await prisma.categoryAttribute.upsert({
        where: { categoryId_code: { categoryId: row.id, code: a.code } },
        create: {
          categoryId: row.id,
          code: a.code,
          name: a.name,
          type: a.type,
          options: a.options ?? [],
          unit: a.unit ?? null,
          isRequired: a.isRequired ?? false,
          sortOrder: index,
        },
        update: {},
      });
    }
    for (const [index, child] of (node.children ?? []).entries()) {
      await upsert(child, row.id, depth + 1, index);
    }
  };
  for (const [index, node] of CATEGORIES.entries()) await upsert(node, null, 0, index);
  for (const brand of BRANDS) {
    await prisma.brand.upsert({
      where: { slug: brand.slug },
      create: { ...brand, description: brand.description ?? null, status: 'ACTIVE' },
      update: {},
    });
  }
}

/** Warehouses and an approved product for the demo seller. Returns true when created. */
export async function ensureDemoCatalog(prisma: PrismaClient): Promise<boolean> {
  const seller = await prisma.seller.findFirst({
    where: { owner: { email: 'seller.owner@marketplace.local' } },
    include: { stores: true, owner: true },
  });
  const store = seller?.stores.find((s) => s.slug === 'sam-sari-sari');
  if (!seller || !store) return false;
  const existing = await prisma.product.findUnique({
    where: { storeId_slug: { storeId: store.id, slug: 'sinandomeng-rice-25-kg' } },
  });
  if (existing) return false;
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'rice-and-grains' } });
  const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: 'bukid-fresh' } });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const main = await tx.warehouse.create({
      data: {
        sellerId: seller.id,
        name: 'Quezon City main',
        code: 'QC-1',
        addressLine1: '12 Mabini Street',
        barangay: 'Bagong Pag-asa',
        city: 'Quezon City',
        province: 'Metro Manila',
        postalCode: '1105',
        isDefault: true,
      },
    });
    await tx.warehouse.create({
      data: {
        sellerId: seller.id,
        name: 'Cavite overflow',
        code: 'CAV-1',
        addressLine1: '3 Aguinaldo Highway',
        city: 'Dasmariñas',
        province: 'Cavite',
        postalCode: '4114',
      },
    });
    const product = await tx.product.create({
      data: {
        sellerId: seller.id,
        storeId: store.id,
        categoryId: category.id,
        brandId: brand.id,
        name: 'Sinandomeng Rice 25 kg',
        slug: 'sinandomeng-rice-25-kg',
        description:
          'Well-milled Sinandomeng rice from Nueva Ecija. Soft and fragrant when cooked; a family staple. Packed in a 25 kg sack.',
        specifications: [{ name: 'Origin', value: 'Nueva Ecija' }],
        attributeValues: { net_weight: 25, variety: 'Sinandomeng' },
        status: 'ACTIVE',
        wholesaleEnabled: true,
        wholesaleMinOrderQuantity: 1,
        submittedAt: now,
        approvedAt: now,
        reviewedAt: now,
        createdById: seller.ownerId,
        variants: {
          create: {
            sellerId: seller.id,
            sku: 'RICE-SIN-25',
            title: 'Default',
            regularPrice: new Prisma.Decimal('500.00'),
            weightGrams: 25_000,
          },
        },
        // The tiers from the Phase 3 brief.
        priceTiers: {
          create: [
            { minQuantity: 1, unitPrice: new Prisma.Decimal('500.00') },
            { minQuantity: 10, unitPrice: new Prisma.Decimal('450.00') },
            { minQuantity: 50, unitPrice: new Prisma.Decimal('420.00') },
            { minQuantity: 100, unitPrice: new Prisma.Decimal('390.00') },
          ],
        },
        events: {
          create: [
            { type: 'CREATED', toStatus: 'DRAFT', actorId: seller.ownerId },
            {
              type: 'APPROVED',
              fromStatus: 'PENDING_APPROVAL',
              toStatus: 'ACTIVE',
              note: 'Demo data',
            },
          ],
        },
      },
      include: { variants: true },
    });
    const variant = product.variants[0]!;
    const level = await tx.stockLevel.create({
      data: {
        sellerId: seller.id,
        warehouseId: main.id,
        variantId: variant.id,
        quantityOnHand: 120,
        lowStockThreshold: 20,
      },
    });
    await tx.inventoryMovement.create({
      data: {
        sellerId: seller.id,
        warehouseId: main.id,
        variantId: variant.id,
        stockLevelId: level.id,
        type: 'STOCK_IN',
        quantityChange: 120,
        onHandAfter: 120,
        reservedAfter: 0,
        damagedAfter: 0,
        reason: 'Opening stock (demo data)',
        actorId: seller.ownerId,
      },
    });
  });
  return true;
}
