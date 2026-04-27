import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';

@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(data: {
    channel: string;
    title: string;
    bodyTemplate: string;
    scheduledAt?: string;
  }, createdByUserId?: string) {
    return this.prisma.broadcast.create({
      data: {
        channel: data.channel as any,
        title: data.title,
        bodyTemplate: data.bodyTemplate,
        status: 'DRAFT',
        createdByUserId: createdByUserId ?? null,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      },
    });
  }

  async findAll(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          createdBy: { select: { id: true, email: true, profile: true } },
        },
      }),
      this.prisma.broadcast.count(),
    ]);

    return new PaginatedResponseDto(items, total, page, pageSize);
  }

  async findById(id: string) {
    const broadcast = await this.prisma.broadcast.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, email: true, profile: true } },
      },
    });

    if (!broadcast) {
      throw new NotFoundException(`Broadcast "${id}" not found`);
    }

    return broadcast;
  }

  async update(id: string, data: Record<string, any>) {
    const broadcast = await this.findById(id);

    if (broadcast.status !== 'DRAFT') {
      throw new ConflictException('Cannot update a broadcast that has been sent');
    }

    return this.prisma.broadcast.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.bodyTemplate && { bodyTemplate: data.bodyTemplate }),
        ...(data.scheduledAt && { scheduledAt: new Date(data.scheduledAt) }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    const broadcast = await this.findById(id);

    if (broadcast.status !== 'DRAFT') {
      throw new ConflictException('Cannot delete a broadcast that has been sent');
    }

    await this.prisma.broadcast.delete({ where: { id } });
  }

  async send(id: string): Promise<{ message: string }> {
    const broadcast = await this.findById(id);

    if (broadcast.status !== 'DRAFT') {
      throw new ConflictException('Broadcast has already been sent');
    }

    // Mark as sending
    await this.prisma.broadcast.update({
      where: { id },
      data: { status: 'SENDING' },
    });

    // Fetch recipients based on channel
    if (broadcast.channel === 'TELEGRAM') {
      const subscribers = await this.prisma.telegramSubscriber.findMany({
        where: { status: 'active' },
        select: { telegramChatId: true },
      });

      this.logger.log(
        `Sending broadcast ${id} to ${subscribers.length} Telegram subscribers`,
      );

      // Send async (non-blocking)
      setImmediate(async () => {
        for (const sub of subscribers) {
          await this.notificationsService.sendTelegramNotification(
            sub.telegramChatId,
            broadcast.bodyTemplate,
          );
        }

        await this.prisma.broadcast.update({
          where: { id },
          data: { status: 'SENT', sentAt: new Date() },
        });
      });
    }

    return { message: 'Broadcast sending initiated' };
  }
}
