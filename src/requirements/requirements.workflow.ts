import type { RequirementStatus } from '@prisma/client';

export const REQUIREMENT_TRANSITIONS: Record<
  RequirementStatus,
  readonly RequirementStatus[]
> = {
  DRAFT: ['SUBMITTED', 'DEPRECATED'],
  SUBMITTED: ['UNDER_REVIEW', 'DEPRECATED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'DEPRECATED'],
  APPROVED: ['IMPLEMENTED', 'DEPRECATED'],
  REJECTED: ['SUBMITTED', 'DEPRECATED'],
  IMPLEMENTED: ['DEPRECATED'],
  DEPRECATED: [],
};

export function canTransitionRequirement(
  from: RequirementStatus,
  to: RequirementStatus,
) {
  return REQUIREMENT_TRANSITIONS[from].includes(to);
}
