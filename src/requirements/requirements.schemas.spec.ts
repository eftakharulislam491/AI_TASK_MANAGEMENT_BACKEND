import {
  createRequirementSchema,
  requirementQuerySchema,
  updateRequirementSchema,
} from './requirements.schemas';

describe('requirements schemas', () => {
  it('applies safe defaults when creating a requirement', () => {
    const result = createRequirementSchema.parse({ title: 'Client portal' });
    expect(result.type).toBe('GENERAL');
    expect(result.priority).toBe('MEDIUM');
  });

  it('rejects an update without requirement fields', () => {
    expect(() =>
      updateRequirementSchema.parse({ changeSummary: 'Nothing changed' }),
    ).toThrow();
  });

  it('coerces pagination and validates filters', () => {
    const result = requirementQuerySchema.parse({
      page: '2',
      limit: '50',
      status: 'UNDER_REVIEW',
    });
    expect(result).toMatchObject({
      page: 2,
      limit: 50,
      status: 'UNDER_REVIEW',
    });
  });
});
