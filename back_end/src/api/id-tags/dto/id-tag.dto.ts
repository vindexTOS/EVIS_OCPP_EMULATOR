import { PartialType } from '@nestjs/mapped-types';
import {
  IsHexColor,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateIdTagDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label: string;

  /** OCPP idTag: CiString20. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  idTag: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateIdTagDto extends PartialType(CreateIdTagDto) {}
