import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type NotificationType, type TaskStatus } from '@prisma/client';
import type { AppEnv } from '../config/env';
import { MailService } from '../mail/mail.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RAGService } from '../rag/rag.service';

const activeTaskStatuses: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW'];
const reminderWindows = [24, 48] as const;
const hourInMilliseconds = 60 * 60 * 1000;

const scheduledTaskSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  title: true,
  status: true,
  priority: true,
  assigneeId: true,
  deadline: true,
  assignee: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  project: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.TaskSelect;

type ScheduledTask = Prisma.TaskGetPayload<{
  select: typeof scheduledTaskSelect;
}>;

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly ragService: RAGService,
    private readonly monitoringService: MonitoringService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkDeadlineReminders() {
    this.logger.log('Deadline reminder check started.');

    try {
      let sentCount = 0;

      for (const windowHours of reminderWindows) {
        const tasks = await this.findTasksDueAround(windowHours);

        for (const task of tasks) {
          sentCount += await this.runTaskHandler(
            task,
            () => this.sendDeadlineReminder(task, windowHours),
            'deadline reminder',
          );
        }
      }

      this.logger.log(
        `Deadline reminder check completed. Sent ${sentCount} reminders.`,
      );
    } catch (error) {
      this.logCronError('Deadline reminder check failed.', error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    this.logger.log('Overdue task check started.');

    try {
      const overdueTasks = await this.findOverdueTasks();
      let sentCount = 0;

      for (const task of overdueTasks) {
        sentCount += await this.runTaskHandler(
          task,
          () => this.sendOverdueAlert(task),
          'overdue alert',
        );
      }

      this.logger.log(
        `Overdue task check completed. Sent ${sentCount} alerts.`,
      );
    } catch (error) {
      this.logCronError('Overdue task check failed.', error);
    }
  }

  @Cron('0 9 * * *')
  async sendDailyDigest() {
    this.logger.log('Daily digest job started.');

    try {
      const tasks = await this.findDigestTasks();
      const groupedTasks = this.groupTasksByAssignee(tasks);
      let sentCount = 0;

      for (const userTasks of groupedTasks.values()) {
        const firstTask = userTasks[0];

        if (!firstTask?.assignee?.email) {
          continue;
        }

        await this.mailService.sendDailyDigestEmail({
          to: firstTask.assignee.email,
          recipientName: this.getUserName(firstTask.assignee),
          dashboardUrl: `${this.getAppUrl()}/tasks`,
          totalCount: userTasks.length,
          overdueCount: this.countOverdueTasks(userTasks),
          dueSoonCount: this.countDueSoonTasks(userTasks),
          briefing: await this.generateDigestBriefing(userTasks),
          tasks: userTasks.slice(0, 25).map((task) => ({
            title: task.title,
            status: task.status,
            priority: task.priority,
            projectName: task.project?.name,
            taskUrl: this.buildTaskUrl(task.id),
            deadline: task.deadline,
            isOverdue: this.isOverdue(task),
          })),
        });
        sentCount += 1;
      }

      this.logger.log(`Daily digest job completed. Sent ${sentCount} emails.`);
    } catch (error) {
      this.logCronError('Daily digest job failed.', error);
    }
  }

  @Cron('0 */4 * * *')
  async checkBlockedTasks() {
    this.logger.log('Blocked task monitoring started.');
    const organizations = await this.getActiveOrganizations();
    let notificationCount = 0;
    for (const organization of organizations) {
      try {
        const blocked =
          await this.monitoringService.getBlockedTasksForOrganization(
            organization.id,
          );
        for (const task of blocked.slice(0, 200)) {
          if (!task.assigneeId) continue;
          const recent = await this.hasRecentNotification(
            task.id,
            'TASK_BLOCKED',
            4,
          );
          if (recent) continue;
          await this.notificationsService.createNotification({
            userId: task.assigneeId,
            organizationId: organization.id,
            type: 'TASK_BLOCKED',
            title: 'Blocked task needs attention',
            body: `${task.title} is marked as blocked.`,
            metadata: { taskId: task.id },
          });
          notificationCount += 1;
        }
      } catch (error) {
        this.logCronError(
          `Blocked task monitoring failed for ${organization.id}.`,
          error,
        );
      }
    }
    this.logger.log(
      `Blocked task monitoring completed. Sent ${notificationCount} notifications.`,
    );
  }

  @Cron('0 8 * * *')
  async checkWorkloadImbalance() {
    this.logger.log('Workload imbalance monitoring started.');
    const organizations = await this.getActiveOrganizations();
    for (const organization of organizations) {
      try {
        const workload =
          await this.monitoringService.getWorkloadForOrganization(
            organization.id,
          );
        const overloaded = workload.filter((item) => item.workload >= 80);
        if (!overloaded.length) continue;
        const reviewers = await this.getOrganizationReviewers(organization.id);
        await this.notificationsService.createBulkNotifications(reviewers, {
          organizationId: organization.id,
          type: 'WORKLOAD_IMBALANCE',
          title: 'Workload imbalance detected',
          body: `${overloaded.length} team member${overloaded.length === 1 ? ' is' : 's are'} at or above 80% capacity.`,
          metadata: {
            overloadedUserIds: overloaded.map((item) => item.user.id),
          },
        });
      } catch (error) {
        this.logCronError(
          `Workload monitoring failed for ${organization.id}.`,
          error,
        );
      }
    }
  }

  @Cron('0 8 * * *')
  async calculateDailyRiskScores() {
    this.logger.log('Daily project risk calculation started.');
    const organizations = await this.getActiveOrganizations();
    for (const organization of organizations) {
      try {
        const risks =
          await this.monitoringService.getProjectRisksForOrganization(
            organization.id,
          );
        const highRisk = risks.filter((risk) => risk.score >= 70).length;
        this.logger.log(
          `Calculated ${risks.length} project risks for ${organization.id}; ${highRisk} high risk.`,
        );
      } catch (error) {
        this.logCronError(
          `Risk calculation failed for ${organization.id}.`,
          error,
        );
      }
    }
  }

  @Cron('0 2 * * *')
  async autoIndexRagData() {
    this.logger.log('Nightly RAG auto-index job started.');

    try {
      const organizations = await this.prisma.organization.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
        },
      });
      let indexedCount = 0;

      for (const organization of organizations) {
        try {
          await Promise.all([
            this.ragService.ingestTasksData(organization.id),
            this.ragService.ingestProjectsData(organization.id),
          ]);
          indexedCount += 1;
        } catch (error) {
          this.logCronError(
            `Nightly RAG auto-index failed for organization ${organization.id}.`,
            error,
          );
        }
      }

      this.logger.log(
        `Nightly RAG auto-index job completed. Indexed ${indexedCount} organizations.`,
      );
    } catch (error) {
      this.logCronError('Nightly RAG auto-index job failed.', error);
    }
  }

  private findTasksDueAround(windowHours: (typeof reminderWindows)[number]) {
    const now = new Date();
    const windowStart = new Date(
      now.getTime() + (windowHours - 1) * hourInMilliseconds,
    );
    const windowEnd = new Date(
      now.getTime() + (windowHours + 1) * hourInMilliseconds,
    );

    return this.prisma.task.findMany({
      where: {
        assigneeId: {
          not: null,
        },
        deadline: {
          gte: windowStart,
          lt: windowEnd,
        },
        status: {
          in: activeTaskStatuses,
        },
      },
      take: 200,
      orderBy: {
        deadline: 'asc',
      },
      select: scheduledTaskSelect,
    });
  }

  private findOverdueTasks() {
    return this.prisma.task.findMany({
      where: {
        assigneeId: {
          not: null,
        },
        deadline: {
          lt: new Date(),
        },
        status: {
          in: activeTaskStatuses,
        },
      },
      take: 200,
      orderBy: {
        deadline: 'asc',
      },
      select: scheduledTaskSelect,
    });
  }

  private findDigestTasks() {
    return this.prisma.task.findMany({
      where: {
        assigneeId: {
          not: null,
        },
        status: {
          in: activeTaskStatuses,
        },
      },
      orderBy: [{ deadline: 'asc' }, { updatedAt: 'desc' }],
      select: scheduledTaskSelect,
    });
  }

  private async generateDigestBriefing(tasks: ScheduledTask[]) {
    const first = tasks[0];
    if (!first) return undefined;
    try {
      const result = await this.ragService.generateAnswer(
        first.organizationId,
        [
          'Write a concise 3-4 sentence daily task briefing.',
          'Highlight overdue work, near deadlines, and the most important next action.',
          'Do not use markdown.',
          JSON.stringify(
            tasks.slice(0, 25).map((task) => ({
              title: task.title,
              status: task.status,
              priority: task.priority,
              deadline: task.deadline?.toISOString(),
              project: task.project?.name,
            })),
          ),
        ].join(' '),
        5,
        'TASK',
      );
      return typeof result.answer === 'string'
        ? result.answer.trim()
        : undefined;
    } catch (error) {
      this.logger.warn(
        `AI daily briefing unavailable for ${first.assigneeId}; using plain digest. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private getActiveOrganizations() {
    return this.prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getOrganizationReviewers(organizationId: string) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        role: { in: ['SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER'] },
      },
      select: { userId: true },
    });
    return memberships.map((item) => item.userId);
  }

  private async hasRecentNotification(
    taskId: string,
    type: NotificationType,
    hours: number,
  ) {
    const createdAt = new Date(Date.now() - hours * hourInMilliseconds);
    return Boolean(
      await this.prisma.notification.findFirst({
        where: {
          type,
          createdAt: { gte: createdAt },
          metadata: { path: ['taskId'], equals: taskId },
        },
        select: { id: true },
      }),
    );
  }

  private async sendDeadlineReminder(
    task: ScheduledTask,
    windowHours: (typeof reminderWindows)[number],
  ) {
    if (!task.assignee || !task.deadline) {
      return false;
    }

    const alreadySent = await this.hasTaskNotification(
      task.assignee.id,
      'TASK_DEADLINE_APPROACHING',
      task.id,
      'reminderWindowHours',
      String(windowHours),
    );

    if (alreadySent) {
      return false;
    }

    await this.notificationsService.createNotification({
      userId: task.assignee.id,
      organizationId: task.organizationId,
      type: 'TASK_DEADLINE_APPROACHING',
      title: 'Task deadline approaching',
      body: `${task.title} is due in about ${windowHours} hours.`,
      metadata: {
        taskId: task.id,
        projectId: task.projectId,
        deadline: task.deadline.toISOString(),
        reminderWindowHours: windowHours,
      },
    });

    if (task.assignee.email) {
      await this.mailService.sendDeadlineReminderEmail({
        to: task.assignee.email,
        taskTitle: task.title,
        taskUrl: this.buildTaskUrl(task.id),
        assigneeName: this.getUserName(task.assignee),
        deadline: task.deadline,
      });
    }

    return true;
  }

  private async sendOverdueAlert(task: ScheduledTask) {
    if (!task.assignee || !task.deadline) {
      return false;
    }

    const alreadySent = await this.hasTaskNotification(
      task.assignee.id,
      'TASK_OVERDUE',
      task.id,
    );

    if (alreadySent) {
      return false;
    }

    await this.notificationsService.createNotification({
      userId: task.assignee.id,
      organizationId: task.organizationId,
      type: 'TASK_OVERDUE',
      title: 'Task overdue',
      body: `${task.title} is overdue.`,
      metadata: {
        taskId: task.id,
        projectId: task.projectId,
        deadline: task.deadline.toISOString(),
      },
    });

    if (task.assignee.email) {
      await this.mailService.sendOverdueTaskEmail({
        to: task.assignee.email,
        taskTitle: task.title,
        taskUrl: this.buildTaskUrl(task.id),
        assigneeName: this.getUserName(task.assignee),
        deadline: task.deadline,
      });
    }

    return true;
  }

  private async hasTaskNotification(
    userId: string,
    type: NotificationType,
    taskId: string,
    metadataKey?: string,
    metadataValue?: string,
  ) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "Notification"
        WHERE "userId" = ${userId}
          AND "type"::text = ${type}
          AND "metadata"->>'taskId' = ${taskId}
          ${
            metadataKey && metadataValue !== undefined
              ? Prisma.sql`AND jsonb_extract_path_text("metadata", ${metadataKey}) = ${metadataValue}`
              : Prisma.empty
          }
      `,
    );

    return Number(rows[0]?.count ?? 0) > 0;
  }

  private groupTasksByAssignee(tasks: ScheduledTask[]) {
    const groupedTasks = new Map<string, ScheduledTask[]>();

    for (const task of tasks) {
      if (!task.assignee?.email) {
        continue;
      }

      const existingTasks = groupedTasks.get(task.assignee.id) ?? [];
      existingTasks.push(task);
      groupedTasks.set(task.assignee.id, existingTasks);
    }

    return groupedTasks;
  }

  private async runTaskHandler(
    task: ScheduledTask,
    handler: () => Promise<boolean>,
    label: string,
  ) {
    try {
      return (await handler()) ? 1 : 0;
    } catch (error) {
      this.logCronError(`Failed to send ${label} for task ${task.id}.`, error);
      return 0;
    }
  }

  private countOverdueTasks(tasks: ScheduledTask[]) {
    return tasks.filter((task) => this.isOverdue(task)).length;
  }

  private countDueSoonTasks(tasks: ScheduledTask[]) {
    const cutoff = new Date(Date.now() + 48 * hourInMilliseconds);

    return tasks.filter(
      (task) =>
        task.deadline !== null &&
        task.deadline >= new Date() &&
        task.deadline <= cutoff,
    ).length;
  }

  private isOverdue(task: ScheduledTask) {
    return task.deadline !== null && task.deadline < new Date();
  }

  private buildTaskUrl(taskId: string) {
    return `${this.getAppUrl()}/tasks/${taskId}`;
  }

  private getAppUrl() {
    return this.configService
      .get('APP_URL', { infer: true })
      .replace(/\/$/, '');
  }

  private getUserName(user: ScheduledTask['assignee']) {
    if (!user) {
      return undefined;
    }

    return user.displayName ?? user.firstName ?? user.email;
  }

  private logCronError(message: string, error: unknown) {
    this.logger.error(
      message,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
