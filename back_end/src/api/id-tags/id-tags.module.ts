import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdTag } from '../../entities/id-tag.entity';
import { IdTagsController } from './id-tags.controller';

@Module({
  imports: [TypeOrmModule.forFeature([IdTag])],
  controllers: [IdTagsController],
})
export class IdTagsModule {}
