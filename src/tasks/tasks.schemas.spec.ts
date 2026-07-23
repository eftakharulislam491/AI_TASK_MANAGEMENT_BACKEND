import {
  createReassignmentRequestSchema,
  reviewReassignmentRequestSchema,
} from './tasks.schemas';

describe('task reassignment schemas', () => {
  it('requires a meaningful reassignment reason', () => {
    expect(() =>
      createReassignmentRequestSchema.parse({ reason: 'Too short' }),
    ).toThrow();
    expect(
      createReassignmentRequestSchema.parse({
        reason: 'Current workload prevents timely delivery.',
      }).reason,
    ).toContain('workload');
  });

  it('accepts only final review decisions', () => {
    expect(
      reviewReassignmentRequestSchema.parse({ decision: 'APPROVED' }).decision,
    ).toBe('APPROVED');
    expect(() =>
      reviewReassignmentRequestSchema.parse({ decision: 'PENDING' }),
    ).toThrow();
  });
});
