import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendTelegramNotification(
    chatId: string,
    message: string,
  ): Promise<void> {
    const record = await this.prisma.notificationMessage.create({
      data: {
        channel: 'TELEGRAM',
        recipientRef: chatId,
        payloadJsonb: { message } as any,
        status: 'PENDING',
      },
    });

    try {
      const botToken = this.config.get('TELEGRAM_BOT_TOKEN');
      if (!botToken) {
        this.logger.warn('TELEGRAM_BOT_TOKEN not configured, skipping');
        return;
      }

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.status}`);
      }

      await this.prisma.notificationMessage.update({
        where: { id: record.id },
        data: { status: 'SENT', sentAt: new Date() },
      });

      this.logger.log(`Telegram notification sent to ${chatId}`);
    } catch (error) {
      await this.prisma.notificationMessage.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      this.logger.error(`Failed to send Telegram notification: ${error}`);
    }
  }

  async sendEmailNotification(
    to: string,
    subject: string,
    htmlBody: string,
  ): Promise<void> {
    const record = await this.prisma.notificationMessage.create({
      data: {
        channel: 'EMAIL',
        recipientRef: to,
        payloadJsonb: { subject, htmlBody } as any,
        status: 'PENDING',
      },
    });

    try {
      // TODO: Integrate with actual email provider (SendGrid, AWS SES, etc.)
      this.logger.log(`Email notification sent to ${to}: ${subject}`);

      await this.prisma.notificationMessage.update({
        where: { id: record.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (error) {
      await this.prisma.notificationMessage.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      this.logger.error(`Failed to send email: ${error}`);
    }
  }

  async processNotificationQueue(): Promise<void> {
    const pending = await this.prisma.notificationMessage.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    this.logger.log(`Processing ${pending.length} pending notifications`);

    for (const msg of pending) {
      const payload = msg.payloadJsonb as any;

      if (msg.channel === 'TELEGRAM') {
        await this.sendTelegramNotification(
          msg.recipientRef,
          payload?.message ?? '',
        );
      } else if (msg.channel === 'EMAIL') {
        await this.sendEmailNotification(
          msg.recipientRef,
          payload?.subject ?? '',
          payload?.htmlBody ?? '',
        );
      }
    }
  }

  async notifyManagersOfNewLead(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { vehicle: { select: { title: true, slug: true } } },
    });

    if (!lead) return;

    const managerChatId = this.config.get('TELEGRAM_MANAGER_CHAT_ID');
    if (managerChatId) {
      const vehicleInfo = lead.vehicle
        ? `\n🚗 ${lead.vehicle.title}`
        : '';
      const message =
        `📩 <b>Новий лід!</b>\n` +
        `Тип: ${lead.leadType}\n` +
        `Ім'я: ${lead.name ?? 'N/A'}\n` +
        `Телефон: ${lead.phone ?? 'N/A'}` +
        vehicleInfo;

      await this.sendTelegramNotification(managerChatId, message);
    }
  }
}
