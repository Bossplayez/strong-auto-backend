import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CalculatorService } from './calculator.service';
import { CalculateEstimateDto, CalculatorBreakdownDto, CalculatorPreviewDto } from './dto';
import type { CalculatorPreviewResult } from './calculator-preview.types';

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

  @Post('preview')
  @ApiOperation({ summary: 'Preview the existing Strong Auto calculator without saving an estimate' })
  @ApiResponse({ status: 201, description: 'Preview result or an unavailable state' })
  async preview(@Body() dto: CalculatorPreviewDto): Promise<CalculatorPreviewResult> {
    return this.calculatorService.preview(dto);
  }
}
