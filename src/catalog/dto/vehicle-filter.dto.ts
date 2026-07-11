import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, IsEnum, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class VehicleFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Toyota' })
  @IsOptional()
  @IsString()
  make?: string;

  @ApiPropertyOptional({ example: 'Camry' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 2018 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  yearFrom?: number;

  @ApiPropertyOptional({ example: 2024 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  yearTo?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceFrom?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceTo?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  mileageFrom?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  mileageTo?: number;

  @ApiPropertyOptional({ example: 'sedan' })
  @IsOptional()
  @IsString()
  bodyType?: string;

  @ApiPropertyOptional({ example: 'gasoline' })
  @IsOptional()
  @IsString()
  fuelType?: string;

  @ApiPropertyOptional({ example: 'automatic' })
  @IsOptional()
  @IsString()
  transmission?: string;

  @ApiPropertyOptional({ example: 'AWD' })
  @IsOptional()
  @IsString()
  driveType?: string;

  @ApiPropertyOptional({ enum: ['INTERNAL', 'COPART', 'IAAI'] })
  @IsOptional()
  @IsIn(['INTERNAL', 'COPART', 'IAAI'])
  sourceType?: string;

  @ApiPropertyOptional({ enum: ['USA', 'EUROPE', 'UKRAINE'] })
  @IsOptional()
  @IsIn(['USA', 'EUROPE', 'UKRAINE'])
  sourceRegion?: string;

  @ApiPropertyOptional({ enum: ['AVAILABLE', 'RESERVED', 'SOLD'] })
  @IsOptional()
  @IsString()
  availabilityStatus?: string;

  @ApiPropertyOptional({
    example: 'price_asc',
    description: 'Sort field and direction (e.g. price_asc, price_desc, year_desc, createdAt_desc)',
  })
  @IsOptional()
  @IsString()
  sort?: string;
}
