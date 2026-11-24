import { Module } from '@nestjs/common';
import { FilesService } from './files.service';

/** File metadata + object storage. Upload features import this module. */
@Module({
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
