import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class RefreshDto {
  @ApiPropertyOptional({ description: 'JWT refresh token (also read from httpOnly cookie)' })
  @IsString()
  @IsOptional()
  refreshToken?: string;
}
