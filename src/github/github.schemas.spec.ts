import {
  pullRequestQuerySchema,
  updateRepositorySettingsSchema,
} from './github.schemas';

describe('GitHub schemas', () => {
  it('accepts bounded review settings', () => {
    expect(
      updateRepositorySettingsSchema.parse({
        aiScoreThreshold: 85,
        maxContextCharacters: 60000,
      }),
    ).toEqual({
      aiScoreThreshold: 85,
      maxContextCharacters: 60000,
    });
  });

  it('rejects invalid score thresholds and empty updates', () => {
    expect(() =>
      updateRepositorySettingsSchema.parse({ aiScoreThreshold: 101 }),
    ).toThrow();
    expect(() => updateRepositorySettingsSchema.parse({})).toThrow();
  });

  it('applies safe pull request pagination defaults', () => {
    expect(pullRequestQuerySchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
    });
  });
});
