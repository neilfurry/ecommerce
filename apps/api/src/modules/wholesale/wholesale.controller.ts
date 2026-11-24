import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  myWholesaleApplicationSchema,
  uuidSchema,
  wholesaleApplicationListSchema,
  wholesaleApplicationSchema,
} from '@marketplace/validation';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ReviewWholesaleDto, WholesaleBusinessDto, WholesaleListQueryDto } from '../auth/auth.dtos';
import { WholesaleService } from './wholesale.service';

@ApiTags('Account')
@Roles('CUSTOMER', 'WHOLESALE_CUSTOMER')
@Controller({ path: 'account/wholesale-application', version: '1' })
export class AccountWholesaleController {
  constructor(private readonly wholesale: WholesaleService) {}

  @Get()
  @ApiOperation({ summary: 'My wholesale application (null if none)' })
  @ApiOkResponse({ schema: zodToOpenApi(myWholesaleApplicationSchema) })
  async mine(@CurrentUser() user: AuthenticatedUser) {
    return { application: await this.wholesale.getMine(user.id) };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply for wholesale pricing, or resubmit after a rejection' })
  @ApiBody({ schema: WholesaleBusinessDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(wholesaleApplicationSchema) })
  submit(
    @Body() body: WholesaleBusinessDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.wholesale.submit(user.id, body, context);
  }
}

@ApiTags('Administration')
@Controller({ path: 'admin/wholesale-applications', version: '1' })
export class AdminWholesaleController {
  constructor(private readonly wholesale: WholesaleService) {}

  @Get()
  @RequirePermissions('wholesale.read')
  @ApiOperation({ summary: 'Wholesale applications (pending: oldest first)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(wholesaleApplicationListSchema) })
  list(@Query() query: WholesaleListQueryDto) {
    return this.wholesale.list(query);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('wholesale.review')
  @ApiOperation({
    summary: 'Approve (grants WHOLESALE_CUSTOMER) or reject (note required) an application',
  })
  @ApiBody({ schema: ReviewWholesaleDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(wholesaleApplicationSchema) })
  review(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body() body: ReviewWholesaleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.wholesale.review(id, body, actor, context);
  }
}
