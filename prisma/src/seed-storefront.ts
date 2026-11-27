import { Prisma, type PrismaClient } from './generated/prisma/client';

/**
 * Phase 4 seed data.
 *
 * Always: the default commission rate (5%) when none exists; administrators change it in the
 * Admin Console. Development only: two more verified sellers so a multi-seller checkout can
 * be tried (a laptop from one seller, a mouse and a keyboard from another), PSGC locations
 * for the demo warehouses, an address for the demo customer, an approved wholesale customer,
 * coupons, a running flash sale and featured products and stores. Idempotent.
 */

type Tx = Prisma.TransactionClient;
const D = (value: string) => new Prisma.Decimal(value);

export async function ensureDefaultCommission(prisma: PrismaClient): Promise<boolean> {
  const existing = await prisma.commissionRule.findFirst({ where: { scope: 'DEFAULT' } });
  if (existing) return false;
  await prisma.commissionRule.create({
    data: {
      scope: 'DEFAULT',
      type: 'PERCENTAGE',
      ratePercent: D('5.00'),
      reason: 'Initial default',
    },
  });
  return true;
}

/** Finds a barangay by name inside a city or municipality (including Manila's districts). */
async function place(db: Tx | PrismaClient, barangay: string, city: string) {
  const row = await db.phLocation.findFirst({
    where: {
      level: 'BARANGAY',
      name: barangay,
      parent: { OR: [{ name: city }, { parent: { name: city } }] },
    },
    select: { code: true, regionCode: true, provinceCode: true, cityCode: true },
  });
  if (!row?.cityCode) {
    throw new Error(
      `Location ${barangay}, ${city} not found. Run "pnpm db:import-locations" first.`,
    );
  }
  return {
    regionCode: row.regionCode,
    provinceCode: row.provinceCode,
    cityCode: row.cityCode,
    barangayCode: row.code,
  };
}

interface DemoVariant {
  sku: string;
  title: string;
  price: string;
  salePrice?: string;
  weightGrams: number;
  dims: [string, string, string];
  stock: number;
  option?: string;
}

interface DemoProduct {
  slug: string;
  name: string;
  categorySlug: string;
  brandSlug: string;
  description: string;
  specifications: { name: string; value: string }[];
  attributeValues: Record<string, string | number | boolean>;
  optionName?: string;
  variants: DemoVariant[];
}

interface DemoShop {
  ownerEmail: string;
  businessName: string;
  mobile: string;
  store: { name: string; slug: string; description: string };
  warehouse: {
    name: string;
    code: string;
    addressLine1: string;
    barangay: string;
    city: string;
    province: string;
    postalCode: string;
  };
  products: DemoProduct[];
}

