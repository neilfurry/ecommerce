import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiTags,
} from '@nestjs/swagger';
import { type AuthenticatedUser, SELLER_ROLES } from '@marketplace/shared-types';
import {
  customerPriceListSchema,
  priceQuoteLineSchema,
  productDetailSchema,
  productListSchema,
  updateProductImageSchema,
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
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { requireFile } from '../catalog/categories.controller';
import { PricingService } from '../pricing/pricing.service';
import { ProductImagesService } from './product-images.service';
import {
  CreateProductDto,
  CustomerPriceInputDto,
  PricePreviewDto,
  ProductListQueryDto,
  ProductPricingDto,
  ProductReasonDto,
  PutPriceTiersDto,
  ReorderProductImagesDto,
  ReviewProductDto,
  SetProductOptionsDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateVariantDto,
} from './products.dtos';
import { ProductsService } from './products.service';

const Id = (name = 'id') => Param(name, new ZodValidationPipe(uuidSchema));
const detail = { schema: zodToOpenApi(productDetailSchema) };
const photoBody: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: {
      file: { type: 'string', format: 'binary' },
      altText: { type: 'string', maxLength: 200 },
      variantId: { type: 'string', format: 'uuid' },
    },
  },
};
const photoFieldsSchema = updateProductImageSchema;

