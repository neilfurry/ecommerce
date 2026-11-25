import { Module } from '@nestjs/common';
import { DevToolsEnabledGuard } from '../dev-tools/dev-tools-enabled.guard';
import { DevInventoryController, InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ReservationsService } from './reservations.service';

@Module({
  controllers: [InventoryController, DevInventoryController],
  providers: [InventoryService, ReservationsService, DevToolsEnabledGuard],
  exports: [InventoryService, ReservationsService],
})
export class InventoryModule {}
