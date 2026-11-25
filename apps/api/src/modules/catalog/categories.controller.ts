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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  type ApiBodyOptions,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  categoryAttributesSchema,
  categoryListSchema,
  categorySchema,
  uuidSchema,
} from '@marketplace/validation';
import type { Response } from 'express';
import {
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
  RequirePermissions,
} from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CreateCategoryDto, PutCategoryAttributesDto, UpdateCategoryDto } from './catalog.dtos';
import { CategoriesService } from './categories.service';

const Id = () => Param('id', new ZodValidationPipe(uuidSchema));
export const imageUploadBody: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};
export const requireFile = (file: Express.Multer.File | undefined) => {
  if (!file) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'BAD_REQUEST',
      'Attach a file in the "file" field.',
    );
  }
  return { buffer: file.buffer, originalName: file.originalname };
};

@ApiTags('Categories')
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Active categories, parents first (public)' })
  @ApiOkResponse({ schema: zodToOpenApi(categoryListSchema) })
  list() {
    return this.categories.list({ activeOnly: true });
  }

  @Get('all')
  @RequirePermissions('catalog.categories.manage')
  @ApiOperation({ summary: 'Every category, including inactive ones' })
  @ApiOkResponse({ schema: zodToOpenApi(categoryListSchema) })
  all() {
    return this.categories.list({ activeOnly: false });
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'One category with its own attributes (public)' })
  @ApiOkResponse({ schema: zodToOpenApi(categorySchema) })
  get(@Id() id: string) {
    return this.categories.get(id);
  }

  @Get(':id/attributes')
  @Public()
  @ApiOperation({ summary: 'Attributes products in this category fill in (own and inherited)' })
  @ApiOkResponse({ schema: zodToOpenApi(categoryAttributesSchema) })
  attributes(@Id() id: string) {
    return this.categories.effectiveAttributes(id);
  }

  @Get(':id/image')
  @Public()
  @ApiOperation({ summary: 'Category image (public)' })
  async image(@Id() id: string, @Res({ passthrough: true }) response: Response) {
    const image = await this.categories.openImage(id);
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(image.body, { type: image.contentType, length: image.sizeBytes });
  }

  @Post()
  @RequirePermissions('catalog.categories.manage')
  @ApiOperation({ summary: 'Create a category or subcategory (three levels at most)' })
  @ApiBody({ schema: CreateCategoryDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(categorySchema) })
  create(
    @Body() body: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.categories.create(user, body, context);
  }

  @Patch(':id')
  @RequirePermissions('catalog.categories.manage')
  @ApiOperation({ summary: 'Edit a category (name, link, description, status, sort order)' })
  @ApiBody({ schema: UpdateCategoryDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(categorySchema) })
  update(
    @Id() id: string,
    @Body() body: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.categories.update(user, id, body, context);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.categories.manage')
  @ApiOperation({ summary: 'Delete an empty category (no subcategories or products)' })
  @ApiNoContentResponse()
  remove(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.categories.remove(user, id, context);
  }

  @Put(':id/attributes')
  @RequirePermissions('catalog.categories.manage')
  @ApiOperation({ summary: "Replace the category's own attributes" })
  @ApiBody({ schema: PutCategoryAttributesDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(categorySchema) })
  putAttributes(
    @Id() id: string,
    @Body() body: PutCategoryAttributesDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.categories.putAttributes(user, id, body, context);
  }

  @Put(':id/image')
  @RequirePermissions('catalog.categories.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Set the category image (JPEG, PNG or WebP; stored as WebP)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(imageUploadBody)
  @ApiOkResponse({ schema: zodToOpenApi(categorySchema) })
  setImage(
    @Id() id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.categories.setImage(user, id, requireFile(file), context);
  }

  @Delete(':id/image')
  @RequirePermissions('catalog.categories.manage')
  @ApiOperation({ summary: 'Remove the category image' })
  @ApiOkResponse({ schema: zodToOpenApi(categorySchema) })
  removeImage(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.categories.removeImage(user, id, context);
  }
}
