import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CalculatorService } from './calculator.service';
import { CalculateEstimateDto, CalculatorBreakdownDto } from './dto';

@ApiTags('Calculator')
@Controller('calculator')
export class CalculatorController {
  constructor(private readonly calculatorService: CalculatorService) {}

  @Post('estimate')
  @ApiOperation({ summary: 'Calculate vehicle import cost estimate' })
  @ApiResponse({
    status: 201,
    description: 'Cost estimate calculated successfully',
    type: CalculatorBreakdownDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  async estimate(
    @Body() dto: CalculateEstimateDto,
  ): Promise<CalculatorBreakdownDto> {
    return this.calculatorService.calculateEstimate(dto);
  }
}
