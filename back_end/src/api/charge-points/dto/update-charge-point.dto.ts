import { PartialType } from '@nestjs/mapped-types';
import { CreateChargePointDto } from './create-charge-point.dto';

export class UpdateChargePointDto extends PartialType(CreateChargePointDto) {}
