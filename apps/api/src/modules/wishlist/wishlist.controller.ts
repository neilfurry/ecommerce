import { Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import { uuidSchema, wishlistSchema } from '@marketplace/validation';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { WishlistService } from './wishlist.service';

const ProductId = () => Param('productId', new ZodValidationPipe(uuidSchema));

@ApiTags('Account: wishlist')
@Controller({ path: 'account/wishlist', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @ApiOperation({ summary: 'My saved products, newest first' })
  @ApiOkResponse({ schema: zodToOpenApi(wishlistSchema) })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.wishlist.list(user);
  }

  @Put(':productId')
  @ApiOperation({ summary: 'Save a product (idempotent)' })
  @ApiOkResponse({ schema: zodToOpenApi(wishlistSchema) })
  add(@CurrentUser() user: AuthenticatedUser, @ProductId() productId: string) {
    return this.wishlist.add(user, productId);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Remove a saved product' })
  @ApiOkResponse({ schema: zodToOpenApi(wishlistSchema) })
  remove(@CurrentUser() user: AuthenticatedUser, @ProductId() productId: string) {
    return this.wishlist.remove(user, productId);
  }
}
