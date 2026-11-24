import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  type ApiBodyOptions,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthenticatedUser, SELLER_ROLES, STORE_STATUSES } from '@marketplace/shared-types';
import {
  myStoresSchema,
  publicStoreSchema,
  slugAvailabilitySchema,
  storeListSchema,
  storeSchema,
  uuidSchema,
} from '@marketplace/validation';
import type { Response } from 'express';
import { z } from 'zod';
import {
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  CreateStoreDto,
  StoreListQueryDto,
  StoreReasonDto,
  UpdateStoreDto,
  UpdateStoreSettingsDto,
} from './stores.dtos';
import { type ImageKind, StoresService } from './stores.service';

const Id = () => Param('id', new ZodValidationPipe(uuidSchema));
const Kind = () => Param('kind', new ZodValidationPipe(z.enum(['logo', 'banner'])));
const imageBody: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

@ApiTags('Stores')
@Controller({ path: 'stores', version: '1' })
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  // ---- Public ----------------------------------------------------------------------------

  @Get('slug-availability')
  @Public()
  @ApiOperation({ summary: 'Whether a store link (slug) is free' })
  @ApiQuery({ name: 'slug', required: true })
  @ApiOkResponse({ schema: zodToOpenApi(slugAvailabilitySchema) })
  availability(@Query('slug') slug = '') {
    return this.stores.slugAvailability(slug.slice(0, 100));
  }

  @Get('by-slug/:slug')
  @Public()
  @ApiOperation({ summary: 'A store as shoppers see it (open stores of verified sellers only)' })
  @ApiOkResponse({ schema: zodToOpenApi(publicStoreSchema) })
  bySlug(@Param('slug') slug: string) {
    return this.stores.publicBySlug(slug.toLowerCase().slice(0, 60));
  }

  // ---- Seller Center ---------------------------------------------------------------------

  @Get('mine')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "My seller's stores, and whether another can be created" })
  @ApiOkResponse({ schema: zodToOpenApi(myStoresSchema) })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.stores.mine(user);
  }

  @Post()
  @RequirePermissions('seller.store.manage')
  @ApiOperation({ summary: 'Create a store (verified sellers only; at most 5)' })
  @ApiBody({ schema: CreateStoreDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(storeSchema) })
  create(
    @Body() body: CreateStoreDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.create(user, body, context);
  }

  // ---- Administration (list) -------------------------------------------------------------

  @Get()
  @RequirePermissions('stores.read')
  @ApiOperation({ summary: 'All stores' })
  @ApiQuery({ name: 'status', required: false, enum: [...STORE_STATUSES] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sellerId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(storeListSchema) })
  list(@Query() query: StoreListQueryDto) {
    return this.stores.list(query);
  }

  // ---- One store ------------------------------------------------------------------------

  @Get(':id/:kind')
  @Public()
  @ApiOperation({ summary: 'Store logo or banner image (public)' })
  @ApiParam({ name: 'kind', enum: ['logo', 'banner'] })
  async image(
    @Id() id: string,
    @Kind() kind: ImageKind,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.stores.openImage(id, kind);
    // URLs carry ?v=<file id>, so a changed image gets a new URL.
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(image.body, { type: image.contentType, length: image.sizeBytes });
  }

  @Get(':id')
  @ApiOperation({ summary: 'A store (own seller, or staff with stores.read)' })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  get(@Id() id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stores.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions('seller.store.manage')
  @ApiOperation({ summary: 'Edit store details' })
  @ApiBody({ schema: UpdateStoreDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  update(
    @Id() id: string,
    @Body() body: UpdateStoreDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.update(user, id, body, context);
  }

  @Put(':id/settings')
  @RequirePermissions('seller.store.manage')
  @ApiOperation({ summary: 'Edit store settings and branding' })
  @ApiBody({ schema: UpdateStoreSettingsDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  settings(
    @Id() id: string,
    @Body() body: UpdateStoreSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.updateSettings(user, id, body, context);
  }

  @Put(':id/:kind')
  @RequirePermissions('seller.store.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Replace the logo or banner (PNG, JPEG or WebP)' })
  @ApiParam({ name: 'kind', enum: ['logo', 'banner'] })
  @ApiConsumes('multipart/form-data')
  @ApiBody(imageBody)
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  setImage(
    @Id() id: string,
    @Kind() kind: ImageKind,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    if (!file) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Attach an image in the "file" field.',
        [{ path: 'file', message: 'Required' }],
      );
    }
    return this.stores.setImage(
      user,
      id,
      kind,
      { buffer: file.buffer, originalName: file.originalname },
      context,
    );
  }

  @Delete(':id/:kind')
  @RequirePermissions('seller.store.manage')
  @ApiOperation({ summary: 'Remove the logo or banner' })
  @ApiParam({ name: 'kind', enum: ['logo', 'banner'] })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  removeImage(
    @Id() id: string,
    @Kind() kind: ImageKind,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.removeImage(user, id, kind, context);
  }

  @Post(':id/open')
  @RequirePermissions('seller.store.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Show the store to shoppers' })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  open(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.setOpen(user, id, true, context);
  }

  @Post(':id/close')
  @RequirePermissions('seller.store.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide the store from shoppers' })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  close(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.setOpen(user, id, false, context);
  }

  @Post(':id/suspend')
  @RequirePermissions('stores.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a store (admin); the seller cannot reopen it' })
  @ApiBody({ schema: StoreReasonDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  suspend(
    @Id() id: string,
    @Body() body: StoreReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.suspend(id, body.reason, actor, context);
  }

  @Post(':id/reinstate')
  @RequirePermissions('stores.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lift a store suspension (the store opens again)' })
  @ApiBody({ schema: StoreReasonDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(storeSchema) })
  reinstate(
    @Id() id: string,
    @Body() body: StoreReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.stores.reinstate(id, body.reason, actor, context);
  }
}
