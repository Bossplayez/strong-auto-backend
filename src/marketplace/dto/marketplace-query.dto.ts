import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class MarketplaceQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  make?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  bodyType?: string;

  @ApiPropertyOptional({ enum: ['PRIVATE', 'DEALER'] })
  @IsString()
  @IsOptional()
  sellerType?: 'PRIVATE' | 'DEALER';

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @IsOptional()
  yearFrom?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @IsOptional()
  yearTo?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  priceFrom?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  priceTo?: number;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
