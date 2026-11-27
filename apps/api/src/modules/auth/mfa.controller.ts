import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  type MfaRecoveryCodes,
  mfaRecoveryCodesSchema,
  type MfaSetupResponse,
  mfaSetupResponseSchema,
  type MfaStatus,
  mfaStatusSchema,
} from '@marketplace/validation';
import type { Response } from 'express';
import {
  AllowWithoutMfa,
  CurrentUser,
  ReqContext,
  type RequestContext,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { MfaDisableDto, MfaEnableDto, MfaRegenerateDto, MfaSetupDto } from './auth.dtos';
import { MfaService } from './mfa.service';

const MFA_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** Two-step verification settings of the signed-in user (any app). */
@ApiTags('Authentication')
@Controller({ path: 'auth/mfa', version: '1' })
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get()
  @AllowWithoutMfa()
  @ApiOperation({ summary: 'Whether two-step verification is on, and recovery codes left' })
  @ApiOkResponse({ schema: zodToOpenApi(mfaStatusSchema) })
  status(@CurrentUser() user: AuthenticatedUser): Promise<MfaStatus> {
    return this.mfa.status(user.id);
  }

  @Post('totp/setup')
  @AllowWithoutMfa()
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_LIMIT)
  @ApiOperation({ summary: 'Start set-up: confirm the password, get the secret and QR code URI' })
  @ApiBody({ schema: MfaSetupDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(mfaSetupResponseSchema) })
  setup(
    @Body() body: MfaSetupDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MfaSetupResponse> {
    response.setHeader('Cache-Control', 'no-store');
    return this.mfa.setup(user.id, body.password, context);
  }

  @Post('totp/enable')
  @AllowWithoutMfa()
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_LIMIT)
  @ApiOperation({
    summary: 'Finish set-up with a code from the app; returns 10 recovery codes once',
  })
  @ApiBody({ schema: MfaEnableDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(mfaRecoveryCodesSchema) })
  async enable(
    @Body() body: MfaEnableDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MfaRecoveryCodes> {
    response.setHeader('Cache-Control', 'no-store');
    return { recoveryCodes: await this.mfa.enable(user.id, body.code, context) };
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_LIMIT)
  @ApiOperation({ summary: 'Replace the recovery codes (old ones stop working)' })
  @ApiBody({ schema: MfaRegenerateDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(mfaRecoveryCodesSchema) })
  async regenerate(
    @Body() body: MfaRegenerateDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MfaRecoveryCodes> {
    response.setHeader('Cache-Control', 'no-store');
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(user.id, body.code, context) };
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(MFA_LIMIT)
  @ApiOperation({ summary: 'Turn two-step verification off (password and a current code)' })
  @ApiBody({ schema: MfaDisableDto.openApiSchema })
  @ApiNoContentResponse()
  async disable(
    @Body() body: MfaDisableDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.mfa.disable(user.id, body.password, body.code, context);
  }
}
