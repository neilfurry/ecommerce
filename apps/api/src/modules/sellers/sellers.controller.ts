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
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  SELLER_DOCUMENT_TYPES,
  SELLER_STATUSES,
} from '@marketplace/shared-types';
import {
  sellerDetailSchema,
  sellerDocumentSchema,
  sellerListSchema,
  uploadSellerDocumentSchema,
  uuidSchema,
} from '@marketplace/validation';
import type { Response } from 'express';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { contentDisposition } from '../../infrastructure/storage/s3-object-storage';
import {
  ReviewSellerDto,
  SellerListQueryDto,
  SellerReasonDto,
  UpdateSellerProfileDto,
} from './sellers.dtos';
import { SellersService } from './sellers.service';

const Id = (name: string) => Param(name, new ZodValidationPipe(uuidSchema));

/**
 * /sellers/me/*: the signed-in seller's own account (Seller Center).
 * /sellers and /sellers/{id}/*: administration (Admin Console).
 */
@ApiTags('Sellers')
@Controller({ path: 'sellers', version: '1' })
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  // ---- Seller Center (declared first so "me" never matches ":id") ----------------------

  @Get('me')
  @Roles(
    'SELLER_OWNER',
    'SELLER_MANAGER',
    'SELLER_ENCODER',
    'SELLER_INVENTORY',
    'SELLER_ORDER_PROCESSOR',
    'SELLER_ACCOUNTING',
  )
  @ApiOperation({
    summary: 'My seller account: profile, documents, verification status and history',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.sellers.mine(user);
  }

  @Patch('me')
  @RequirePermissions('seller.profile.manage')
  @ApiOperation({
    summary: 'Update the business profile (legal details only before verification)',
  })
  @ApiBody({ schema: UpdateSellerProfileDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  update(
    @Body() body: UpdateSellerProfileDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.sellers.updateProfile(user, body, context);
  }

  @Post('me/documents')
  @RequirePermissions('seller.profile.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a verification document (PDF, JPEG or PNG; private)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: [...SELLER_DOCUMENT_TYPES] },
        description: { type: 'string', maxLength: 200 },
      },
    },
  })
  @ApiCreatedResponse({ schema: zodToOpenApi(sellerDocumentSchema) })
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(uploadSellerDocumentSchema))
    body: { type: (typeof SELLER_DOCUMENT_TYPES)[number]; description?: string | null },
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    if (!file) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Attach a file in the "file" field.',
        [{ path: 'file', message: 'Required' }],
      );
    }
    return this.sellers.uploadDocument(
      user,
      {
        buffer: file.buffer,
        originalName: file.originalname,
        type: body.type,
        description: body.description,
      },
      context,
    );
  }

  @Delete('me/documents/:documentId')
  @RequirePermissions('seller.profile.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a document (only before submission)' })
  @ApiNoContentResponse()
  async removeDocument(
    @Id('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.sellers.deleteDocument(user, documentId, context);
  }

  @Get('me/documents/:documentId/content')
  @RequirePermissions('seller.profile.manage')
  @ApiOperation({ summary: 'Download one of my documents' })
  async myDocument(
    @Id('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.stream(
      response,
      await this.sellers.openDocument(user, sellerScope(user).sellerId, documentId, context),
    );
  }

  @Post('me/submit')
  @RequirePermissions('seller.profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the application for verification (422 lists what is missing)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  submit(@CurrentUser() user: AuthenticatedUser, @ReqContext() context: RequestContext) {
    return this.sellers.submit(user, context);
  }

  // ---- Administration ----------------------------------------------------------------------

  @Get()
  @RequirePermissions('sellers.read')
  @ApiOperation({ summary: 'Sellers and applications (under review: oldest first)' })
  @ApiQuery({ name: 'status', required: false, enum: [...SELLER_STATUSES] })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Business name, email or registration number',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: zodToOpenApi(sellerListSchema) })
  list(@Query() query: SellerListQueryDto) {
    return this.sellers.list(query);
  }

  @Get(':id')
  @RequirePermissions('sellers.read')
  @ApiOperation({ summary: 'Seller details, documents and history' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  detail(@Id('id') id: string) {
    return this.sellers.detail(id);
  }

  @Get(':id/documents/:documentId/content')
  @RequirePermissions('sellers.read')
  @ApiOperation({ summary: 'View a seller document (each view is recorded in the audit log)' })
  async document(
    @Id('id') id: string,
    @Id('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.stream(response, await this.sellers.openDocument(user, id, documentId, context));
  }

  @Post(':id/review')
  @RequirePermissions('sellers.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Decide an application: APPROVE, REJECT (note required) or REQUEST_INFO (note required)',
  })
  @ApiBody({ schema: ReviewSellerDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  review(
    @Id('id') id: string,
    @Body() body: ReviewSellerDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.sellers.review(id, body, actor, context);
  }

  @Post(':id/suspend')
  @RequirePermissions('sellers.suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a verified seller: stores are hidden and changes refused' })
  @ApiBody({ schema: SellerReasonDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  suspend(
    @Id('id') id: string,
    @Body() body: SellerReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.sellers.suspend(id, body.reason, actor, context);
  }

  @Post(':id/reinstate')
  @RequirePermissions('sellers.suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lift a suspension' })
  @ApiBody({ schema: SellerReasonDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  reinstate(
    @Id('id') id: string,
    @Body() body: SellerReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.sellers.reinstate(id, body.reason, actor, context);
  }

  @Post(':id/close')
  @RequirePermissions('sellers.suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a seller permanently: stores close and employees are signed out',
  })
  @ApiBody({ schema: SellerReasonDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sellerDetailSchema) })
  close(
    @Id('id') id: string,
    @Body() body: SellerReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.sellers.close(id, body.reason, actor, context);
  }

  /** Private documents: never cached, always downloaded, never sniffed as HTML. */
  private stream(
    response: Response,
    file: { fileName: string; contentType: string; sizeBytes: number; body: NodeJS.ReadableStream },
  ): StreamableFile {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.body as never, {
      type: file.contentType,
      length: file.sizeBytes,
      disposition: contentDisposition(file.fileName),
    });
  }
}
