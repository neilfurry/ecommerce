import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import {
  addressInputSchema,
  customerAddressListSchema,
  customerAddressSchema,
  uuidSchema,
} from '@marketplace/validation';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AddressesService } from './addresses.service';

class AddressInputDto extends createZodDto(addressInputSchema) {}
const Id = () => Param('id', new ZodValidationPipe(uuidSchema));

@ApiTags('Account: addresses')
@Controller({ path: 'account/addresses', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'My delivery addresses, default first' })
  @ApiOkResponse({ schema: zodToOpenApi(customerAddressListSchema) })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { items: await this.addresses.list(user) };
  }

  @Post()
  @ApiOperation({ summary: 'Add an address (the first one becomes the default)' })
  @ApiCreatedResponse({ schema: zodToOpenApi(customerAddressSchema) })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: AddressInputDto) {
    return this.addresses.create(user, body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Replace an address' })
  @ApiOkResponse({ schema: zodToOpenApi(customerAddressSchema) })
  update(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: AddressInputDto) {
    return this.addresses.update(user, id, body);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make an address the default' })
  @ApiOkResponse({ schema: zodToOpenApi(customerAddressListSchema) })
  async setDefault(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return { items: await this.addresses.setDefault(user, id) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an address (orders keep their own copy)' })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.addresses.remove(user, id);
  }
}
