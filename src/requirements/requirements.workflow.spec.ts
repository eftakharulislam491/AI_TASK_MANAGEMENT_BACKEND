import { canTransitionRequirement } from './requirements.workflow';

describe('requirement workflow', () => {
  it('supports the complete approval and delivery path', () => {
    expect(canTransitionRequirement('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionRequirement('SUBMITTED', 'UNDER_REVIEW')).toBe(true);
    expect(canTransitionRequirement('UNDER_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionRequirement('APPROVED', 'IMPLEMENTED')).toBe(true);
  });

  it('supports rejection and resubmission', () => {
    expect(canTransitionRequirement('UNDER_REVIEW', 'REJECTED')).toBe(true);
    expect(canTransitionRequirement('REJECTED', 'SUBMITTED')).toBe(true);
  });

  it('rejects skipped and terminal transitions', () => {
    expect(canTransitionRequirement('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransitionRequirement('SUBMITTED', 'IMPLEMENTED')).toBe(false);
    expect(canTransitionRequirement('DEPRECATED', 'DRAFT')).toBe(false);
  });
});
