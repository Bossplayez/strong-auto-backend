import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateMarketplaceListingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  make!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @IsOptional()
  year?: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceAmount!: number;

  @ApiPropertyOptional({ default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  odometerValue?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  bodyType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fuelType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  transmission?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  driveType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  damage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationCountry?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationCity?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationState?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  vin?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  mediaUrls?: string[];
}

export class UpdateMarketplaceListingDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  make?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @IsOptional()
  year?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  priceAmount?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  odometerValue?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  bodyType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fuelType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  transmission?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  driveType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  damage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationCountry?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationCity?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  locationState?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  vin?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  mediaUrls?: string[];
}

export class RejectListingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  moderationComment!: string;
}
