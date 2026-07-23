export function normalizeGitHubOrganizationSettings(settings: unknown) {
  const value =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};

  return {
    githubIntegrationEnabled: value.githubIntegrationEnabled !== false,
    githubAutoReviewEnabled: value.githubAutoReviewEnabled === true,
  };
}
