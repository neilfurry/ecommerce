import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({ imports: [FilesModule], controllers: [StoresController], providers: [StoresService] })
export class StoresModule {}
