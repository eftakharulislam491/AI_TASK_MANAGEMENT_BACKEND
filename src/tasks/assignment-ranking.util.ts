import type { Role } from '@prisma/client';

export type AssignmentCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: Role;
  profile: {
    currentJobTitle: string | null;
    yearsOfExperience: number | null;
  } | null;
  abilities: Array<{ name: string; keywords: string[] }>;
  tasksAssigned: Array<{ estimatedHours: number | null }>;
};

export type RankedCandidate = {
  candidate: AssignmentCandidate;
  score: number;
  workload: number;
  matchedSkills: string[];
};

export function rankAssignmentCandidates(
  requiredSkills: string[],
  candidates: AssignmentCandidate[],
): RankedCandidate[] {
  const required = requiredSkills.map((item) => item.toLowerCase());

  return candidates
    .map((candidate) => {
      const abilityTokens = candidate.abilities.flatMap((ability) => [
        ability.name,
        ...ability.keywords,
      ]);
      const normalizedTokens = abilityTokens.map((item) => item.toLowerCase());
      const matchedSkills = requiredSkills.filter((_, index) =>
        normalizedTokens.some((token) => token.includes(required[index])),
      );
      const activeHours = candidate.tasksAssigned.reduce(
        (sum, task) => sum + (task.estimatedHours ?? 5),
        0,
      );
      const workload = Math.min(100, Math.round((activeHours / 40) * 100));
      const skillScore = required.length
        ? Math.round((matchedSkills.length / required.length) * 100)
        : 60;
      const experienceScore = Math.min(
        100,
        (candidate.profile?.yearsOfExperience ?? 0) * 12,
      );

      return {
        candidate,
        workload,
        matchedSkills,
        score: Math.round(
          skillScore * 0.45 + (100 - workload) * 0.35 + experienceScore * 0.2,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.workload - right.workload ||
        right.matchedSkills.length - left.matchedSkills.length,
    );
}

export function mapAiAssignmentSuggestions(
  result: unknown,
  ranked: RankedCandidate[],
) {
  const value = result as { suggestions?: unknown };
  const raw = Array.isArray(result)
    ? result
    : Array.isArray(value?.suggestions)
      ? value.suggestions
      : [];
  const candidatesById = new Map(
    ranked.map((item) => [item.candidate.id, item]),
  );

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const item = entry as Record<string, unknown>;
      const userId = typeof item.userId === 'string' ? item.userId : '';
      const rankedCandidate = candidatesById.get(userId);
      if (!rankedCandidate) return null;
      const score = Number(item.score);
      const safeScore = Number.isFinite(score)
        ? Math.max(0, Math.min(100, Math.round(score)))
        : rankedCandidate.score;
      const reason =
        typeof item.reason === 'string' && item.reason.trim()
          ? item.reason.trim()
          : fallbackAssignmentReason(rankedCandidate);

      return mapRankedCandidate(rankedCandidate, safeScore, reason);
    })
    .filter((item) => item !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

export function mapRankedCandidate(
  item: RankedCandidate,
  score = item.score,
  reason = fallbackAssignmentReason(item),
) {
  const candidate = item.candidate;
  const name =
    candidate.displayName ??
    `${candidate.firstName} ${candidate.lastName}`.trim();

  return {
    user: {
      id: candidate.id,
      name,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      displayName: candidate.displayName,
      role: candidate.role,
      title: candidate.profile?.currentJobTitle ?? '',
      skills: candidate.abilities.map((ability) => ability.name),
      experience: candidate.profile?.yearsOfExperience ?? 0,
      capacity: item.workload,
    },
    score,
    matchedSkills: item.matchedSkills,
    reason,
  };
}

export function fallbackAssignmentReason(item: RankedCandidate) {
  return item.matchedSkills.length
    ? `Matches ${item.matchedSkills.length} required skill${
        item.matchedSkills.length === 1 ? '' : 's'
      } with ${100 - item.workload}% availability.`
    : `Has ${100 - item.workload}% availability for assignment review.`;
}
