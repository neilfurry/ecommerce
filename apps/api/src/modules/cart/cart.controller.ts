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
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import {
  cartLineInputSchema,
  cartSchema,
  guestCartSchema,
  updateCartLineSchema,
  uuidSchema,
} from '@marketplace/validation';
import { CurrentUser, Public, Roles, SkipCsrf } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CartService } from './cart.service';

class CartLineInputDto extends createZodDto(cartLineInputSchema) {}
class UpdateCartLineDto extends createZodDto(updateCartLineSchema) {}
class GuestCartDto extends createZodDto(guestCartSchema) {}
const Id = () => Param('id', new ZodValidationPipe(uuidSchema));

@ApiTags('Cart')
@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({ summary: 'My cart, re-priced now and grouped by seller, plus saved items' })
  @ApiOkResponse({ schema: zodToOpenApi(cartSchema) })
  view(@CurrentUser() user: AuthenticatedUser) {
    return this.cart.view(user);
  }

  @Post('items')
  @Roles(...CUSTOMER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a variant (adds to the quantity already in the cart)' })
  @ApiOkResponse({ schema: zodToOpenApi(cartSchema) })
  add(@CurrentUser() user: AuthenticatedUser, @Body() body: CartLineInputDto) {
    return this.cart.add(user, body);
  }

  @Patch('items/:id')
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({ summary: 'Change the quantity, or move between the cart and "saved for later"' })
  @ApiOkResponse({ schema: zodToOpenApi(cartSchema) })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: UpdateCartLineDto,
  ) {
    return this.cart.update(user, id, body);
  }

  @Delete('items/:id')
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({ summary: 'Remove a line' })
  @ApiOkResponse({ schema: zodToOpenApi(cartSchema) })
  remove(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.cart.remove(user, id);
  }

  @Post('merge')
  @Roles(...CUSTOMER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add the cart kept in the browser before signing in' })
  @ApiOkResponse({ schema: zodToOpenApi(cartSchema) })
  merge(@CurrentUser() user: AuthenticatedUser, @Body() body: GuestCartDto) {
    return this.cart.merge(user, body);
  }

  @Post('preview')
  @Public()
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price a guest’s browser cart (read-only; nothing is stored)' })
  @ApiOkResponse({ schema: zodToOpenApi(cartSchema) })
  preview(@CurrentUser() user: AuthenticatedUser | undefined, @Body() body: GuestCartDto) {
    return this.cart.preview(user, body);
  }
}
