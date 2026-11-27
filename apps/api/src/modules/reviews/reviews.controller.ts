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
  Put,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CUSTOMER_ROLES,
  MAX_REVIEW_IMAGES,
  SELLER_ROLES,
} from '@marketplace/shared-types';
import {
  adminReviewListQuerySchema,
  adminReviewListSchema,
  adminReviewSchema,
  createReviewSchema,
  moderateReviewSchema,
  myReviewsSchema,
  reportReviewSchema,
  resolveReviewReportsSchema,
  reviewListQuerySchema,
  reviewListSchema,
  reviewReplySchema,
  sellerRatingInputSchema,
  sellerRatingSchema,
  sellerRatingSummarySchema,
  sellerReviewQuerySchema,
  updateReviewSchema,
  uuidSchema,
} from '@marketplace/validation';
import {
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

class ReviewListQueryDto extends createZodDto(reviewListQuerySchema) {}
class AdminReviewListQueryDto extends createZodDto(adminReviewListQuerySchema) {}
class CreateReviewDto extends createZodDto(createReviewSchema) {}
class UpdateReviewDto extends createZodDto(updateReviewSchema) {}
class ModerateReviewDto extends createZodDto(moderateReviewSchema) {}
class ReplyDto extends createZodDto(reviewReplySchema) {}
class ReportDto extends createZodDto(reportReviewSchema) {}
class ResolveReportsDto extends createZodDto(resolveReviewReportsSchema) {}
class SellerReviewQueryDto extends createZodDto(sellerReviewQuerySchema) {}
class SellerRatingDto extends createZodDto(sellerRatingInputSchema) {}
const imageUpload = {
  schema: {
    type: 'object',
    properties: {
      images: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: 5 },
    },
  },
};
const Id = (name = 'id') => Param(name, new ZodValidationPipe(uuidSchema));

