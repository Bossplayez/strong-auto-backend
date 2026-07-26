import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsBooleanString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { LeadStatus } from '@prisma/client';

export class AdminLeadQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['BID_ASSISTANCE', 'BUY_NOW_ASSISTANCE'], isArray: true })
  @IsOptional()
  @IsString()
  leadType?: string;

  @ApiPropertyOptional({ description: 'Only Copart/IAAI assistance requests' })
  @IsOptional()
  @IsBooleanString()
  auctionOnly?: string;
}
