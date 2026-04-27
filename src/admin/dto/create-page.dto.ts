import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePageDto {
  @ApiProperty({ example: 'About Us' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'about-us' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ example: '<p>Page content HTML</p>' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ example: 'uk' })
  @IsOptional()
  @IsString()
  locale?: string;
}
