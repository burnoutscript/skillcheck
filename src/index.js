import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { splitFrontmatter, parseFrontmatter } from './frontmatter.js';
import { RULES, PACK_RULES, ALL_RULES, estimateTokens } from './rules.js';

export { ALL_RULES, estimateTokens };

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.venv', 'venv', '__pycache__']);
const PENALTY = { error: 15, warn: 6, info: 2 };
const INFO_CAP = 10;
// A skill that can't load or leaks a credential is broken, whatever else is right.
const FATAL_CAP = 30;

export function findSkillFiles(paths) {
  const out = new Set();
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.name === 'SKILL.md') {
        out.add(join(dir, entry.name));
      }
    }
  };
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) throw new Error(`Path not found: ${p}`);
    if (statSync(abs).isDirectory()) walk(abs);
    else out.add(abs);
  }
  return [...out].sort();
}

export function loadSkill(file, root = process.cwd()) {
  const text = readFileSync(file, 'utf8');
  const { raw, body, bodyOffset } = splitFrontmatter(text);
  const { data, errors } = raw === null ? { data: {}, errors: [] } : parseFrontmatter(raw);
  const fmLines = raw === null ? [] : raw.split(/\r?\n/);
  const dir = dirname(file);
  return {
    file,
    rel: relative(root, file).replace(/\\/g, '/') || basename(file),
    dir,
    dirName: basename(dir),
    text,
    raw,
    data,
    fmErrors: errors,
    body,
    bodyOffset,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    keyLine(key) {
      const i = fmLines.findIndex(l => l.startsWith(`${key}:`));
      return i === -1 ? 1 : i + 2;
    },
  };
}

export function scoreFindings(findings) {
  let infoPenalty = 0;
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'info') infoPenalty += PENALTY.info;
    else score -= PENALTY[f.severity];
  }
  score = Math.max(0, score - Math.min(infoPenalty, INFO_CAP));
  return findings.some(f => f.fatal) ? Math.min(score, FATAL_CAP) : score;
}

export function grade(score) {
  if (score >= 97) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function lint(paths, { ignore = [], root = process.cwd() } = {}) {
  const skip = new Set(ignore);
  const files = findSkillFiles(paths);
  const skills = files.map(f => loadSkill(f, root));
  const byFile = new Map(skills.map(s => [s.file, []]));

  for (const s of skills) {
    for (const rule of RULES) {
      if (skip.has(rule.id)) continue;
      for (const f of rule.check(s) ?? []) byFile.get(s.file).push(f);
    }
  }
  for (const rule of PACK_RULES) {
    if (skip.has(rule.id)) continue;
    for (const f of rule.check(skills) ?? []) {
      const { skill, ...rest } = f;
      byFile.get(skill.file).push(rest);
    }
  }

  const results = skills.map(s => {
    const findings = byFile.get(s.file).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const score = scoreFindings(findings);
    return {
      file: s.rel,
      name: s.data.name ?? null,
      tokens: { description: estimateTokens(s.description), body: estimateTokens(s.body) },
      score,
      grade: grade(score),
      findings,
    };
  });

  const count = sev => results.reduce((n, r) => n + r.findings.filter(f => f.severity === sev).length, 0);
  const score = results.length ? Math.round(results.reduce((n, r) => n + r.score, 0) / results.length) : 0;

  return {
    score,
    grade: grade(score),
    skills: results.length,
    errors: count('error'),
    warnings: count('warn'),
    infos: count('info'),
    // Descriptions are always in context; bodies only load when triggered.
    alwaysOnTokens: results.reduce((n, r) => n + r.tokens.description, 0),
    results,
  };
}
