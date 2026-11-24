import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { auditLogListSchema } from '@marketplace/validation';
import { RequirePermissions } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { AuditLogQueryDto } from '../auth/auth.dtos';
import { AuditService } from './audit.service';

@ApiTags('Administration')
@Controller({ path: 'audit-logs', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Audit log, newest first' })
  @ApiQuery({
    name: 'action',
    required: false,
    description: 'Prefix, e.g. "auth." or "user.suspended"',
  })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(auditLogListSchema) })
  list(@Query() query: AuditLogQueryDto) {
    return this.audit.list(query);
  }
}
