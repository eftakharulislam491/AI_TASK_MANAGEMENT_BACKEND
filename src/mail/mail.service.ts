import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderFile } from 'ejs';
import nodemailer, { type Transporter } from 'nodemailer';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEnv } from '../config/env';

type InvitationEmailInput = {
  to: string;
  organizationName: string;
  inviteUrl: string;
  inviterName?: string;
  message?: string;
  expiresAt?: Date;
};

type TaskEmailInput = {
  to: string;
  taskTitle: string;
  taskUrl?: string;
  assigneeName?: string;
  deadline?: Date | string | null;
};

type DailyDigestTask = {
  title: string;
  status: string;
  priority: string;
  projectName?: string;
  taskUrl?: string;
  deadline?: Date | string | null;
  isOverdue: boolean;
};

type DailyDigestEmailInput = {
  to: string;
  recipientName?: string;
  dashboardUrl?: string;
  totalCount: number;
  overdueCount: number;
  dueSoonCount: number;
  tasks: DailyDigestTask[];
};

type RoleChangeEmailInput = {
  to: string;
  recipientName?: string;
  requesterName: string;
  targetName: string;
  currentRole: string;
  requestedRole: string;
  reason?: string | null;
  decision?: 'APPROVED' | 'REJECTED';
  reviewNote?: string | null;
};

type TemplateName =
  | 'invitation'
  | 'task-assigned'
  | 'deadline-reminder'
  | 'overdue-task'
  | 'daily-digest'
  | 'role-change-requested'
  | 'role-change-reviewed';

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
      html: await this.renderTemplate('invitation', {
        organizationName: input.organizationName,
        inviteUrl: input.inviteUrl,
        inviterName: input.inviterName,
        message: input.message,
        expiresAt: input.expiresAt
          ? this.formatDate(input.expiresAt)
          : undefined,
        appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
      }),
    });
  }

  async sendTaskAssignedEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Task assigned: ${input.taskTitle}`,
      html: await this.renderTemplate('task-assigned', {
        taskTitle: input.taskTitle,
        taskUrl: input.taskUrl,
        assigneeName: input.assigneeName,
        appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
      }),
    });
  }

  async sendDeadlineReminderEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Deadline reminder: ${input.taskTitle}`,
      html: await this.renderTemplate('deadline-reminder', {
        taskTitle: input.taskTitle,
        taskUrl: input.taskUrl,
        deadline: input.deadline ? this.formatDate(input.deadline) : undefined,
        appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
      }),
    });
  }

  async sendOverdueTaskEmail(input: TaskEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Overdue task: ${input.taskTitle}`,
      html: await this.renderTemplate('overdue-task', {
        taskTitle: input.taskTitle,
        taskUrl: input.taskUrl,
        deadline: input.deadline ? this.formatDate(input.deadline) : undefined,
        appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
      }),
    });
  }

  async sendDailyDigestEmail(input: DailyDigestEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Daily task digest: ${input.totalCount} active tasks`,
      html: await this.renderTemplate('daily-digest', {
        recipientName: input.recipientName,
        dashboardUrl: input.dashboardUrl,
        totalCount: input.totalCount,
        overdueCount: input.overdueCount,
        dueSoonCount: input.dueSoonCount,
        tasks: input.tasks.map((task) => ({
          ...task,
          deadline: task.deadline ? this.formatDate(task.deadline) : undefined,
        })),
        appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
      }),
    });
  }

  async sendRoleChangeRequestedEmail(input: RoleChangeEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Role change requested: ${input.currentRole} to ${input.requestedRole}`,
      html: await this.renderTemplate('role-change-requested', {
        ...input,
        requestsUrl: `${this.configService.get('APP_URL', { infer: true })}/dashboard/requests`,
        appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
      }),
    });
  }

  async sendRoleChangeReviewedEmail(input: RoleChangeEmailInput) {
    await this.sendMail({
      to: input.to,
      subject: `Role change request ${input.decision?.toLowerCase()}`,
      html: await this.renderTemplate('role-change-reviewed', {
        ...input,
        requestsUrl: `${this.configService.get('APP_URL', { infer: true })}/dashboard/requests`,
        appName: this.configService.get('SMTP_FROM_NAME', { infer: true }),
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

  private async sendMail(input: { to: string; subject: string; html: string }) {
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

  private async renderTemplate(
    templateName: TemplateName,
    data: Record<string, unknown>,
  ) {
    const filePath = this.resolveTemplatePath(templateName);

    return new Promise<string>((resolve, reject) => {
      renderFile(filePath, data, (error, html) => {
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
