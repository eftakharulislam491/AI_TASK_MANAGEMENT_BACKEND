export type GitHubChangedFile = {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type PlannedGitHubFile = GitHubChangedFile & {
  language: string | null;
  isBinary: boolean;
  isReviewable: boolean;
  contextBudget: number;
  skipReason?: string;
};

const LOCK_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'poetry.lock',
  'cargo.lock',
]);
const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'pdf',
  'zip',
  'gz',
  'mp4',
  'mov',
  'woff',
  'woff2',
  'ttf',
]);
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript React',
  js: 'JavaScript',
  jsx: 'JavaScript React',
  py: 'Python',
  java: 'Java',
  go: 'Go',
  rs: 'Rust',
  php: 'PHP',
  rb: 'Ruby',
  cs: 'C#',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  sql: 'SQL',
  sh: 'Shell',
  md: 'Markdown',
};

export function planGitHubReviewContext(
  files: GitHubChangedFile[],
  maxCharacters: number,
): PlannedGitHubFile[] {
  const normalized = files.map((file) => {
    const baseName = file.filename.split('/').pop()?.toLowerCase() || '';
    const extension = baseName.includes('.')
      ? baseName.split('.').pop() || ''
      : '';
    const isBinary = BINARY_EXTENSIONS.has(extension);
    const isLockFile = LOCK_FILES.has(baseName);
    const hasPatch = typeof file.patch === 'string' && file.patch.length > 0;
    const isReviewable = !isBinary && !isLockFile && hasPatch;
    return {
      ...file,
      language: LANGUAGE_BY_EXTENSION[extension] || null,
      isBinary,
      isReviewable,
      contextBudget: 0,
      skipReason: isBinary
        ? 'Binary file'
        : isLockFile
          ? 'Generated lock file'
          : !hasPatch
            ? 'Diff is unavailable or too large'
            : undefined,
    };
  });

  const reviewable = normalized
    .filter((file) => file.isReviewable)
    .sort((left, right) => filePriority(right) - filePriority(left));
  let remaining = Math.max(0, maxCharacters);

  for (const file of reviewable) {
    if (remaining <= 0) {
      file.isReviewable = false;
      file.skipReason = 'Organization context budget reached';
      continue;
    }
    const requested = Math.min(
      16000,
      Math.max(3000, (file.patch?.length || 0) * 2),
    );
    file.contextBudget = Math.min(requested, remaining);
    remaining -= file.contextBudget;
  }

  return normalized;
}

function filePriority(file: GitHubChangedFile) {
  const path = file.filename.toLowerCase();
  const sensitive =
    /(auth|security|payment|permission|guard|crypto|secret)/.test(path)
      ? 10000
      : 0;
  const source = /\.(ts|tsx|js|jsx|py|java|go|rs|php|rb|cs|sql)$/.test(path)
    ? 5000
    : 0;
  return sensitive + source + Math.min(file.changes, 4000);
}
