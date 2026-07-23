import {
  fallbackAssignmentReason,
  rankAssignmentCandidates,
  type AssignmentCandidate,
} from './assignment-ranking.util';

describe('assignment ranking', () => {
  it('prefers skill fit and available capacity', () => {
    const ranked = rankAssignmentCandidates(
      ['NestJS'],
      [
        candidate('busy', ['NestJS'], 40),
        candidate('available', ['NestJS'], 5),
        candidate('unmatched', ['Figma'], 0),
      ],
    );

    expect(ranked[0].candidate.id).toBe('available');
    expect(ranked[0].matchedSkills).toEqual(['NestJS']);
    expect(fallbackAssignmentReason(ranked[0])).toContain('availability');
  });
});

function candidate(
  id: string,
  skills: string[],
  activeHours: number,
): AssignmentCandidate {
  return {
    id,
    firstName: id,
    lastName: 'User',
    displayName: null,
    role: 'MEMBER',
    profile: { currentJobTitle: null, yearsOfExperience: 2 },
    abilities: skills.map((name) => ({ name, keywords: [] })),
    tasksAssigned: [{ estimatedHours: activeHours }],
  };
}
