import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ imports: [FilesModule], controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