const SHOPS: DemoShop[] = [
  {
    ownerEmail: 'seller2.owner@marketplace.local',
    businessName: 'Isla Tech Gadgets',
    mobile: '+639170000004',
    store: {
      name: 'Isla Tech Gadgets',
      slug: 'isla-tech',
      description: 'Laptops and gadgets, shipped from Cebu City.',
    },
    warehouse: {
      name: 'Cebu City store',
      code: 'CEB-1',
      addressLine1: '88 Gorordo Avenue',
      barangay: 'Lahug',
      city: 'City of Cebu',
      province: 'Cebu',
      postalCode: '6000',
    },
    products: [
      {
        slug: 'isla-tech-aero-14-laptop',
        name: 'Isla Tech Aero 14 Laptop',
        categorySlug: 'laptops',
        brandSlug: 'isla-tech',
        description:
          'A light 14-inch laptop for school and work: 1.4 kg, all-day battery, backlit keyboard and a full HD screen.',
        specifications: [
          { name: 'Processor', value: '8-core, up to 4.4 GHz' },
          { name: 'Battery', value: 'Up to 12 hours' },
          { name: 'Warranty', value: '1 year' },
        ],
        attributeValues: { ram: '16 GB', screen_size: 14 },
        optionName: 'Storage',
        variants: [
          {
            sku: 'AERO14-512',
            title: '512 GB',
            option: '512 GB',
            price: '32999.00',
            weightGrams: 1900,
            dims: ['38', '27', '6'],
            stock: 15,
          },
          {
            sku: 'AERO14-1TB',
            title: '1 TB',
            option: '1 TB',
            price: '37999.00',
            weightGrams: 1900,
            dims: ['38', '27', '6'],
            stock: 6,
          },
        ],
      },
    ],
  },
  {
    ownerEmail: 'seller3.owner@marketplace.local',
    businessName: 'Click & Type Peripherals',
    mobile: '+639170000005',
    store: {
      name: 'Click & Type',
      slug: 'click-and-type',
      description: 'Keyboards, mice and desk accessories from Davao City.',
    },
    warehouse: {
      name: 'Davao warehouse',
      code: 'DVO-1',
      addressLine1: '21 San Pedro Street',
      barangay: 'Barangay 1-A',
      city: 'City of Davao',
      province: 'Davao del Sur',
      postalCode: '8000',
    },
    products: [
      {
        slug: 'keytap-silent-wireless-mouse',
        name: 'Keytap Silent Wireless Mouse',
        categorySlug: 'computer-accessories',
        brandSlug: 'keytap',
        description: 'Quiet clicks, 18-month battery life and a USB receiver that stores inside.',
        specifications: [{ name: 'Connection', value: '2.4 GHz USB receiver' }],
        attributeValues: { wireless: true },
        optionName: 'Color',
        variants: [
          {
            sku: 'KT-MOUSE-BLK',
            title: 'Black',
            option: 'Black',
            price: '599.00',
            weightGrams: 120,
            dims: ['12', '8', '5'],
            stock: 80,
          },
          {
            sku: 'KT-MOUSE-WHT',
            title: 'White',
            option: 'White',
            price: '599.00',
            weightGrams: 120,
            dims: ['12', '8', '5'],
            stock: 40,
          },
        ],
      },
      {
        slug: 'keytap-mechanical-keyboard',
        name: 'Keytap Mechanical Keyboard',
        categorySlug: 'computer-accessories',
        brandSlug: 'keytap',
        description:
          'Tenkeyless mechanical keyboard with hot-swappable switches and white backlight.',
        specifications: [{ name: 'Switches', value: 'Brown (tactile)' }],
        attributeValues: { wireless: false },
        variants: [
          {
            sku: 'KT-KB-TKL',
            title: 'Default',
            price: '2499.00',
            salePrice: '2199.00',
            weightGrams: 900,
            dims: ['40', '16', '5'],
            stock: 30,
          },
        ],
      },
    ],
  },
];

