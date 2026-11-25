import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import { publicProductListSchema, publicProductSchema, uuidSchema } from '@marketplace/validation';
import { CurrentUser, Public } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PublicProductListQueryDto } from './products.dtos';
import { PublicCatalogService } from './public-catalog.service';

/** What shoppers see: approved products of verified sellers in open stores. */
@ApiTags('Catalog (public)')
@Controller({ path: 'catalog', version: '1' })
export class CatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get('products')
  @Public()
  @ApiOperation({
    summary: 'Products shoppers can buy (filters: category incl. subcategories, store, search)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(publicProductListSchema) })
  list(@Query() query: PublicProductListQueryDto) {
    return this.catalog.list(query);
  }

  @Get('products/:id')
  @Public()
  @ApiOperation({
    summary: 'A product page, priced for the signed-in customer (or retail for guests)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(publicProductSchema) })
  get(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.catalog.get(user, id);
  }
}