@ApiTags('Reviews')
@Controller({ version: '1' })
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('catalog/products/:productId/reviews')
  @Public()
  @ApiOperation({ summary: 'Published reviews of a product, newest first (filter by stars)' })
  @ApiOkResponse({ schema: zodToOpenApi(reviewListSchema) })
  forProduct(@Id('productId') productId: string, @Query() query: ReviewListQueryDto) {
    return this.reviews.forProduct(productId, query);
  }

  @Get('account/reviews')
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({ summary: 'My reviews and the bought items waiting for one' })
  @ApiOkResponse({ schema: zodToOpenApi(myReviewsSchema) })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.mine(user);
  }

  @Post('account/reviews')
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({ summary: 'Review an item I bought (one review per order item)' })
  @ApiOkResponse({ schema: zodToOpenApi(myReviewsSchema) })
  @HttpCode(HttpStatus.OK)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateReviewDto) {
    return this.reviews.create(user, body);
  }

  @Put('account/reviews/:id')
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({ summary: 'Edit my review' })
  @ApiOkResponse({ schema: zodToOpenApi(myReviewsSchema) })
  update(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: UpdateReviewDto) {
    return this.reviews.update(user, id, body);
  }

  @Get('reviews')
  @RequirePermissions('reviews.moderate')
  @ApiOperation({ summary: 'Every review, for moderation' })
  @ApiOkResponse({ schema: zodToOpenApi(adminReviewListSchema) })
  list(@Query() query: AdminReviewListQueryDto) {
    return this.reviews.list(query);
  }

  @Patch('reviews/:id')
  @RequirePermissions('reviews.moderate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hide (note required) or publish a review again' })
  @ApiNoContentResponse()
  moderate(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ModerateReviewDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.reviews.moderate(user, id, body, context);
  }

  @Post('account/reviews/:id/images')
  @Roles(...CUSTOMER_ROLES)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('images', MAX_REVIEW_IMAGES, { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(imageUpload)
  @ApiOperation({ summary: 'Add photos to my review (at most 5 per review; re-encoded)' })
  @ApiOkResponse({ schema: zodToOpenApi(myReviewsSchema) })
  addImages(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.reviews.addImages(
      user,
      id,
      (files ?? []).map((f) => ({ buffer: f.buffer, originalName: f.originalname })),
    );
  }

  @Delete('account/reviews/:id/images/:imageId')
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({ summary: 'Remove a photo from my review' })
  @ApiOkResponse({ schema: zodToOpenApi(myReviewsSchema) })
  removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Id('imageId') imageId: string,
  ) {
    return this.reviews.removeImage(user, id, imageId);
  }

  @Get('catalog/review-images/:fileId')
  @Public()
  @ApiOperation({ summary: 'A review photo (published reviews only)' })
  async image(@Id('fileId') fileId: string) {
    const content = await this.reviews.imageContent(fileId);
    return new StreamableFile(content.body as never, {
      type: content.file.contentType,
      length: content.file.sizeBytes,
      disposition: 'inline',
    });
  }

  @Post('catalog/reviews/:id/report')
  @Roles(...CUSTOMER_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Report an inappropriate review (once per customer)' })
  @ApiNoContentResponse()
  report(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: ReportDto) {
    return this.reviews.report(user, id, body);
  }

  @Get('reviews/:id/reports')
  @RequirePermissions('reviews.moderate')
  @ApiOperation({ summary: 'Reports on a review' })
  reports(@Id() id: string) {
    return this.reviews.reports(id);
  }

  @Post('reviews/:id/reports/resolve')
  @RequirePermissions('reviews.moderate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Uphold (hide the review; note required) or dismiss its open reports' })
  @ApiNoContentResponse()
  resolveReports(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ResolveReportsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.reviews.resolveReports(user, id, body, context);
  }

  @Get('seller/reviews')
  @Roles(...SELLER_ROLES)
  @RequirePermissions('seller.reviews.reply')
  @ApiOperation({ summary: 'Published reviews of my products (filter: replied, stars)' })
  @ApiOkResponse({ schema: zodToOpenApi(adminReviewListSchema) })
  sellerList(@CurrentUser() user: AuthenticatedUser, @Query() query: SellerReviewQueryDto) {
    return this.reviews.sellerList(user, query);
  }

  @Put('seller/reviews/:id/reply')
  @Roles(...SELLER_ROLES)
  @RequirePermissions('seller.reviews.reply')
  @ApiOperation({ summary: 'Reply to a review of my product (replaces an earlier reply)' })
  @ApiOkResponse({ schema: zodToOpenApi(adminReviewSchema) })
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReplyDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.reviews.reply(user, id, body, context);
  }

  @Delete('seller/reviews/:id/reply')
  @Roles(...SELLER_ROLES)
  @RequirePermissions('seller.reviews.reply')
  @ApiOperation({ summary: 'Remove my reply' })
  @ApiOkResponse({ schema: zodToOpenApi(adminReviewSchema) })
  removeReply(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.reviews.reply(user, id, null, context);
  }

  @Put('account/seller-orders/:sellerOrderId/rating')
  @Roles(...CUSTOMER_ROLES)
  @ApiOperation({
    summary: 'Rate the seller for a delivered order: quality, shipping, communication',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerRatingSchema) })
  rateSeller(
    @CurrentUser() user: AuthenticatedUser,
    @Id('sellerOrderId') sellerOrderId: string,
    @Body() body: SellerRatingDto,
  ) {
    return this.reviews.rateSeller(user, sellerOrderId, body);
  }

  @Get('catalog/stores/:storeId/ratings')
  @Public()
  @ApiOperation({ summary: 'Seller rating of a store (from delivered orders)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerRatingSummarySchema) })
  storeRatings(@Id('storeId') storeId: string) {
    return this.reviews.storeRatingSummary(storeId);
  }

  @Get('seller/ratings')
  @Roles(...SELLER_ROLES)
  @RequirePermissions('seller.orders.read')
  @ApiOperation({ summary: 'My seller rating and the latest customer ratings' })
  sellerRatings(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.mySellerRatings(user);
  }
}
