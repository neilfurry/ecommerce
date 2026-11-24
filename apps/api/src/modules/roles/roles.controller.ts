import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, UserRole } from '@marketplace/shared-types';
import {
  permissionListSchema,
  roleListSchema,
  roleSchema,
  userRoleSchema,
} from '@marketplace/validation';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { UpdateRolePermissionsDto } from '../auth/auth.dtos';
import { RolesService } from './roles.service';

@ApiTags('Administration')
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'All roles with their permissions, and the permission catalog' })
  @ApiOkResponse({ schema: zodToOpenApi(roleListSchema) })
  list() {
    return this.roles.list();
  }

  @Put(':code/permissions')
  @RequirePermissions('roles.update')
  @ApiOperation({ summary: 'Replace the permissions of a role (SUPER_ADMIN cannot be edited)' })
  @ApiBody({ schema: UpdateRolePermissionsDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(roleSchema) })
  update(
    @Param('code', new ZodValidationPipe(userRoleSchema)) code: UserRole,
    @Body() body: UpdateRolePermissionsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.roles.updatePermissions(code, body.permissions, actor, context);
  }
}

@ApiTags('Administration')
@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'The permission catalog (platform and seller scope) with the roles holding each',
  })
  @ApiOkResponse({ schema: zodToOpenApi(permissionListSchema) })
  list() {
    return this.roles.permissions();
  }
}
