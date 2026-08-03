import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MarketplaceSellerTypeDto {
  PRIVATE = 'PRIVATE',
  DEALER = 'DEALER',
}

export class CreateSellerProfileDto {
  @ApiProperty({ enum: MarketplaceSellerTypeDto })
  @IsEnum(MarketplaceSellerTypeDto)
  @IsNotEmpty()
  sellerType!: MarketplaceSellerTypeDto;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  businessName?: string;
}

export class UpdateSellerProfileDto {
  @ApiPropertyOptional({ enum: MarketplaceSellerTypeDto })
  @IsEnum(MarketplaceSellerTypeDto)
  @IsOptional()
  sellerType?: MarketplaceSellerTypeDto;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  businessName?: string;
}
