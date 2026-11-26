import { Module } from '@nestjs/common';
import { CommissionRulesService } from './commission-rules.service';
import { PlatformSettingsService } from './platform-settings.service';
import { SettingsController } from './settings.controller';
import { TaxRulesService } from './tax-rules.service';

@Module({
  controllers: [SettingsController],
  providers: [PlatformSettingsService, CommissionRulesService, TaxRulesService],
  exports: [PlatformSettingsService, CommissionRulesService, TaxRulesService],
})
export class SettingsModule {}
