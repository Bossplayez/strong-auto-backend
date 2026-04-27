import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 'Kyiv' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'uk', description: 'ISO 639-1 language code' })
  @IsOptional()
  @IsString()
  preferredLanguage?: string;
}
