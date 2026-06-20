import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null = null;
  private readonly fromEmail: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL') ??
      'noreply@strongauto.com.ua';
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ??
      'https://strong-auto-frontend-zeta.vercel.app';

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log('Resend email service initialized');
    } else {
      this.logger.warn(
        'RESEND_API_KEY not set — emails will be logged to console (dev mode)',
      );
    }
  }

  /** Send an email verification link to a newly registered user. */
  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verifyUrl = `${this.frontendUrl}/verify-email?token=${token}`;
    const subject = 'Підтвердіть вашу email-адресу — Strong Auto';
    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Ласкаво просимо до Strong Auto!</h2>
        <p>Будь ласка, підтвердіть вашу email-адресу, натиснувши кнопку нижче:</p>
        <p>
          <a href="${verifyUrl}"
             style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">
            Підтвердити email
          </a>
        </p>
        <p style="color:#666;font-size:14px;">
          Або скопіюйте це посилання: <br />
          <a href="${verifyUrl}">${verifyUrl}</a>
        </p>
        <p style="color:#999;font-size:13px;">
          Посилання дійсне 24 години. Якщо ви не створювали акаунт — проігноруйте цей лист.
        </p>
      </div>
    `;

    await this.send(email, subject, html);
  }

  /** Send a password reset link. */
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${token}`;
    const subject = 'Відновлення пароля — Strong Auto';
    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Відновлення пароля</h2>
        <p>Ми отримали запит на зміну пароля для вашого акаунта.</p>
        <p>
          <a href="${resetUrl}"
             style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">
            Скинути пароль
          </a>
        </p>
        <p style="color:#666;font-size:14px;">
          Або скопіюйте це посилання: <br />
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="color:#999;font-size:13px;">
          Посилання дійсне 1 годину. Якщо ви не запитували зміну пароля — проігноруйте цей лист.
        </p>
      </div>
    `;

    await this.send(email, subject, html);
  }

  // ─── Internal ──────────────────────────────────────────────
  private async send(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    // Dev mode — no API key
    if (!this.resend) {
      this.logger.log(
        `📧 [DEV] To: ${to} | Subject: ${subject}\n${html.replace(/<[^>]*>/g, '').slice(0, 200)}...`,
      );
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Resend API error for ${to}: ${error.message}`);
        return;
      }

      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (err) {
      // Never crash the auth flow — just log
      this.logger.error(
        `Failed to send email to ${to}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }
}
