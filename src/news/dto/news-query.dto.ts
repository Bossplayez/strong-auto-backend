import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class NewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by locale', example: 'uk' })
  @IsOptional()
  @IsString()
  locale?: string;
}
