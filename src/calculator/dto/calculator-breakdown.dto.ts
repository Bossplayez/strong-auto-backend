import { ApiProperty } from '@nestjs/swagger';

export class BreakdownLineDto {
  @ApiProperty({ example: 'Auction Fee' })
  label: string;

  @ApiProperty({ example: 750 })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

export class CalculatorBreakdownDto {
  @ApiProperty({ example: 'est_abc123' })
  estimateId: string;

  @ApiProperty({ example: 750 })
  auctionFee: number;

  @ApiProperty({ example: 1200 })
  logistics: number;

  @ApiProperty({ example: 3500 })
  customs: number;

  @ApiProperty({ example: 300 })
  insurance: number;

  @ApiProperty({ example: 500 })
  serviceFees: number;

  @ApiProperty({ example: 41.5, description: 'UAH per 1 USD' })
  exchangeRate: number;

  @ApiProperty({ example: 850000 })
  totalAmount: number;

  @ApiProperty({ example: 'UAH' })
  totalCurrency: string;

  @ApiProperty({ type: [BreakdownLineDto] })
  breakdown: BreakdownLineDto[];
}
