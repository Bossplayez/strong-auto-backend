import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';
import { NewsStatus } from '../../common/enums';

export class CreateNewsDto {
  @ApiProperty({ example: 'New Vehicles from Copart' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'new-vehicles-from-copart' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ example: '<p>Article body HTML</p>' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ example: 'Short summary for cards' })
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiPropertyOptional({ example: 'file_abc123' })
  @IsOptional()
  @IsString()
  coverImageId?: string;

  @ApiPropertyOptional({ enum: NewsStatus, default: NewsStatus.DRAFT })
  @IsOptional()
  @IsEnum(NewsStatus)
  status?: NewsStatus;

  @ApiPropertyOptional({ example: 'uk' })
  @IsOptional()
  @IsString()
  locale?: string;
}
