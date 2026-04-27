import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsInt,
  Min,
} from 'class-validator';

export class CalculateEstimateDto {
  @ApiPropertyOptional({ description: 'ID of a vehicle from the catalog' })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiProperty({ example: 15000, description: 'Vehicle price amount' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  priceAmount: number;

  @ApiProperty({ example: 'USD', description: 'Currency of the price' })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({ example: 'gasoline' })
  @IsString()
  @IsNotEmpty()
  fuelType: string;

  @ApiProperty({ example: 2.5, description: 'Engine volume in liters' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  engineVolume: number;

  @ApiProperty({ example: 2020 })
  @IsInt()
  @IsNotEmpty()
  @Min(1900)
  year: number;

  @ApiPropertyOptional({ example: 'US', description: 'Source country code' })
  @IsOptional()
  @IsString()
  sourceCountry?: string;

  @ApiPropertyOptional({ example: 'CA', description: 'Source state/province' })
  @IsOptional()
  @IsString()
  sourceState?: string;

  @ApiPropertyOptional({ example: 'Kyiv', description: 'Destination city' })
  @IsOptional()
  @IsString()
  destinationCity?: string;
}
