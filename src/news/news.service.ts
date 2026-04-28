import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: {
    page?: number;
    pageSize?: number;
    locale?: string;
  }): Promise<PaginatedResponseDto<any>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.NewsWhereInput = { status: 'PUBLISHED' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.news.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          slug: true,
          status: true,
          publishedAt: true,
          seoTitle: true,
          seoDescription: true,
          coverFile: {
            select: { id: true, storageKey: true, bucket: true },
          },
          translations: {
            where: query.locale ? { locale: query.locale } : undefined,
            select: {
              locale: true,
              title: true,
              excerpt: true,
            },
          },
          author: {
            select: { id: true, profile: true },
          },
        },
      }),
      this.prisma.news.count({ where }),
    ]);

    const mapped = items.map((item: any) => ({
      ...item,
      coverImageUrl: item.coverFile?.storageKey || null,
      createdAt: item.publishedAt || item.createdAt,
    }));

    return new PaginatedResponseDto(mapped, total, page, pageSize);
  }

  async findBySlug(slug: string) {
    const news = await this.prisma.news.findUnique({
      where: { slug },
      include: {
        translations: true,
        coverFile: true,
        author: {
          select: { id: true, email: true, profile: true },
        },
      },
    });

    if (!news || news.status !== 'PUBLISHED') {
      throw new NotFoundException(`News article "${slug}" not found`);
    }

    return {
      ...news,
      coverImageUrl: news.coverFile?.storageKey || null,
    };
  }

  // Admin methods
  async findAllAdmin(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.news.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          translations: true,
          author: { select: { id: true, profile: true } },
        },
      }),
      this.prisma.news.count(),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async create(
    data: {
      slug: string;
      status?: string;
      seoTitle?: string;
      seoDescription?: string;
      coverFileId?: string;
      translations?: Array<{
        locale: string;
        title: string;
        excerpt?: string;
        body: string;
      }>;
    },
    authorUserId: string,
  ) {
    return this.prisma.news.create({
      data: {
        slug: data.slug,
        status: (data.status as any) ?? 'DRAFT',
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        coverFileId: data.coverFileId,
        authorUserId,
        ...(data.translations?.length && {
          translations: {
            create: data.translations,
          },
        }),
      },
      include: { translations: true },
    });
  }

  async update(id: number, data: Record<string, any>) {
    const news = await this.prisma.news.findUnique({ where: { id } });
    if (!news) throw new NotFoundException(`News #${id} not found`);

    return this.prisma.news.update({
      where: { id },
      data: {
        ...(data.slug && { slug: data.slug }),
        ...(data.status && { status: data.status }),
        ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
        ...(data.seoDescription !== undefined && { seoDescription: data.seoDescription }),
        ...(data.status === 'PUBLISHED' && !news.publishedAt && {
          publishedAt: new Date(),
        }),
      },
      include: { translations: true },
    });
  }

  async delete(id: number) {
    const news = await this.prisma.news.findUnique({ where: { id } });
    if (!news) throw new NotFoundException(`News #${id} not found`);

    await this.prisma.news.delete({ where: { id } });
  }
}
