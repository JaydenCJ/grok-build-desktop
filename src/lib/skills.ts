// Grok skills hub.
//
// A skill is a folder with a SKILL.md (frontmatter `name` + `description`, then
// instructions). grok-build discovers skills from ~/.grok/skills and
// ~/.claude/skills and can invoke them by name. This module ships a curated
// catalog of high-value coding skills the user can install with one click —
// install just writes the SKILL.md; grok picks it up on its next run.
import { invoke } from '@tauri-apps/api/core';

function hasTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface SkillCatalogEntry {
  slug: string;
  name: string;
  category: 'review' | 'write' | 'understand' | 'git';
  description: string;
  /** Full SKILL.md contents (frontmatter + body). */
  body: string;
}

function skill(
  slug: string,
  name: string,
  category: SkillCatalogEntry['category'],
  description: string,
  instructions: string,
): SkillCatalogEntry {
  const body = `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${name}\n\n${instructions.trim()}\n`;
  return { slug, name, category, description, body };
}

// Curated, self-contained coding skills. Each is genuinely useful on its own
// and assumes no external setup beyond a git repo.
export const SKILL_CATALOG: SkillCatalogEntry[] = [
  skill(
    'code-review',
    'Code review',
    'review',
    'Review the current diff for bugs, security, and missing tests.',
    `Review the staged/working changes (run \`git diff\` if no diff is given). Lead with real bugs and regressions, then security and missing tests, then maintainability.
- Cite exact file:line for each finding.
- Give a concrete fix (a diff or precise change), not vague advice.
- Skip style nits unless they hide a bug.
- End with a one-line verdict: safe to merge, or the blocking issues.`,
  ),
  skill(
    'write-tests',
    'Write tests',
    'write',
    'Write focused, failing-first tests for a target file or function.',
    `For the given file/function: identify the behaviour worth pinning, then write tight tests using the repo's existing test framework and conventions (detect them first — do not introduce a new one).
- One behaviour per test; clear names.
- Cover the happy path plus the edge cases that actually break.
- Give the exact command to run just these tests.`,
  ),
  skill(
    'explain-codebase',
    'Explain codebase',
    'understand',
    'A tight architecture tour so you can start contributing fast.',
    `Map this repository for a new contributor:
1. Entry point(s) and how the app boots.
2. The 4-6 modules that matter and what each owns.
3. Build, run, and test commands.
4. One non-obvious gotcha.
Be concrete with real file paths. No filler.`,
  ),
  skill(
    'debug-rootcause',
    'Debug root cause',
    'understand',
    'Find the root cause of a bug: evidence, hypothesis, fix, verification.',
    `Debug the reported problem methodically:
1. Evidence — what is observed, with the exact error/log/repro.
2. Hypothesis — the most likely cause, and why.
3. Root cause — confirm by reading the relevant code, not guessing.
4. Fix — the minimal safe change (show the diff).
5. Verification — the exact command that proves it's fixed.`,
  ),
  skill(
    'commit-message',
    'Commit message',
    'git',
    'Write a clean Conventional Commit from the staged diff.',
    `From the staged changes (\`git diff --cached\`), write one Conventional Commit:
- A \`type(scope): subject\` line, imperative, under 72 chars.
- A short body explaining the *why* when it isn't obvious.
- No marketing language; describe what actually changed.
Output only the commit message, ready to paste.`,
  ),
  skill(
    'pr-description',
    'PR description',
    'git',
    'Draft a PR title and description from the branch diff.',
    `From the branch's changes vs its base, draft a pull request:
- A clear title (imperative, scoped).
- "What changed" (bullets, by area).
- "Why" (the motivation/issue).
- "How to verify" (exact commands or steps).
- Risks / follow-ups, if any.
Keep it factual and skimmable.`,
  ),
];

export async function listInstalledSkills(): Promise<string[]> {
  if (!hasTauri()) return [];
  try {
    return await invoke<string[]>('list_grok_skills');
  } catch {
    return [];
  }
}

export async function installSkill(entry: SkillCatalogEntry): Promise<void> {
  await invoke('install_grok_skill', { slug: entry.slug, body: entry.body });
}

export async function removeSkill(slug: string): Promise<void> {
  await invoke('remove_grok_skill', { slug });
}
