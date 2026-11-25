import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  BRAND_STATUSES,
  PLATFORM_STAFF_ROLES,
  SELLER_ROLES,
} from '@marketplace/shared-types';
import { brandListSchema, brandSchema, uuidSchema } from '@marketplace/validation';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { BrandsService } from './brands.service';
import { BrandListQueryDto, CreateBrandDto, ReviewBrandDto, UpdateBrandDto } from './catalog.dtos';

const Id = () => Param('id', new ZodValidationPipe(uuidSchema));

@ApiTags('Brands')
@Controller({ path: 'brands', version: '1' })
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @Roles(...PLATFORM_STAFF_ROLES, ...SELLER_ROLES)
  @ApiOperation({
    summary: 'Brands. Staff see all; sellers see active brands and their own requests',
  })
  @ApiQuery({ name: 'status', required: false, enum: [...BRAND_STATUSES] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(brandListSchema) })
  list(@Query() query: BrandListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.brands.list(user, query);
  }

  @Post()
  @RequirePermissions('catalog.brands.manage')
  @ApiOperation({ summary: 'Create an active brand (staff)' })
  @ApiBody({ schema: CreateBrandDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(brandSchema) })
  create(
    @Body() body: CreateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.brands.create(user, body, context);
  }

  @Post('requests')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Request a missing brand (Seller Center); usable once approved' })
  @ApiBody({ schema: CreateBrandDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(brandSchema) })
  request(
    @Body() body: CreateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.brands.create(user, body, context);
  }

  @Patch(':id')
  @RequirePermissions('catalog.brands.manage')
  @ApiOperation({ summary: 'Rename, describe, retire or reactivate a brand' })
  @ApiBody({ schema: UpdateBrandDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(brandSchema) })
  update(
    @Id() id: string,
    @Body() body: UpdateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.brands.update(user, id, body, context);
  }

  @Post(':id/review')
  @RequirePermissions('catalog.brands.manage')
  @ApiOperation({ summary: "Approve or reject a seller's brand request" })
  @ApiBody({ schema: ReviewBrandDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(brandSchema) })
  review(
    @Id() id: string,
    @Body() body: ReviewBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.brands.review(user, id, body, context);
  }
}
