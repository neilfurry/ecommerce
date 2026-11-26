import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { ThrottlingModule } from './infrastructure/throttling/throttling.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductsModule } from './modules/products/products.module';
import { DevToolsModule } from './modules/dev-tools/dev-tools.module';
import { FinanceModule } from './modules/finance/finance.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RolesModule } from './modules/roles/roles.module';
import { SellerMembersModule } from './modules/seller-members/seller-members.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { StoresModule } from './modules/stores/stores.module';
import { UsersModule } from './modules/users/users.module';
import { WholesaleModule } from './modules/wholesale/wholesale.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { LocationsModule } from './modules/locations/locations.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';

/**
 * Root module. Infrastructure modules are global; business-domain modules live in
 * src/modules/<domain> and are added here as each phase delivers them.
 */
@Module({
  imports: [
    // Infrastructure
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    QueueModule,
    // Guard order: rate limiting, CSRF, authentication, roles, permissions.
    ThrottlingModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    // Domains
    HealthModule,
    FilesModule,
    UsersModule,
    RolesModule,
    WholesaleModule,
    SellersModule,
    StoresModule,
    CatalogModule,
    ProductsModule,
    InventoryModule,
    SellerMembersModule,
    // Storefront, cart and checkout (Phase 4)
    SettingsModule,
    FinanceModule,
    LocationsModule,
    AddressesModule,
    StorefrontModule,
    WishlistModule,
    ReviewsModule,
    CartModule,
    PromotionsModule,
    OrdersModule,
    CheckoutModule,
    // Development only: every route answers 404 unless DEV_TOOLS_ENABLED=true.
    DevToolsModule,
  ],
})
export class AppModule {}
