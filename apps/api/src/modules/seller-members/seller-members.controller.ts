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
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  sellerInvitationPreviewSchema,
  sellerMemberSchema,
  sellerTeamSchema,
  uuidSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import {
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
  RequirePermissions,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  AcceptSellerInvitationDto,
  InvitationTokenDto,
  InviteSellerMemberDto,
  UpdateSellerMemberDto,
} from './seller-members.dtos';
import { SellerMembersService } from './seller-members.service';

const Id = (name: string) => Param(name, new ZodValidationPipe(uuidSchema));

/** The signed-in seller's employees and invitations (Seller Center). */
@ApiTags('Seller employees')
@Controller({ path: 'seller/members', version: '1' })
export class SellerMembersController {
  constructor(private readonly members: SellerMembersService) {}

  @Get()
  @RequirePermissions('seller.members.read')
  @ApiOperation({ summary: 'Employees, open invitations, and what the caller may assign' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerTeamSchema) })
  team(@CurrentUser() user: AuthenticatedUser) {
    return this.members.team(user);
  }

  @Post('invitations')
  @RequirePermissions('seller.members.manage')
  @ApiOperation({ summary: 'Invite an employee by email (link valid 7 days)' })
  @ApiBody({ schema: InviteSellerMemberDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(z.object({ id: z.uuid() })) })
  invite(
    @Body() body: InviteSellerMemberDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.members.invite(user, body, context);
  }

  @Post('invitations/:invitationId/resend')
  @RequirePermissions('seller.members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a new link (the old one stops working; 7 more days)' })
  @ApiNoContentResponse()
  async resend(
    @Id('invitationId') invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.members.resendInvitation(user, invitationId, context);
  }

  @Delete('invitations/:invitationId')
  @RequirePermissions('seller.members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an invitation' })
  @ApiNoContentResponse()
  async revoke(
    @Id('invitationId') invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.members.revokeInvitation(user, invitationId, context);
  }

  @Patch(':memberId')
  @RequirePermissions('seller.members.manage')
  @ApiOperation({ summary: "Change an employee's roles and extra permissions" })
  @ApiBody({ schema: UpdateSellerMemberDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sellerMemberSchema) })
  update(
    @Id('memberId') memberId: string,
    @Body() body: UpdateSellerMemberDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.members.update(user, memberId, body, context);
  }

  @Post(':memberId/suspend')
  @RequirePermissions('seller.members.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an employee (signed out of the Seller Center at once)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerMemberSchema) })
  suspend(
    @Id('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.members.setSuspended(user, memberId, true, context);
  }

  @Post(':memberId/reactivate')
  @RequirePermissions('seller.members.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a suspended employee' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerMemberSchema) })
  reactivate(
    @Id('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.members.setSuspended(user, memberId, false, context);
  }

  @Delete(':memberId')
  @RequirePermissions('seller.members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an employee from the business (their account itself remains)' })
  @ApiNoContentResponse()
  async remove(
    @Id('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.members.remove(user, memberId, context);
  }
}

const INVITE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** Opening an emailed invitation (no session needed). */
@ApiTags('Seller employees')
@Controller({ path: 'auth/seller-invitations', version: '1' })
export class SellerInvitationsController {
  constructor(private readonly members: SellerMembersService) {}

  @Post('preview')
  @Public()
  @Throttle(INVITE_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Who invited you, for which roles, and whether you already have an account',
  })
  @ApiBody({ schema: InvitationTokenDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sellerInvitationPreviewSchema) })
  preview(@Body() body: InvitationTokenDto) {
    return this.members.preview(body.token);
  }

  @Post('accept')
  @Public()
  @Throttle(INVITE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Join the seller: new people set a name and password; existing accounts confirm their password',
  })
  @ApiBody({ schema: AcceptSellerInvitationDto.openApiSchema })
  @ApiNoContentResponse()
  async accept(
    @Body() body: AcceptSellerInvitationDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.members.accept(body, context);
  }
}
