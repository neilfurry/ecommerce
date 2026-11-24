import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  adminUserDetailSchema,
  adminUserListSchema,
  adminUserSchema,
  uuidSchema,
} from '@marketplace/validation';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CreateStaffUserDto, UpdateUserDto, UserListQueryDto } from '../auth/auth.dtos';
import { UsersService } from './users.service';

const IdParam = () => Param('id', new ZodValidationPipe(uuidSchema));

@ApiTags('Administration')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Staff and customer accounts' })
  @ApiQuery({ name: 'search', required: false, description: 'Name, email or mobile' })
  @ApiQuery({ name: 'kind', required: false, enum: ['staff', 'customers'] })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INVITED', 'SUSPENDED'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(adminUserListSchema) })
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  @Post()
  @RequirePermissions('users.create')
  @ApiOperation({ summary: 'Create a staff account and email an invitation to set a password' })
  @ApiBody({ schema: CreateStaffUserDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(adminUserSchema) })
  create(
    @Body() body: CreateStaffUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.users.createStaff(body, actor, context);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Account details' })
  @ApiOkResponse({ schema: zodToOpenApi(adminUserDetailSchema) })
  get(@IdParam() id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Change name and staff roles' })
  @ApiBody({ schema: UpdateUserDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(adminUserSchema) })
  update(
    @IdParam() id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.users.update(id, body, actor, context);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.suspend')
  @ApiOperation({ summary: 'Suspend: blocks sign-in and signs out every device immediately' })
  @ApiOkResponse({ schema: zodToOpenApi(adminUserSchema) })
  suspend(
    @IdParam() id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.users.suspend(id, actor, context);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.suspend')
  @ApiOperation({ summary: 'Reactivate a suspended account and clear any sign-in lock-out' })
  @ApiOkResponse({ schema: zodToOpenApi(adminUserSchema) })
  reactivate(
    @IdParam() id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.users.reactivate(id, actor, context);
  }

  @Post(':id/sessions/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.sessions.revoke')
  @ApiOperation({ summary: 'Sign the account out of every device' })
  @ApiNoContentResponse()
  async revokeSessions(
    @IdParam() id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    await this.users.revokeSessions(id, actor, context);
  }

  @Post(':id/mfa/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.update')
  @ApiOperation({
    summary:
      'Turn off two-step verification for someone who lost their authenticator (signs them out)',
  })
  @ApiNoContentResponse()
  async resetMfa(
    @IdParam() id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.users.resetMfa(id, actor, context);
  }

  @Post(':id/invitation/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.create')
  @ApiOperation({ summary: 'Email a new invitation link (previous links stop working)' })
  @ApiNoContentResponse()
  async resendInvitation(
    @IdParam() id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    await this.users.resendInvitation(id, actor, context);
  }
}
