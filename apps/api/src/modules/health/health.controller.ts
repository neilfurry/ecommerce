import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  healthResponseSchema,
  livenessResponseSchema,
  type HealthResponse,
  type LivenessResponse,
} from '@marketplace/validation';
import type { Response } from 'express';
import { Public } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { HealthService } from './health.service';

@ApiTags('Health')
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Readiness: status of the API and every dependency',
    description:
      'Returns 200 when all critical components (database, Redis, storage) are up, ' +
      'otherwise 503. The worker is non-critical: when it is down the status is "degraded".',
  })
  @ApiOkResponse({ schema: zodToOpenApi(healthResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: zodToOpenApi(healthResponseSchema) })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.check();
    res.status(result.status === 'down' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK);
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Get('live')
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness: the API process is running (no dependency checks)' })
  @ApiOkResponse({ schema: zodToOpenApi(livenessResponseSchema) })
  liveness(): LivenessResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
