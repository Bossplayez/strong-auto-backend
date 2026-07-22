import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

export class CalculatorPreviewDto {
  @ApiProperty({ enum: ['copart', 'iaai'] })
  @IsIn(['copart', 'iaai'])
  provider: 'copart' | 'iaai';

  @ApiProperty({ enum: [1, 2, 3, 4], description: '1 gasoline, 2 diesel, 3 hybrid, 4 electric' })
  @IsInt()
  @IsIn([1, 2, 3, 4])
  fuelType: 1 | 2 | 3 | 4;

  @ApiProperty({ enum: [1, 2, 3, 4], description: '1 passenger, 2 crossover, 3 SUV, 4 motorcycle' })
  @IsInt()
  @IsIn([1, 2, 3, 4])
  bodyType: 1 | 2 | 3 | 4;

  @ApiProperty({ example: '142', description: 'Auction facility ID from the legacy calculator directory' })
  @IsString()
  @Matches(/^\d+$/)
  platformId: string;

  @ApiProperty({ example: 2019 })
  @IsInt()
  @Min(1900)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 5500 })
  @IsNumber()
  @Min(1)
  priceUsd: number;

  @ApiProperty({ example: 2000, description: 'Engine volume in cubic centimetres; 0 only for electric vehicles' })
  @IsInt()
  @Min(0)
  @Max(10000)
  engineVolumeCc: number;
}
