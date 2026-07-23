import type { TaskStatus } from '@prisma/client';

export type MonitorableTask = {
  status: TaskStatus;
  deadline: Date | null;
  estimatedHours: number | null;
  tags: string[];
  aiMetadata: unknown;
  assigneeId: string | null;
};

export function isBlockedTask(
  task: Pick<MonitorableTask, 'tags' | 'aiMetadata'>,
) {
  const tagged = task.tags.some((tag) => tag.toLowerCase() === 'blocked');
  const metadata =
    task.aiMetadata &&
    typeof task.aiMetadata === 'object' &&
    !Array.isArray(task.aiMetadata)
      ? (task.aiMetadata as Record<string, unknown>)
      : {};
  return tagged || metadata.blocked === true;
}

export function calculateRiskScore(tasks: MonitorableTask[], now = new Date()) {
  const active = tasks.filter(
    (task) => task.status !== 'DONE' && task.status !== 'CANCELLED',
  );
  if (active.length === 0) {
    return {
      score: 0,
      level: 'LOW' as const,
      factors: {
        overdueRatio: 0,
        blockedRatio: 0,
        deadlinePressure: 0,
        workloadVariance: 0,
      },
    };
  }

  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const overdueRatio =
    active.filter((task) => task.deadline && task.deadline < now).length /
    active.length;
  const blockedRatio =
    active.filter((task) => isBlockedTask(task)).length / active.length;
  const deadlinePressure =
    active.filter(
      (task) => task.deadline && task.deadline >= now && task.deadline <= soon,
    ).length / active.length;
  const workloadByUser = new Map<string, number>();
  active.forEach((task) => {
    if (!task.assigneeId) return;
    workloadByUser.set(
      task.assigneeId,
      (workloadByUser.get(task.assigneeId) || 0) + (task.estimatedHours ?? 5),
    );
  });
  const loads = [...workloadByUser.values()];
  const mean = loads.length
    ? loads.reduce((sum, value) => sum + value, 0) / loads.length
    : 0;
  const variance =
    loads.length && mean
      ? loads.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        loads.length
      : 0;
  const workloadVariance = mean ? Math.min(1, Math.sqrt(variance) / mean) : 0;
  const score = Math.round(
    (overdueRatio * 0.3 +
      blockedRatio * 0.25 +
      deadlinePressure * 0.25 +
      workloadVariance * 0.2) *
      100,
  );

  return {
    score,
    level:
      score >= 70
        ? ('HIGH' as const)
        : score >= 40
          ? ('MEDIUM' as const)
          : ('LOW' as const),
    factors: {
      overdueRatio: percent(overdueRatio),
      blockedRatio: percent(blockedRatio),
      deadlinePressure: percent(deadlinePressure),
      workloadVariance: percent(workloadVariance),
    },
  };
}

function percent(value: number) {
  return Math.round(value * 100);
}
