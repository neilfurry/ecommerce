import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { MockShippingProvider } from './mock-shipping.provider';
import { ShippingProvider } from './shipping-provider';
import { ShippingService } from './shipping.service';

/**
 * Binds the configured shipping provider (SHIPPING_PROVIDER). Only the mock provider exists
 * for now; a carrier integration is another class behind ShippingProvider.
 */
@Module({
  imports: [SettingsModule],
  providers: [
    MockShippingProvider,
    { provide: ShippingProvider, useExisting: MockShippingProvider },
    ShippingService,
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
