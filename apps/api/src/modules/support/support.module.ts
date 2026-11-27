import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import {
  CustomerSupportController,
  SellerSupportController,
  StaffSupportController,
} from './support.controller';
import { SupportService } from './support.service';

/** Customer support tickets (Phase 7, ADR 0034). */
@Module({
  imports: [FilesModule],
  controllers: [CustomerSupportController, SellerSupportController, StaffSupportController],
  providers: [SupportService],
})
export class SupportModule {}
