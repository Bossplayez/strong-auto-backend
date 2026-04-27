import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsObject,
} from 'class-validator';
import { LeadType } from '../../common/enums';

export class CreateLeadDto {
  @ApiProperty({ enum: LeadType, example: LeadType.VEHICLE_INQUIRY })
  @IsEnum(LeadType)
  @IsNotEmpty()
  leadType: LeadType;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '+380991234567' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Interested in this vehicle' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'Vehicle ID if inquiry is about a specific vehicle' })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'Calculator estimate ID if from calculator' })
  @IsOptional()
  @IsString()
  calculatorEstimateId?: string;

  @ApiPropertyOptional({
    description: 'UTM parameters as JSON',
    example: { utm_source: 'google', utm_medium: 'cpc' },
  })
  @IsOptional()
  @IsObject()
  utmJsonb?: Record<string, string>;
}
