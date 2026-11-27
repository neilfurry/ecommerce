import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, SELLER_ROLES } from '@marketplace/shared-types';
import {
  ADMIN_REPORTS,
  reportExportQuerySchema,
  reportQuerySchema,
  reportSchema,
  SELLER_REPORTS,
} from '@marketplace/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermissions, Roles } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';
import { exportReport, type ExportedFile } from './report-export';

class ReportQueryDto extends createZodDto(reportQuerySchema) {}
class ExportQueryDto extends createZodDto(reportExportQuerySchema) {}
const AdminName = () => Param('name', new ZodValidationPipe(z.enum(ADMIN_REPORTS)));
const SellerName = () => Param('name', new ZodValidationPipe(z.enum(SELLER_REPORTS)));
const file = (f: ExportedFile) =>
  new StreamableFile(f.buffer, {
    type: f.contentType,
    length: f.buffer.length,
    disposition: `attachment; filename="${f.fileName}"`,
  });

@ApiTags('Analytics')
@Controller({ path: 'reports', version: '1' })
@RequirePermissions('reports.read')
export class AdminReportsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':name')
  @ApiOperation({
    summary: `Marketplace report (${ADMIN_REPORTS.join(', ')}): KPIs, trend and table from live data`,
  })
  @ApiOkResponse({ schema: zodToOpenApi(reportSchema) })
  report(@AdminName() name: (typeof ADMIN_REPORTS)[number], @Query() query: ReportQueryDto) {
    return this.analytics.admin(name, query);
  }

  @Get(':name/export')
  @ApiOperation({ summary: 'Download a report as CSV, Excel (xlsx) or PDF' })
  async export(@AdminName() name: (typeof ADMIN_REPORTS)[number], @Query() query: ExportQueryDto) {
    return file(await exportReport(await this.analytics.admin(name, query), query.format));
  }
}

@ApiTags('Analytics (seller)')
@Controller({ path: 'seller/reports', version: '1' })
@Roles(...SELLER_ROLES)
@RequirePermissions('seller.reports.read')
export class SellerReportsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':name')
  @ApiOperation({ summary: `My report (${SELLER_REPORTS.join(', ')})` })
  @ApiOkResponse({ schema: zodToOpenApi(reportSchema) })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @SellerName() name: (typeof SELLER_REPORTS)[number],
    @Query() query: ReportQueryDto,
  ) {
    return this.analytics.seller(sellerScope(user).sellerId, name, {
      ...query,
      sellerId: undefined,
    });
  }

  @Get(':name/export')
  @ApiOperation({ summary: 'Download my report as CSV, Excel (xlsx) or PDF' })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @SellerName() name: (typeof SELLER_REPORTS)[number],
    @Query() query: ExportQueryDto,
  ) {
    const report = await this.analytics.seller(sellerScope(user).sellerId, name, {
      ...query,
      sellerId: undefined,
    });
    return file(await exportReport(report, query.format));
  }
}
