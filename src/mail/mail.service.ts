import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppEnv } from '../config/env';

type InvitationEmailInput = {
  to: string;
  organizationName: string;
  inviteUrl: string;
  inviterName?: string;
  message?: string;
};

type TaskEmailInput = {
  to: string;
  taskTitle: string;
  taskUrl?: string;
  assigneeName?: string;
  deadline?: Date | string | null;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;
  private smtpWarningShown = false;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  async sendInvitationEmail(input: InvitationEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Invitation to join ${input.organizationName}`,
      html: this.wrapTemplate({
        title: `Join ${input.organizationName}`,
        preview: input.inviterName
          ? `${input.inviterName} invited you to collaborate.`
          : 'You have been invited to collaborate.',
        body: `
          <p>You have been invited to join <strong>${this.escapeHtml(input.organizationName)}</strong>.</p>
          ${input.message ? `<p>${this.escapeHtml(input.message)}</p>` : ''}
          <p>Accept the invitation to start working with your team.</p>
        `,
        ctaLabel: 'Accept invitation',
        ctaUrl: input.inviteUrl,
      }),
    });
  }

  async sendTaskAssignedEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Task assigned: ${input.taskTitle}`,
      html: this.wrapTemplate({
        title: 'New task assigned',
        preview: input.taskTitle,
        body: `
          <p>${input.assigneeName ? `${this.escapeHtml(input.assigneeName)}, you` : 'You'} have been assigned a new task.</p>
          <p><strong>${this.escapeHtml(input.taskTitle)}</strong></p>
        `,
        ctaLabel: input.taskUrl ? 'View task' : undefined,
        ctaUrl: input.taskUrl,
      }),
    });
  }

  async sendDeadlineReminderEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Deadline reminder: ${input.taskTitle}`,
      html: this.wrapTemplate({
        title: 'Deadline reminder',
        preview: input.taskTitle,
        body: `
          <p>This task is approaching its deadline.</p>
          <p><strong>${this.escapeHtml(input.taskTitle)}</strong></p>
          ${input.deadline ? `<p>Deadline: ${this.escapeHtml(this.formatDate(input.deadline))}</p>` : ''}
        `,
        ctaLabel: input.taskUrl ? 'Review task' : undefined,
        ctaUrl: input.taskUrl,
      }),
    });
  }

  async sendOverdueTaskEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Overdue task: ${input.taskTitle}`,
      html: this.wrapTemplate({
        title: 'Task overdue',
        preview: input.taskTitle,
        body: `
          <p>This task is past its deadline and needs attention.</p>
          <p><strong>${this.escapeHtml(input.taskTitle)}</strong></p>
          ${input.deadline ? `<p>Original deadline: ${this.escapeHtml(this.formatDate(input.deadline))}</p>` : ''}
        `,
        ctaLabel: input.taskUrl ? 'Open task' : undefined,
        ctaUrl: input.taskUrl,
      }),
    });
  }

  private getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.configService.get('SMTP_HOST', { infer: true });
    const user = this.configService.get('SMTP_USER', { infer: true });
    const pass = this.configService.get('SMTP_PASS', { infer: true });

    if (!host || !user || !pass) {
      if (!this.smtpWarningShown) {
        this.logger.warn(
          'SMTP env is missing. Mail notifications are currently disabled.',
        );
        this.smtpWarningShown = true;
      }

      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: this.configService.get('SMTP_PORT', { infer: true }),
      secure: this.configService.get('SMTP_SECURE', { infer: true }),
      auth: {
        user,
        pass,
      },
    });

    return this.transporter;
  }

  private async sendMail(input: {
    to: string;
    subject: string;
    html: string;
  }) {
    const transporter = this.getTransporter();

    if (!transporter) {
      return;
    }

    try {
      await transporter.sendMail({
        from: this.getFromAddress(),
        ...input,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send mail to ${input.to}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private getFromAddress() {
    const email = this.configService.get('SMTP_FROM_EMAIL', { infer: true });
    const name = this.configService.get('SMTP_FROM_NAME', { infer: true });

    return email ? `"${name}" <${email}>` : name;
  }

  private wrapTemplate(input: {
    title: string;
    preview: string;
    body: string;
    ctaLabel?: string;
    ctaUrl?: string;
  }) {
    const cta =
      input.ctaLabel && input.ctaUrl
        ? `<p style="margin:28px 0"><a href="${this.escapeHtml(input.ctaUrl)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;display:inline-block;font-weight:700">${this.escapeHtml(input.ctaLabel)}</a></p>`
        : '';

    return `
      <!doctype html>
      <html>
        <body style="margin:0;background:#f6f7fb;color:#111827;font-family:Arial,sans-serif">
          <span style="display:none">${this.escapeHtml(input.preview)}</span>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
                  <tr>
                    <td style="padding:32px">
                      <h1 style="font-size:24px;line-height:32px;margin:0 0 16px">${this.escapeHtml(input.title)}</h1>
                      <div style="font-size:15px;line-height:24px;color:#374151">${input.body}</div>
                      ${cta}
                      <p style="font-size:12px;line-height:18px;color:#6b7280;margin-top:28px">TaskFlow notification</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }

  private formatDate(value: Date | string) {
    return new Date(value).toLocaleString();
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
