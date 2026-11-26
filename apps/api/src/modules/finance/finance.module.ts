import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BalancesService } from './balances.service';
import { ExpensesService } from './expenses.service';
import { FinanceController } from './finance.controller';
import { LedgerService } from './ledger.service';
import { PayoutsService } from './payouts.service';
import { ReportsService } from './reports.service';
import { SellerFinanceController, SellerInvoiceController } from './seller-finance.controller';
import { SettlementsService } from './settlements.service';

/**
 * Phase 6: double-entry ledger, seller balances, settlements, payouts, expenses, tax and
 * service invoices, accounting reports (ADR 0026–0029).
 */
@Module({
  imports: [SettingsModule],
  controllers: [FinanceController, SellerFinanceController, SellerInvoiceController],
  providers: [
    LedgerService,
    BalancesService,
    SettlementsService,
    PayoutsService,
    ExpensesService,
    ReportsService,
  ],
  exports: [BalancesService],
})
export class FinanceModule {}