async function createProduct(
  tx: Tx,
  seller: { id: string; ownerId: string },
  storeId: string,
  warehouseId: string,
  spec: DemoProduct,
) {
  const category = await tx.category.findUniqueOrThrow({ where: { slug: spec.categorySlug } });
  const brand = await tx.brand.findUniqueOrThrow({ where: { slug: spec.brandSlug } });
  const now = new Date();
  const product = await tx.product.create({
    data: {
      sellerId: seller.id,
      storeId,
      categoryId: category.id,
      brandId: brand.id,
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      specifications: spec.specifications,
      attributeValues: spec.attributeValues,
      status: 'ACTIVE',
      submittedAt: now,
      reviewedAt: now,
      approvedAt: now,
      createdById: seller.ownerId,
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
  });
  const option = spec.optionName
    ? await tx.productOption.create({
        data: {
          productId: product.id,
          name: spec.optionName,
          position: 0,
          values: {
            create: spec.variants.map((v, position) => ({ value: v.option!, position })),
          },
        },
        include: { values: true },
      })
    : null;
  for (const [position, v] of spec.variants.entries()) {
    const value = option?.values.find((x) => x.value === v.option);
    const variant = await tx.productVariant.create({
      data: {
        productId: product.id,
        sellerId: seller.id,
        sku: v.sku,
        title: v.title,
        optionKey: value ? value.id : '',
        regularPrice: D(v.price),
        salePrice: v.salePrice ? D(v.salePrice) : null,
        weightGrams: v.weightGrams,
        lengthCm: D(v.dims[0]),
        widthCm: D(v.dims[1]),
        heightCm: D(v.dims[2]),
        position,
        ...(value ? { optionValues: { create: { optionValueId: value.id } } } : {}),
      },
    });
    const level = await tx.stockLevel.create({
      data: {
        sellerId: seller.id,
        warehouseId,
        variantId: variant.id,
        quantityOnHand: v.stock,
        lowStockThreshold: 5,
      },
    });
    await tx.inventoryMovement.create({
      data: {
        sellerId: seller.id,
        warehouseId,
        variantId: variant.id,
        stockLevelId: level.id,
        type: 'STOCK_IN',
        quantityChange: v.stock,
        onHandAfter: v.stock,
        reservedAfter: 0,
        damagedAfter: 0,
        reason: 'Opening stock (demo data)',
        actorId: seller.ownerId,
      },
    });
  }
  return product;
}

/** A verified seller with a store, a located warehouse and approved products. */
async function ensureDemoShop(prisma: PrismaClient, shop: DemoShop): Promise<boolean> {
  const owner = await prisma.user.findUnique({
    where: { email: shop.ownerEmail },
    include: { ownedSeller: true },
  });
  if (!owner || owner.ownedSeller) return false;
  const location = await place(prisma, shop.warehouse.barangay, shop.warehouse.city);
  const now = new Date();
  await prisma.$transaction(
    async (tx) => {
      const seller = await tx.seller.create({
        data: {
          businessName: shop.businessName,
          businessType: 'CORPORATION',
          ownerId: owner.id,
          email: owner.email,
          mobile: shop.mobile,
          addressLine1: shop.warehouse.addressLine1,
          barangay: shop.warehouse.barangay,
          city: shop.warehouse.city,
          province: shop.warehouse.province,
          postalCode: shop.warehouse.postalCode,
          registrationNumber: `SEC-${shop.store.slug.toUpperCase()}`,
          tin: '987654321000',
          vatRegistered: true,
          status: 'VERIFIED',
          submittedAt: now,
          reviewedAt: now,
          verifiedAt: now,
          events: {
            create: [
              { type: 'REGISTERED', toStatus: 'PENDING' },
              {
                type: 'APPROVED',
                fromStatus: 'UNDER_REVIEW',
                toStatus: 'VERIFIED',
                note: 'Demo seller',
              },
            ],
          },
          members: { create: [{ userId: owner.id }] },
        },
      });
      const store = await tx.store.create({
        data: {
          sellerId: seller.id,
          name: shop.store.name,
          slug: shop.store.slug,
          description: shop.store.description,
          email: owner.email,
          phone: shop.mobile,
          city: shop.warehouse.city,
          province: shop.warehouse.province,
          settings: { create: {} },
        },
      });
      const warehouse = await tx.warehouse.create({
        data: {
          sellerId: seller.id,
          name: shop.warehouse.name,
          code: shop.warehouse.code,
          addressLine1: shop.warehouse.addressLine1,
          barangay: shop.warehouse.barangay,
          city: shop.warehouse.city,
          province: shop.warehouse.province,
          postalCode: shop.warehouse.postalCode,
          ...location,
          isDefault: true,
        },
      });
      for (const product of shop.products) {
        await createProduct(
          tx,
          { id: seller.id, ownerId: owner.id },
          store.id,
          warehouse.id,
          product,
        );
      }
    },
    { timeout: 30_000 },
  );
  return true;
}

/** Fills in PSGC codes for the Phase 3 demo warehouses (created before locations existed). */
async function locateLegacyWarehouses(prisma: PrismaClient) {
  const fixes: { code: string; barangay: string; city: string }[] = [
    { code: 'QC-1', barangay: 'Bagong Pag-asa', city: 'Quezon City' },
    { code: 'CAV-1', barangay: 'Salitran I', city: 'City of Dasmariñas' },
  ];
  for (const fix of fixes) {
    const rows = await prisma.warehouse.findMany({
      where: {
        code: fix.code,
        regionCode: null,
        seller: { owner: { email: 'seller.owner@marketplace.local' } },
      },
    });
    if (rows.length === 0) continue;
    const location = await place(prisma, fix.barangay, fix.city);
    await prisma.warehouse.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: location,
    });
  }
}

async function ensureCustomerData(prisma: PrismaClient) {
  const customer = await prisma.user.findUnique({
    where: { email: 'customer@marketplace.local' },
    include: { addresses: true },
  });
  if (customer && customer.addresses.length === 0) {
    await prisma.customerAddress.create({
      data: {
        userId: customer.id,
        label: 'Home',
        recipientName: `${customer.firstName} ${customer.lastName}`,
        mobile: customer.mobile ?? '+639170000001',
        ...(await place(prisma, 'Bagong Pag-asa', 'Quezon City')),
        postalCode: '1105',
        streetAddress: '45 Kalayaan Street',
        addressLine2: 'Blue gate near the barangay hall',
        isDefault: true,
      },
    });
  }
  const wholesale = await prisma.user.findUnique({
    where: { email: 'wholesale@marketplace.local' },
    include: { addresses: true, wholesaleApplication: true },
  });
  if (wholesale && !wholesale.wholesaleApplication) {
    await prisma.wholesaleApplication.create({
      data: {
        userId: wholesale.id,
        businessName: 'Wilma’s Mini Mart',
        tin: '111222333000',
        businessAddress: '7 Taft Avenue, Pasay City',
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewNote: 'Demo data',
      },
    });
  }
  if (wholesale && wholesale.addresses.length === 0) {
    await prisma.customerAddress.create({
      data: {
        userId: wholesale.id,
        label: 'Store',
        recipientName: 'Wilma Wholesale',
        mobile: wholesale.mobile ?? '+639170000003',
        ...(await place(prisma, 'Barangay 76', 'Pasay City')),
        postalCode: '1300',
        streetAddress: '7 Taft Avenue',
        isDefault: true,
      },
    });
  }
}

