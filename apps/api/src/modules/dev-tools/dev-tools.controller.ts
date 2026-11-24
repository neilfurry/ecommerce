import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FilePurpose } from '@marketplace/database';
import type { QueueName } from '@marketplace/config';
import {
  deadLetterListResponseSchema,
  devSmsOutboxSchema,
  type DevSmsOutbox,
  enqueuedJobResponseSchema,
  type EnqueuedJobResponse,
  jobStatusResponseSchema,
  type JobStatusResponse,
  queueStatsResponseSchema,
  type QueueStatsResponse,
  signedUrlResponseSchema,
  type SignedUrlResponse,
  storedFileListResponseSchema,
  storedFileSchema,
  type StoredFileDto,
  uuidSchema,
} from '@marketplace/validation';
import { RequirePermissions } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { contentDisposition } from '../../infrastructure/storage/s3-object-storage';
import { FilesService } from '../files/files.service';
import { DevJobsService } from './dev-jobs.service';
import {
  DevSampleJobDto,
  DevTestEmailDto,
  jobIdParamSchema,
  PaginationQueryDto,
  queueNameParamSchema,
} from './dev-tools.dtos';
import { DevToolsEnabledGuard } from './dev-tools-enabled.guard';

const PURPOSE = FilePurpose.DEV_TEST;

/**
 * DEVELOPMENT ONLY (DEV_TOOLS_ENABLED=true; refused in production). Lets developers prove
 * the job pipeline and file storage end to end from the Admin Console.
 * Requires the dev-tools.use permission (SUPER_ADMIN by default).
 */
@ApiTags('Developer tools (development only)')
@RequirePermissions('dev-tools.use')
@UseGuards(DevToolsEnabledGuard)
@Controller({ path: 'dev', version: '1' })
export class DevToolsController {
  constructor(
    private readonly jobs: DevJobsService,
    private readonly files: FilesService,
  ) {}

  // ---- Jobs ---------------------------------------------------------------

  @Post('jobs/sample')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue the sample job (can simulate failures to show retries)' })
  @ApiBody({ schema: DevSampleJobDto.openApiSchema })
  @ApiAcceptedResponse({ schema: zodToOpenApi(enqueuedJobResponseSchema) })
  enqueueSample(@Body() body: DevSampleJobDto): Promise<EnqueuedJobResponse> {
    return this.jobs.enqueueSample(body);
  }

  @Post('jobs/test-email')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue a test email (delivered to Mailpit locally)' })
  @ApiBody({ schema: DevTestEmailDto.openApiSchema })
  @ApiAcceptedResponse({ schema: zodToOpenApi(enqueuedJobResponseSchema) })
  enqueueTestEmail(@Body() body: DevTestEmailDto): Promise<EnqueuedJobResponse> {
    return this.jobs.enqueueTestEmail(body);
  }

  @Get('jobs/:queue/:jobId')
  @ApiOperation({ summary: 'Status of a job: state, attempts, progress, result or error' })
  @ApiOkResponse({ schema: zodToOpenApi(jobStatusResponseSchema) })
  getJob(
    @Param('queue', new ZodValidationPipe(queueNameParamSchema)) queue: string,
    @Param('jobId', new ZodValidationPipe(jobIdParamSchema)) jobId: string,
  ): Promise<JobStatusResponse> {
    return this.jobs.getJob(queue as QueueName, jobId);
  }

  @Get('sms-outbox')
  @ApiOperation({ summary: 'Text messages captured by the mock SMS provider, newest first' })
  @ApiOkResponse({ schema: zodToOpenApi(devSmsOutboxSchema) })
  smsOutbox(): Promise<DevSmsOutbox> {
    return this.jobs.smsOutbox();
  }

  @Get('queues')
  @ApiOperation({ summary: 'Every queue with its retry policy and job counts' })
  @ApiOkResponse({ schema: zodToOpenApi(queueStatsResponseSchema) })
  queueStats(): Promise<QueueStatsResponse> {
    return this.jobs.queueStats();
  }

  // ---- Dead letters ---------------------------------------------------------

  @Get('dead-letters')
  @ApiOperation({ summary: 'Jobs that failed permanently, newest first' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(deadLetterListResponseSchema) })
  listDeadLetters(@Query() query: PaginationQueryDto) {
    return this.jobs.listDeadLetters(query.page, query.pageSize);
  }

  @Post('dead-letters/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-enqueue a dead letter on its original queue' })
  @ApiAcceptedResponse({ schema: zodToOpenApi(enqueuedJobResponseSchema) })
  retryDeadLetter(
    @Param('id', new ZodValidationPipe(jobIdParamSchema)) id: string,
  ): Promise<EnqueuedJobResponse> {
    return this.jobs.retryDeadLetter(id);
  }

  @Delete('dead-letters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard a dead letter permanently' })
  @ApiNoContentResponse()
  async discardDeadLetter(
    @Param('id', new ZodValidationPipe(jobIdParamSchema)) id: string,
  ): Promise<void> {
    await this.jobs.discardDeadLetter(id);
  }

  // ---- Files ------------------------------------------------------------------

  @Post('files')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Upload a test file (PNG, JPEG, GIF, WebP, PDF or plain text; type checked by content)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ schema: zodToOpenApi(storedFileSchema) })
  uploadFile(@UploadedFile() file: Express.Multer.File | undefined): Promise<StoredFileDto> {
    if (!file) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Attach a file in the "file" field.',
        [{ path: 'file', message: 'Required' }],
      );
    }
    return this.files.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      purpose: PURPOSE,
    });
  }

  @Get('files')
  @ApiOperation({ summary: 'Uploaded test files, newest first' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(storedFileListResponseSchema) })
  listFiles(@Query() query: PaginationQueryDto) {
    return this.files.list(PURPOSE, query.page, query.pageSize);
  }

  @Get('files/:id')
  @ApiOperation({ summary: 'File metadata' })
  @ApiOkResponse({ schema: zodToOpenApi(storedFileSchema) })
  getFile(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<StoredFileDto> {
    return this.files.get(id, PURPOSE);
  }

  @Get('files/:id/download-url')
  @ApiOperation({ summary: 'Short-lived signed URL to download the file directly from storage' })
  @ApiOkResponse({ schema: zodToOpenApi(signedUrlResponseSchema) })
  getDownloadUrl(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<SignedUrlResponse> {
    return this.files.getDownloadUrl(id, PURPOSE);
  }

  @Get('files/:id/content')
  @ApiOperation({ summary: 'Download the file through the API (streamed)' })
  async getContent(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<StreamableFile> {
    const { file, body } = await this.files.openContent(id, PURPOSE);
    return new StreamableFile(body, {
      type: file.contentType,
      length: file.sizeBytes,
      disposition: contentDisposition(file.originalName),
    });
  }

  @Delete('files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the file from storage (metadata kept as DELETED)' })
  @ApiNoContentResponse()
  async deleteFile(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<void> {
    await this.files.delete(id, PURPOSE);
  }
}
