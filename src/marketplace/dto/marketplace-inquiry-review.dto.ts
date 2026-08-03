import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum MarketplaceInquiryStatusDto {
  OPEN = 'OPEN',
  CLOSED_INTERESTED = 'CLOSED_INTERESTED',
  CLOSED_NOT_INTERESTED = 'CLOSED_NOT_INTERESTED',
  CLOSED_SOLD = 'CLOSED_SOLD',
}

export enum MarketplaceReviewStatusDto {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class CloseInquiryDto {
  @ApiPropertyOptional({ enum: MarketplaceInquiryStatusDto })
  @IsEnum(MarketplaceInquiryStatusDto)
  @IsOptional()
  status?: MarketplaceInquiryStatusDto;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  sellerRating!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  listingRating!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  comment?: string;
}

export class SellerReplyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sellerReply!: string;
}

export class ModerateReviewDto {
  @ApiProperty({ enum: MarketplaceReviewStatusDto })
  @IsEnum(MarketplaceReviewStatusDto)
  @IsNotEmpty()
  status!: MarketplaceReviewStatusDto;
}