async function ensurePromotions(prisma: PrismaClient) {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@marketplace.local' } });
  if (!admin) return;
  const now = new Date();
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const sellerOf = (email: string) =>
    prisma.seller.findFirst({ where: { owner: { email } }, include: { owner: true } });
  const isla = await sellerOf('seller2.owner@marketplace.local');
  const click = await sellerOf('seller3.owner@marketplace.local');

  const coupons: Prisma.CouponUncheckedCreateInput[] = [
    {
      code: 'WELCOME100',
      scope: 'PLATFORM',
      name: '₱100 off your order',
      description: 'For orders of ₱1,000 or more.',
      type: 'FIXED_AMOUNT',
      value: D('100'),
      minSpend: D('1000'),
      startsAt: now,
      endsAt: inDays(365),
      perCustomerLimit: 1,
      createdById: admin.id,
    },
    {
      code: 'FREESHIP',
      scope: 'PLATFORM',
      name: 'Free shipping up to ₱150',
      description: 'On orders of ₱500 or more.',
      type: 'FREE_SHIPPING',
      value: D('0'),
      maxDiscount: D('150'),
      minSpend: D('500'),
      startsAt: now,
      endsAt: inDays(365),
      perCustomerLimit: 5,
      createdById: admin.id,
    },
  ];
  if (isla) {
    coupons.push({
      code: 'ISLA500',
      scope: 'SELLER',
      sellerId: isla.id,
      name: '₱500 off Isla Tech laptops',
      type: 'FIXED_AMOUNT',
      value: D('500'),
      minSpend: D('20000'),
      startsAt: now,
      endsAt: inDays(180),
      usageLimit: 100,
      perCustomerLimit: 1,
      createdById: isla.ownerId,
    });
  }
  if (click) {
    coupons.push({
      code: 'CLICK10',
      scope: 'SELLER',
      sellerId: click.id,
      name: '10% off Click & Type',
      type: 'PERCENTAGE',
      value: D('10'),
      maxDiscount: D('300'),
      minSpend: D('1000'),
      startsAt: now,
      endsAt: inDays(180),
      perCustomerLimit: 2,
      createdById: click.ownerId,
    });
  }
  for (const coupon of coupons) {
    await prisma.coupon.upsert({ where: { code: coupon.code }, create: coupon, update: {} });
  }

  if ((await prisma.flashSale.count()) === 0 && click) {
    const mouse = await prisma.productVariant.findFirst({
      where: { sellerId: click.id, sku: 'KT-MOUSE-BLK' },
    });
    if (mouse) {
      await prisma.flashSale.create({
        data: {
          title: 'Payday Flash Sale',
          startsAt: now,
          endsAt: inDays(30),
          createdById: admin.id,
          items: {
            create: {
              sellerId: click.id,
              productId: mouse.productId,
              variantId: mouse.id,
              flashPrice: D('399.00'),
              quantityLimit: 50,
              perOrderLimit: 2,
            },
          },
        },
      });
    }
  }

  const picks = [
    ['isla-tech', 'isla-tech-aero-14-laptop'],
    ['click-and-type', 'keytap-mechanical-keyboard'],
    ['sam-sari-sari', 'sinandomeng-rice-25-kg'],
  ] as const;
  const featured = (
    await Promise.all(
      picks.map(([storeSlug, slug]) =>
        prisma.product.findFirst({ where: { slug, store: { slug: storeSlug } } }),
      ),
    )
  ).filter((p) => p !== null);
  for (const [position, product] of featured.entries()) {
    await prisma.featuredProduct.upsert({
      where: { productId: product.id },
      create: { productId: product.id, position },
      update: {},
    });
  }
  const stores = await prisma.store.findMany({
    where: { slug: { in: ['sam-sari-sari', 'isla-tech', 'click-and-type'] } },
  });
  for (const [position, store] of stores.entries()) {
    await prisma.featuredStore.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id, position },
      update: {},
    });
  }
}

/** Development-only storefront demo data. Returns how many shops were created. */
export async function ensureDemoStorefront(prisma: PrismaClient): Promise<number> {
  let created = 0;
  for (const shop of SHOPS) if (await ensureDemoShop(prisma, shop)) created += 1;
  await locateLegacyWarehouses(prisma);
  await ensureCustomerData(prisma);
  await ensurePromotions(prisma);
  return created;
}
