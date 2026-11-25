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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  bannerAdminListSchema,
  bannerAdminSchema,
  bannerInputSchema,
  featuredItemsSchema,
  homePageSchema,
  productSearchQuerySchema,
  productSearchResultSchema,
  putFeaturedProductsSchema,
  putFeaturedStoresSchema,
  searchSuggestionSchema,
  storefrontProductSchema,
  updateBannerSchema,
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
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { requireFile } from '../catalog/categories.controller';
import { StorefrontCatalogService } from './catalog.service';
import { HomeService } from './home.service';

class ProductSearchQueryDto extends createZodDto(productSearchQuerySchema) {}
class SuggestQueryDto extends createZodDto(
  z.object({ q: z.string().trim().max(100).default('') }),
) {}
class BannerInputDto extends createZodDto(bannerInputSchema) {}
class UpdateBannerDto extends createZodDto(updateBannerSchema) {}
class PutFeaturedProductsDto extends createZodDto(putFeaturedProductsSchema) {}
class PutFeaturedStoresDto extends createZodDto(putFeaturedStoresSchema) {}
const Id = () => Param('id', new ZodValidationPipe(uuidSchema));

const bannerUpload: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file', 'title'],
    properties: {
      file: { type: 'string', format: 'binary', description: 'JPEG, PNG or WebP, at least 300 px' },
      ...((zodToOpenApi(bannerInputSchema) as { properties?: object }).properties ?? {}),
    },
  },
};

/** What shoppers browse: search, suggestions and product pages. */
@ApiTags('Catalog (public)')
@Controller({ path: 'catalog', version: '1' })
export class StorefrontCatalogController {
  constructor(private readonly catalog: StorefrontCatalogService) {}

  @Get('products')
  @Public()
  @ApiOperation({
    summary:
      'Search products: keywords, category (with subcategories), store, seller, brands, price ' +
      'range, rating, in stock, wholesale; sorted by relevance, newest, price, best selling or rating',
  })
  @ApiOkResponse({ schema: zodToOpenApi(productSearchResultSchema) })
  search(@Query() query: ProductSearchQueryDto) {
    return this.catalog.searchProducts(query);
  }

  @Get('suggest')
  @Public()
  @ApiOperation({ summary: 'Search-as-you-type suggestions: products, categories and stores' })
  @ApiOkResponse({ schema: zodToOpenApi(searchSuggestionSchema) })
  suggest(@Query() query: SuggestQueryDto) {
    return this.catalog.suggest(query.q);
  }

  @Get('products/:id')
  @Public()
  @ApiOperation({ summary: 'A product page, priced for the person asking (retail for guests)' })
  @ApiOkResponse({ schema: zodToOpenApi(storefrontProductSchema) })
  product(@Id() id: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    return this.catalog.product(user, id);
  }
}

/** The home page and its content (banners, featured products and stores). */
@ApiTags('Storefront')
@Controller({ path: 'storefront', version: '1' })
export class StorefrontController {
  constructor(private readonly home: HomeService) {}

  @Get('home')
  @Public()
  @ApiOperation({
    summary:
      'Home page: banners, categories, flash sale, featured, best sellers, recommended ' +
      '(personal when signed in) and featured stores',
  })
  @ApiOkResponse({ schema: zodToOpenApi(homePageSchema) })
  homePage(@CurrentUser() user: AuthenticatedUser | undefined) {
    return this.home.home(user);
  }

  @Get('banners/:id/image')
  @Public()
  @ApiOperation({ summary: 'Banner image (public, WebP)' })
  async bannerImage(@Id() id: string, @Res({ passthrough: true }) response: Response) {
    const image = await this.home.openBannerImage(id);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(image.body, { type: image.contentType, length: image.sizeBytes });
  }

  @Get('banners')
  @RequirePermissions('marketing.manage')
  @ApiOperation({ summary: 'Every banner, including inactive and scheduled ones' })
  @ApiOkResponse({ schema: zodToOpenApi(bannerAdminListSchema) })
  async banners() {
    return { items: await this.home.banners() };
  }

  @Post('banners')
  @RequirePermissions('marketing.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(bannerUpload)
  @ApiOperation({ summary: 'Add a banner (image stored as WebP, at most 1920 px)' })
  @ApiCreatedResponse({ schema: zodToOpenApi(bannerAdminSchema) })
  createBanner(
    @Body() body: BannerInputDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.home.createBanner(user, body, requireFile(file), context);
  }

  @Patch('banners/:id')
  @RequirePermissions('marketing.manage')
  @ApiOperation({ summary: 'Edit a banner’s text, link, placement, order, status or dates' })
  @ApiOkResponse({ schema: zodToOpenApi(bannerAdminSchema) })
  updateBanner(
    @Id() id: string,
    @Body() body: UpdateBannerDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.home.updateBanner(user, id, body, context);
  }

  @Put('banners/:id/image')
  @RequirePermissions('marketing.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Replace a banner’s image' })
  @ApiOkResponse({ schema: zodToOpenApi(bannerAdminSchema) })
  replaceBannerImage(
    @Id() id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.home.replaceBannerImage(user, id, requireFile(file), context);
  }

  @Delete('banners/:id')
  @RequirePermissions('marketing.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a banner and its image' })
  @ApiNoContentResponse()
  deleteBanner(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.home.deleteBanner(user, id, context);
  }

  @Get('featured')
  @RequirePermissions('marketing.manage')
  @ApiOperation({ summary: 'Featured products and stores' })
  @ApiOkResponse({ schema: zodToOpenApi(featuredItemsSchema) })
  featured() {
    return this.home.featured();
  }

  @Put('featured/products')
  @RequirePermissions('marketing.manage')
  @ApiOperation({ summary: 'Set the featured products, in order' })
  @ApiOkResponse({ schema: zodToOpenApi(featuredItemsSchema) })
  putFeaturedProducts(
    @Body() body: PutFeaturedProductsDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.home.putFeaturedProducts(user, body.productIds, context);
  }

  @Put('featured/stores')
  @RequirePermissions('marketing.manage')
  @ApiOperation({ summary: 'Set the featured stores, in order' })
  @ApiOkResponse({ schema: zodToOpenApi(featuredItemsSchema) })
  putFeaturedStores(
    @Body() body: PutFeaturedStoresDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.home.putFeaturedStores(user, body.storeIds, context);
  }
}
