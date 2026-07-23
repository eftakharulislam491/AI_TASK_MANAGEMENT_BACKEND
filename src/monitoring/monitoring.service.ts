import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RedisService } from '../common/services/redis.service';
import { serializeResponse } from '../common/utils/response';
import { PrismaService } from '../prisma/prisma.service';
import { calculateRiskScore, isBlockedTask } from './monitoring.calculations';

const taskSelect = {
  id: true,
  projectId: true,
  title: true,
  status: true,
  priority: true,
  assigneeId: true,
  deadline: true,
  estimatedHours: true,
  tags: true,
  aiMetadata: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

type MonitoringTask = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getDashboardMetrics(user: JwtUser) {
    const organizationId = this.assertMonitoringAccess(user);
    const cacheKey = `monitoring:dashboard:${organizationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return serializeResponse(JSON.parse(cached) as unknown);
      } catch {
        await this.redis.delete(cacheKey);
      }
    }

    const [tasks, workload, projects, pendingReassignments] = await Promise.all(
      [
        this.getTasks(organizationId),
        this.getWorkloadForOrganization(organizationId),
        this.getProjectRisksForOrganization(organizationId),
        this.prisma.taskReassignmentRequest.count({
          where: { organizationId, status: 'PENDING' },
        }),
      ],
    );
    const now = new Date();
    const activeTasks = tasks.filter(
      (task) => task.status !== 'DONE' && task.status !== 'CANCELLED',
    );
    const data = {
      metrics: {
        activeTasks: activeTasks.length,
        overdueTasks: activeTasks.filter(
          (task) => task.deadline && task.deadline < now,
        ).length,
        blockedTasks: activeTasks.filter(isBlockedTask).length,
        highRiskProjects: projects.filter((project) => project.score >= 70)
          .length,
        averageWorkload: average(workload.map((item) => item.workload)),
        pendingReassignments,
      },
      workload,
      projects,
      suggestions: this.buildSuggestions(tasks, workload, projects),
      generatedAt: now.toISOString(),
    };
    await this.redis.set(cacheKey, data, 300);
    return serializeResponse(data);
  }

  async getWorkloadBreakdown(user: JwtUser) {
    const organizationId = this.assertMonitoringAccess(user);
    return serializeResponse(
      await this.getWorkloadForOrganization(organizationId),
    );
  }

  async calculateProjectRisk(user: JwtUser, projectId: string) {
    const organizationId = this.assertMonitoringAccess(user);
    const project = (
      await this.getProjectRisksForOrganization(organizationId, projectId)
    )[0];
    if (!project) {
      throw new NotFoundException('Project is unavailable in this workspace.');
    }
    return serializeResponse(project);
  }

  async getProjectRisks(user: JwtUser) {
    return serializeResponse(
      await this.getProjectRisksForOrganization(
        this.assertMonitoringAccess(user),
      ),
    );
  }

  async getWorkloadForOrganization(organizationId: string) {
    const members = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        role: { in: ['MEMBER', 'TEAM_LEADER'] },
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            tasksAssigned: {
              where: {
                organizationId,
                status: { notIn: ['DONE', 'CANCELLED'] },
              },
              select: {
                id: true,
                estimatedHours: true,
                deadline: true,
                status: true,
              },
            },
          },
        },
      },
    });

    return members
      .map(({ user, role }) => {
        const activeHours = user.tasksAssigned.reduce(
          (sum, task) => sum + (task.estimatedHours ?? 5),
          0,
        );
        const workload = Math.min(100, Math.round((activeHours / 40) * 100));
        return {
          user: {
            id: user.id,
            name:
              user.displayName ||
              `${user.firstName} ${user.lastName}`.trim() ||
              user.email,
            email: user.email,
            role,
          },
          activeTasks: user.tasksAssigned.length,
          activeHours: Math.round(activeHours * 10) / 10,
          workload,
          level: workload >= 80 ? 'HIGH' : workload >= 50 ? 'MEDIUM' : 'LOW',
        };
      })
      .sort((left, right) => right.workload - left.workload);
  }

  async getProjectRisksForOrganization(
    organizationId: string,
    projectId?: string,
  ) {
    const projects = await this.prisma.project.findMany({
      where: {
        organizationId,
        status: { not: 'ARCHIVED' },
        ...(projectId ? { id: projectId } : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        endDate: true,
        tasks: { select: taskSelect },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return projects
      .map((project) => {
        const risk = calculateRiskScore(project.tasks);
        return {
          id: project.id,
          name: project.name,
          status: project.status,
          endDate: project.endDate,
          taskCount: project.tasks.length,
          ...risk,
        };
      })
      .sort((left, right) => right.score - left.score);
  }

  async getBlockedTasksForOrganization(organizationId: string) {
    return (await this.getTasks(organizationId)).filter(
      (task) =>
        task.status !== 'DONE' &&
        task.status !== 'CANCELLED' &&
        isBlockedTask(task),
    );
  }

  private getTasks(organizationId: string) {
    return this.prisma.task.findMany({
      where: { organizationId },
      select: taskSelect,
    });
  }

  private buildSuggestions(
    tasks: MonitoringTask[],
    workload: Awaited<
      ReturnType<MonitoringService['getWorkloadForOrganization']>
    >,
    projects: Awaited<
      ReturnType<MonitoringService['getProjectRisksForOrganization']>
    >,
  ) {
    const suggestions: Array<{
      type: string;
      severity: 'HIGH' | 'MEDIUM';
      title: string;
      detail: string;
      entityId?: string;
    }> = [];
    projects
      .filter((project) => project.score >= 40)
      .slice(0, 3)
      .forEach((project) =>
        suggestions.push({
          type: 'PROJECT_RISK',
          severity: project.score >= 70 ? 'HIGH' : 'MEDIUM',
          title: `${project.name} needs attention`,
          detail: `Risk score is ${project.score}/100. Review overdue, blocked, and near-deadline work.`,
          entityId: project.id,
        }),
      );
    workload
      .filter((item) => item.workload >= 80)
      .slice(0, 3)
      .forEach((item) =>
        suggestions.push({
          type: 'WORKLOAD',
          severity: 'HIGH',
          title: `${item.user.name} is near capacity`,
          detail: `${item.workload}% workload across ${item.activeTasks} active tasks. Consider reassignment.`,
          entityId: item.user.id,
        }),
      );
    const overdue = tasks.filter(
      (task) =>
        task.deadline &&
        task.deadline < new Date() &&
        task.status !== 'DONE' &&
        task.status !== 'CANCELLED',
    ).length;
    if (overdue > 0) {
      suggestions.push({
        type: 'OVERDUE',
        severity: overdue >= 5 ? 'HIGH' : 'MEDIUM',
        title: `${overdue} overdue task${overdue === 1 ? '' : 's'}`,
        detail: 'Prioritize overdue work or adjust ownership and deadlines.',
      });
    }
    return suggestions.slice(0, 8);
  }

  private assertMonitoringAccess(user: JwtUser) {
    if (!user.currentOrganizationId) {
      throw new ForbiddenException('Organization context is required.');
    }
    const role = this.roleFor(user, user.currentOrganizationId);
    if (!['MANAGER', 'TEAM_LEADER'].includes(role || '')) {
      throw new ForbiddenException(
        'Monitoring access is restricted to managers and team leaders.',
      );
    }
    return user.currentOrganizationId;
  }

  private roleFor(user: JwtUser, organizationId: string): Role | undefined {
    if (user.role === 'SUPER_ADMIN') return 'SUPER_ADMIN';
    return user.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === 'ACTIVE',
    )?.role;
  }
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}
