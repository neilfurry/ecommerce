import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { DevToolsEnabledGuard } from '../dev-tools/dev-tools-enabled.guard';
import { DevInventoryController, InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [LocationsModule],
  controllers: [InventoryController, DevInventoryController],
  providers: [InventoryService, ReservationsService, DevToolsEnabledGuard],
  exports: [InventoryService, ReservationsService],
})
export class InventoryModule {}
