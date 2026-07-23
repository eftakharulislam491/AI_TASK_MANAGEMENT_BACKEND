import { planGitHubReviewContext } from './github-context-planner';

describe('planGitHubReviewContext', () => {
  it('prioritizes sensitive source files and respects the total budget', () => {
    const result = planGitHubReviewContext(
      [
        {
          filename: 'docs/readme.md',
          status: 'modified',
          additions: 20,
          deletions: 0,
          changes: 20,
          patch: 'x'.repeat(3000),
        },
        {
          filename: 'src/auth.guard.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
          changes: 12,
          patch: 'x'.repeat(3000),
        },
      ],
      6000,
    );

    const auth = result.find((file) => file.filename.includes('auth'));
    const docs = result.find((file) => file.filename.includes('readme'));
    expect(auth?.contextBudget).toBe(6000);
    expect(docs?.isReviewable).toBe(false);
    expect(
      result.reduce((sum, file) => sum + file.contextBudget, 0),
    ).toBeLessThanOrEqual(6000);
  });

  it('skips binary and generated lock files', () => {
    const result = planGitHubReviewContext(
      [
        {
          filename: 'public/logo.png',
          status: 'added',
          additions: 0,
          deletions: 0,
          changes: 0,
        },
        {
          filename: 'package-lock.json',
          status: 'modified',
          additions: 20,
          deletions: 10,
          changes: 30,
          patch: 'diff',
        },
      ],
      10000,
    );
    expect(result.every((file) => !file.isReviewable)).toBe(true);
  });
});
