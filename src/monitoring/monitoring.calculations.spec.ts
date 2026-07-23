import { calculateRiskScore, isBlockedTask } from './monitoring.calculations';

describe('monitoring calculations', () => {
  it('detects explicit blocked signals', () => {
    expect(isBlockedTask({ tags: ['blocked'], aiMetadata: null })).toBe(true);
    expect(isBlockedTask({ tags: [], aiMetadata: { blocked: true } })).toBe(
      true,
    );
  });

  it('returns a high risk score when all weighted factors are elevated', () => {
    const now = new Date('2026-07-24T00:00:00.000Z');
    const result = calculateRiskScore(
      [
        {
          status: 'IN_PROGRESS',
          deadline: new Date('2026-07-23T00:00:00.000Z'),
          estimatedHours: 40,
          tags: ['blocked'],
          aiMetadata: null,
          assigneeId: 'one',
        },
        {
          status: 'TODO',
          deadline: new Date('2026-07-25T00:00:00.000Z'),
          estimatedHours: 2,
          tags: ['blocked'],
          aiMetadata: null,
          assigneeId: 'two',
        },
      ],
      now,
    );

    expect(result.level).toBe('HIGH');
    expect(result.factors.blockedRatio).toBe(100);
  });
});
