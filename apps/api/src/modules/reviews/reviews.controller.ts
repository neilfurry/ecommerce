import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import {
  adminReviewListQuerySchema,
  adminReviewListSchema,
  createReviewSchema,
  moderateReviewSchema,
  myReviewsSchema,
  reviewListQuerySchema,
  reviewListSchema,
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
}
