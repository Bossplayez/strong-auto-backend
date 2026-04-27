import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NewsService } from './news.service';
import { NewsQueryDto } from './dto';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@ApiTags('News')
@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get()
  @ApiOperation({ summary: 'List published news articles' })
  @ApiResponse({ status: 200, description: 'Paginated list of news articles' })
  async findAll(
    @Query() query: NewsQueryDto,
  ): Promise<PaginatedResponseDto<any>> {
    return this.newsService.findAll(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get a single news article by slug' })
  @ApiResponse({ status: 200, description: 'News article details' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  async findBySlug(@Param('slug') slug: string): Promise<any> {
    return this.newsService.findBySlug(slug);
  }
}
