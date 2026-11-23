import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { IdTag } from '../../entities/id-tag.entity';
import { CreateIdTagDto, UpdateIdTagDto } from './dto/id-tag.dto';

/** The tester's wallet of RFID cards. */
@Controller('id-tags')
export class IdTagsController {
  constructor(
    @InjectRepository(IdTag)
    private readonly tags: Repository<IdTag>,
  ) {}

  @Get()
  list() {
    return this.tags.find({ order: { id: 'ASC' } });
  }

  @Post()
  async create(@Body() dto: CreateIdTagDto) {
    const idTag = dto.idTag.trim();
    if (await this.tags.findOneBy({ idTag })) {
      throw new ConflictException(
        `A card with the idTag "${idTag}" already exists.`,
      );
    }
    return this.tags.save(
      this.tags.create({ ...dto, idTag, label: dto.label.trim() }),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIdTagDto,
  ) {
    const tag = await this.tags.findOneBy({ id });
    if (!tag) throw new NotFoundException('Card not found.');
    if (dto.idTag !== undefined) {
      const idTag = dto.idTag.trim();
      if (await this.tags.findOneBy({ idTag, id: Not(id) })) {
        throw new ConflictException(
          `A card with the idTag "${idTag}" already exists.`,
        );
      }
      tag.idTag = idTag;
    }
    if (dto.label !== undefined) tag.label = dto.label.trim();
    if (dto.color !== undefined) tag.color = dto.color;
    return this.tags.save(tag);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.tags.delete(id);
    if (!result.affected) throw new NotFoundException('Card not found.');
    return { deleted: true };
  }
}