@ApiTags('Products')
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ProductImagesService,
    private readonly pricing: PricingService,
  ) {}

  // ---- Lists ----------------------------------------------------------------------------------

  @Get('mine')
  @Roles(...SELLER_ROLES)
  @ApiOperation({
    summary: "My seller's products (filters: status, search, category, store, brand)",
  })
  @ApiOkResponse({ schema: zodToOpenApi(productListSchema) })
  mine(@Query() query: ProductListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.products.listMine(user, query);
  }

  @Get()
  @RequirePermissions('catalog.products.read')
  @ApiOperation({ summary: "Every seller's products (staff). PENDING_APPROVAL is oldest first" })
  @ApiOkResponse({ schema: zodToOpenApi(productListSchema) })
  list(@Query() query: ProductListQueryDto) {
    return this.products.listAll(query);
  }

  @Get('images/:imageId/:size')
  @Public()
  @ApiOperation({ summary: 'A product photo, large (max 1600 px) or thumbnail (400 px), WebP' })
  @ApiParam({ name: 'size', enum: ['large', 'thumbnail'] })
  async image(
    @Id('imageId') imageId: string,
    @Param('size', new ZodValidationPipe(z.enum(['large', 'thumbnail'])))
    size: 'large' | 'thumbnail',
    @Res({ passthrough: true }) response: Response,
  ) {
    const image = await this.images.open(imageId, size);
    // URLs carry ?v=<file id>; a replaced photo gets a new URL.
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(image.body, { type: image.contentType, length: image.sizeBytes });
  }

  // ---- One product --------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'A product (own seller, or staff with catalog.products.read)' })
  @ApiOkResponse(detail)
  get(@Id() id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.products.get(user, id);
  }

  @Post()
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Create a draft product with one default variant (verified sellers)' })
  @ApiBody({ schema: CreateProductDto.openApiSchema })
  @ApiCreatedResponse(detail)
  create(
    @Body() body: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.create(user, body, context);
  }

  @Patch(':id')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({
    summary: 'Edit product details. Content changes to an approved product send it back to review',
  })
  @ApiBody({ schema: UpdateProductDto.openApiSchema })
  @ApiOkResponse(detail)
  update(
    @Id() id: string,
    @Body() body: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.update(user, id, body, context);
  }

  @Put(':id/options')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Set options (e.g. Size × Color) and generate the missing variants' })
  @ApiBody({ schema: SetProductOptionsDto.openApiSchema })
  @ApiOkResponse(detail)
  options(
    @Id() id: string,
    @Body() body: SetProductOptionsDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.setOptions(user, id, body, context);
  }

  @Patch(':id/variants/:variantId')
  @Roles(...SELLER_ROLES)
  @ApiOperation({
    summary:
      'Edit a variant. SKU, barcode, measures and status need seller.products.manage; prices need seller.pricing.manage',
  })
  @ApiBody({ schema: UpdateVariantDto.openApiSchema })
  @ApiOkResponse(detail)
  variant(
    @Id() id: string,
    @Id('variantId') variantId: string,
    @Body() body: UpdateVariantDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.updateVariant(user, id, variantId, body, context);
  }

  // ---- Lifecycle ----------------------------------------------------------------------------

  @Post(':id/submit')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({
    summary: 'Submit a draft or rejected product for approval (422 lists what is missing)',
  })
  @ApiOkResponse(detail)
  submit(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.submit(user, id, context);
  }

  @Post(':id/deactivate')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Hide an active product from shoppers' })
  @ApiOkResponse(detail)
  deactivate(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.deactivate(user, id, context);
  }

  @Post(':id/activate')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Show a hidden approved product again' })
  @ApiOkResponse(detail)
  activate(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.activate(user, id, context);
  }

  @Post(':id/archive')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Archive a product (kept for order history)' })
  @ApiOkResponse(detail)
  archive(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.archive(user, id, context);
  }

  @Post(':id/restore')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Restore an archived product as a draft' })
  @ApiOkResponse(detail)
  restore(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.restore(user, id, context);
  }

  @Post(':id/review')
  @RequirePermissions('catalog.products.review')
  @ApiOperation({ summary: 'Approve or reject a product waiting for approval' })
  @ApiBody({ schema: ReviewProductDto.openApiSchema })
  @ApiOkResponse(detail)
  review(
    @Id() id: string,
    @Body() body: ReviewProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.review(user, id, body, context);
  }

  @Post(':id/take-down')
  @RequirePermissions('catalog.products.review')
  @ApiOperation({
    summary: 'Take a product down (moderation). The seller must fix and resubmit it',
  })
  @ApiBody({ schema: ProductReasonDto.openApiSchema })
  @ApiOkResponse(detail)
  takeDown(
    @Id() id: string,
    @Body() body: ProductReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.products.takeDown(user, id, body.reason, context);
  }

  // ---- Photos -------------------------------------------------------------------------------

  @Post(':id/images')
  @RequirePermissions('seller.products.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Add a photo (JPEG, PNG or WebP; at least 200 px; stored as optimised WebP + thumbnail)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(photoBody)
  @ApiCreatedResponse(detail)
  addImage(
    @Id() id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(photoFieldsSchema)) fields: z.output<typeof photoFieldsSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.images.add(user, id, requireFile(file), fields, context);
  }

  @Put(':id/images/order')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Reorder photos; the first is the main photo' })
  @ApiBody({ schema: ReorderProductImagesDto.openApiSchema })
  @ApiOkResponse(detail)
  reorder(
    @Id() id: string,
    @Body() body: ReorderProductImagesDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.images.reorder(user, id, body.imageIds, context);
  }

  @Patch(':id/images/:imageId')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Change alt text or the variant a photo shows' })
  @ApiBody({ schema: UpdateProductImageDto.openApiSchema })
  @ApiOkResponse(detail)
  updateImage(
    @Id() id: string,
    @Id('imageId') imageId: string,
    @Body() body: UpdateProductImageDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.images.update(user, id, imageId, body, context);
  }

  @Put(':id/images/:imageId/file')
  @RequirePermissions('seller.products.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Replace a photo, keeping its place' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(photoBody)
  @ApiOkResponse(detail)
  replaceImage(
    @Id() id: string,
    @Id('imageId') imageId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.images.replace(user, id, imageId, requireFile(file), context);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions('seller.products.manage')
  @ApiOperation({ summary: 'Delete a photo' })
  @ApiOkResponse(detail)
  removeImage(
    @Id() id: string,
    @Id('imageId') imageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.images.remove(user, id, imageId, context);
  }

  // ---- Pricing ------------------------------------------------------------------------------

  @Put(':id/pricing')
  @RequirePermissions('seller.pricing.manage')
  @ApiOperation({
    summary: 'Product pricing: currency, order quantities, wholesale on/off and minimum',
  })
  @ApiBody({ schema: ProductPricingDto.openApiSchema })
  @ApiOkResponse(detail)
  setPricing(
    @Id() id: string,
    @Body() body: ProductPricingDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.pricing.setProductPricing(user, id, body, context);
  }

  @Put(':id/price-tiers')
  @RequirePermissions('seller.pricing.manage')
  @ApiOperation({ summary: 'Replace the wholesale price tiers (product-wide or per variant)' })
  @ApiBody({ schema: PutPriceTiersDto.openApiSchema })
  @ApiOkResponse(detail)
  tiers(
    @Id() id: string,
    @Body() body: PutPriceTiersDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.pricing.putTiers(user, id, body, context);
  }

  @Get(':id/customer-prices')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'Prices agreed with individual customers' })
  @ApiOkResponse({ schema: zodToOpenApi(customerPriceListSchema) })
  customerPrices(@Id() id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.listCustomerPrices(user, id);
  }

  @Post(':id/customer-prices')
  @RequirePermissions('seller.pricing.manage')
  @ApiOperation({ summary: 'Agree a price with one customer (by their account email)' })
  @ApiBody({ schema: CustomerPriceInputDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(customerPriceListSchema) })
  addCustomerPrice(
    @Id() id: string,
    @Body() body: CustomerPriceInputDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.pricing.addCustomerPrice(user, id, body, context);
  }

  @Delete(':id/customer-prices/:priceId')
  @RequirePermissions('seller.pricing.manage')
  @ApiOperation({ summary: 'Remove a customer price' })
  @ApiOkResponse({ schema: zodToOpenApi(customerPriceListSchema) })
  removeCustomerPrice(
    @Id() id: string,
    @Id('priceId') priceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.pricing.removeCustomerPrice(user, id, priceId, context);
  }

  @Post(':id/price-preview')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'What a retail or wholesale buyer (or a named customer) would pay' })
  @ApiBody({ schema: PricePreviewDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(priceQuoteLineSchema) })
  preview(@Id() id: string, @Body() body: PricePreviewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.preview(user, id, body);
  }
}
