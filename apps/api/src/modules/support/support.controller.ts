import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CUSTOMER_ROLES,
  MAX_SUPPORT_ATTACHMENTS,
  SELLER_ROLES,
} from '@marketplace/shared-types';
import {
  ticketActionSchema,
  ticketDetailSchema,
  ticketListQuerySchema,
  ticketListSchema,
  ticketMessageInputSchema,
  uuidSchema,
} from '@marketplace/validation';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  MAX_SUPPORT_ATTACHMENT_BYTES,
  SupportService,
  type SupportViewer,
  type Upload,
  viewerOf,
} from './support.service';

class TicketQueryDto extends createZodDto(ticketListQuerySchema) {}
class ActionDto extends createZodDto(ticketActionSchema) {}
const Id = (name = 'id') => Param(name, new ZodValidationPipe(uuidSchema));
const files = () =>
  UseInterceptors(
    FilesInterceptor('attachments', MAX_SUPPORT_ATTACHMENTS, {
      limits: { fileSize: MAX_SUPPORT_ATTACHMENT_BYTES },
    }),
  );
const uploadsOf = (list: Express.Multer.File[] | undefined): Upload[] =>
  (list ?? []).map((f) => ({ buffer: f.buffer, originalName: f.originalname }));
const multipart = (description: string) => ({
  schema: {
    type: 'object',
    required: ['data'],
    properties: {
      data: { type: 'string', description },
      attachments: {
        type: 'array',
        items: { type: 'string', format: 'binary' },
        maxItems: MAX_SUPPORT_ATTACHMENTS,
      },
    },
  },
});
const stream = (content: {
  file: { contentType: string; sizeBytes: number; originalName: string };
  body: NodeJS.ReadableStream;
}) =>
  new StreamableFile(content.body as never, {
    type: content.file.contentType,
    length: content.file.sizeBytes,
    disposition: `attachment; filename="${content.file.originalName.replace(/["\\\r\n]/g, '_')}"`,
  });

/** A reply as multipart: a JSON "data" field ({ body, internal }) plus attachments. */
function messageOf(data: string | undefined) {
  let raw: unknown;
  try {
    raw = JSON.parse(data ?? '');
  } catch {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'The "data" field must be JSON.');
  }
  const parsed = ticketMessageInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'Check the message.',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}

abstract class TicketRoutes {
  constructor(protected readonly support: SupportService) {}
  protected abstract viewer(user: AuthenticatedUser): SupportViewer;

  @Get()
  @ApiOkResponse({ schema: zodToOpenApi(ticketListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: TicketQueryDto) {
    return this.support.list(this.viewer(user), query);
  }

  @Get(':id')
  @ApiOkResponse({ schema: zodToOpenApi(ticketDetailSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.support.get(this.viewer(user), id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @files()
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipart('JSON: { body, internal }'))
  @ApiOperation({ summary: 'Reply (with up to 5 attachments: images or PDF, 5 MB each)' })
  @ApiOkResponse({ schema: zodToOpenApi(ticketDetailSchema) })
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body('data') data: string,
    @UploadedFiles() attachments: Express.Multer.File[] | undefined,
  ) {
    return this.support.reply(this.viewer(user), id, messageOf(data), uploadsOf(attachments));
  }

  @Post(':id/actions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve, close, reopen; staff: join, take over, assign, priority' })
  @ApiOkResponse({ schema: zodToOpenApi(ticketDetailSchema) })
  act(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ActionDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.support.act(this.viewer(user), id, body, context);
  }

  @Get(':id/attachments/:attachmentId')
  async attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Id('attachmentId') attachmentId: string,
  ) {
    return stream(await this.support.attachment(this.viewer(user), id, attachmentId));
  }
}

@ApiTags('Account: support')
@Controller({ path: 'account/support/tickets', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class CustomerSupportController extends TicketRoutes {
  constructor(support: SupportService) {
    super(support);
  }
  protected viewer(user: AuthenticatedUser) {
    return viewerOf.customer(user);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @files()
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipart('JSON: { subject, category, sellerOrderId?, body }'))
  @ApiOperation({
    summary:
      'Open a ticket: about one store’s part of an order (to that seller) or a general inquiry',
  })
  @ApiOkResponse({ schema: zodToOpenApi(ticketDetailSchema) })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body('data') data: string,
    @UploadedFiles() attachments: Express.Multer.File[] | undefined,
  ) {
    return this.support.create(user, data, uploadsOf(attachments));
  }
}

@ApiTags('Support (seller)')
@Controller({ path: 'seller/support/tickets', version: '1' })
@Roles(...SELLER_ROLES)
@RequirePermissions('seller.support.manage')
export class SellerSupportController extends TicketRoutes {
  constructor(support: SupportService) {
    super(support);
  }
  protected viewer(user: AuthenticatedUser) {
    return viewerOf.seller(user);
  }
}

@ApiTags('Support (staff)')
@Controller({ path: 'support/tickets', version: '1' })
@RequirePermissions('support.read')
export class StaffSupportController extends TicketRoutes {
  constructor(support: SupportService) {
    super(support);
  }
  protected viewer(user: AuthenticatedUser) {
    return viewerOf.staff(user);
  }
}
