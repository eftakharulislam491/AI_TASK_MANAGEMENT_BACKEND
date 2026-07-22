import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderFile } from 'ejs';
import nodemailer from 'nodemailer';
import type { AppEnv } from '../config/env';

type TemplateName =
  | 'invitation'
  | 'task-assigned'
  | 'deadline-reminder'
  | 'overdue-task'
  | 'daily-digest'
  | 'role-change-requested'
  | 'role-change-reviewed';

type InvitationEmailInput = {
  to: string;
  inviterName?: string;
  organizationName: string;
  acceptUrl?: string;
  inviteUrl?: string;
  expiresAt?: Date;
  message?: string;
};

type TaskEmailInput = {
  to: string;
  taskTitle: string;
  taskUrl: string;
  assigneeName?: string;
  deadline?: Date | null;
};

type DailyDigestEmailInput = {
  to: string;
  recipientName?: string;
  dashboardUrl: string;
  totalCount: number;
  overdueCount: number;
  dueSoonCount: number;
  tasks: Array<{
    title: string;
    status: string;
    priority: string;
    projectName?: string | null;
    taskUrl: string;
    deadline?: Date | null;
    isOverdue: boolean;
  }>;
};

type RoleChangeEmailInput = {
  to: string;
  recipientName?: string;
  requesterName?: string;
  targetName?: string;
  currentRole?: string;
  requestedRole?: string;
  status?: string;
  decision?: string;
  reason?: string | null;
  reviewNote?: string | null;
  requestsUrl?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  async sendInvitationEmail(input: InvitationEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Invitation to join ${input.organizationName}`,
      html: await this.renderTemplate('invitation', {
        ...input,
        acceptUrl: input.acceptUrl ?? input.inviteUrl,
        inviteUrl: input.inviteUrl ?? input.acceptUrl,
        expiresAt: input.expiresAt
          ? this.formatDate(input.expiresAt)
          : undefined,
      }),
    });
  }

  async sendTaskAssignedEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `New task assigned: ${input.taskTitle}`,
      html: await this.renderTemplate('task-assigned', {
        ...input,
        deadline: input.deadline ? this.formatDate(input.deadline) : undefined,
      }),
    });
  }

  async sendDeadlineReminderEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Task deadline approaching: ${input.taskTitle}`,
      html: await this.renderTemplate('deadline-reminder', {
        ...input,
        deadline: input.deadline ? this.formatDate(input.deadline) : undefined,
      }),
    });
  }

  async sendOverdueTaskEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Task overdue: ${input.taskTitle}`,
      html: await this.renderTemplate('overdue-task', {
        ...input,
        deadline: input.deadline ? this.formatDate(input.deadline) : undefined,
      }),
    });
  }

  async sendDailyDigestEmail(input: DailyDigestEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: 'Your TaskFlow daily digest',
      html: await this.renderTemplate('daily-digest', {
        ...input,
        tasks: input.tasks.map((task) => ({
          ...task,
          deadline: task.deadline ? this.formatDate(task.deadline) : undefined,
        })),
      }),
    });
  }

  async sendRoleChangeRequestedEmail(input: RoleChangeEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: 'Role change request submitted',
      html: await this.renderTemplate('role-change-requested', input),
    });
  }

  async sendRoleChangeReviewedEmail(input: RoleChangeEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: 'Role change request reviewed',
      html: await this.renderTemplate('role-change-reviewed', input),
    });
  }

  private async sendMail(input: { to: string; subject: string; html: string }) {
    const host = this.configService.get('SMTP_HOST', { infer: true });
    const user = this.configService.get('SMTP_USER', { infer: true });
    const pass = this.configService.get('SMTP_PASS', { infer: true });
    const fromEmail = this.configService.get('SMTP_FROM_EMAIL', {
      infer: true,
    });

    if (!host || !user || !pass || !fromEmail) {
      this.logger.warn(
        `SMTP is not configured. Skipping email "${input.subject}" to ${input.to}.`,
      );
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port: this.configService.get('SMTP_PORT', { infer: true }),
      secure: this.configService.get('SMTP_SECURE', { infer: true }),
      auth: {
        user,
        pass,
      },
    });
    const fromName = this.configService.get('SMTP_FROM_NAME', { infer: true });

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
  }

  private renderTemplate(
    templateName: TemplateName,
    data: Record<string, unknown>,
  ) {
    const filePath = this.resolveTemplatePath(templateName);
    const templateData = {
      appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
      ...data,
    };

    return new Promise<string>((resolve, reject) => {
      renderFile(filePath, templateData, (error, html) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(html);
      });
    });
  }

  private resolveTemplatePath(templateName: TemplateName) {
    const fileName = `${templateName}.ejs`;
    const candidates = [
      join(__dirname, 'templates', fileName),
      join(process.cwd(), 'dist', 'mail', 'templates', fileName),
      join(process.cwd(), 'src', 'mail', 'templates', fileName),
    ];

    const templatePath = candidates.find((candidate) => existsSync(candidate));

    if (!templatePath) {
      throw new Error(
        `Email template "${templateName}" not found in expected locations.`,
      );
    }

    return templatePath;
  }

  private formatDate(value: Date | string) {
    return new Date(value).toLocaleString();
  }
}
