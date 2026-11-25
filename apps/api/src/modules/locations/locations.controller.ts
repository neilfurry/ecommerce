import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { locationListQuerySchema, locationListSchema } from '@marketplace/validation';
import { Public } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { LocationsService } from './locations.service';

class LocationListQueryDto extends createZodDto(locationListQuerySchema) {}

@ApiTags('Locations')
@Controller({ path: 'locations', version: '1' })
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'Philippine locations (PSGC): regions, or the next address step under parentCode ' +
      '(provinces and independent cities; cities and municipalities; barangays)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(locationListSchema) })
  async list(@Query() query: LocationListQueryDto) {
    return { items: await this.locations.children(query.parentCode) };
  }
}
