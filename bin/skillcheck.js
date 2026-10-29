#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { lint, ALL_RULES } from '../src/index.js';
import { pretty, json, markdown, github } from '../src/report.js';
import { badgeSvg, badgeUrl } from '../src/badge.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `skillcheck ${VERSION}: lint and score Agent Skills (SKILL.md)

Usage
  npx skillcheck [paths...]            defaults to the current directory

Options
  -f, --format <pretty|json|markdown|github>   output format (default: pretty)
      --min-score <n>      exit 1 if the overall score is below n
      --strict             exit 1 on warnings too, not just errors
      --ignore <ids>       comma-separated rule ids to skip
      --badge <file.svg>   write a score badge SVG
      --badge-url          print a shields.io badge URL for your README
  -q, --quiet              only show errors
      --rules              list every rule
  -v, --version
  -h, --help

Config
  A .skillcheckrc.json in the working directory may set
  { "ignore": [...], "minScore": 80, "strict": false }

Examples
  npx skillcheck .claude/skills
  npx skillcheck skills --min-score 90 --badge skillcheck.svg
  npx skillcheck --format github     # inline PR annotations in Actions
`;

function parseArgs(argv) {
  const opts = { paths: [], format: 'pretty', ignore: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      case '-f': case '--format': opts.format = next(); break;
      case '--min-score': opts.minScore = Number(next()); break;
      case '--strict': opts.strict = true; break;
      case '--ignore': opts.ignore.push(...next().split(',').map(s => s.trim()).filter(Boolean)); break;
      case '--badge': opts.badge = next(); break;
      case '--badge-url': opts.badgeUrl = true; break;
      case '-q': case '--quiet': opts.quiet = true; break;
      case '--rules': opts.rules = true; break;
      default:
        if (a.startsWith('-')) fail(`Unknown option ${a}\nRun skillcheck --help`);
        opts.paths.push(a);
    }
  }
  return opts;
}

function fail(msg) {
  process.stderr.write(`skillcheck: ${msg}\n`);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
if (opts.rules) {
  for (const r of ALL_RULES) process.stdout.write(`${r.severity.padEnd(5)}  ${r.id.padEnd(26)} ${r.summary}\n`);
  process.exit(0);
}

if (existsSync('.skillcheckrc.json')) {
  try {
    const rc = JSON.parse(readFileSync('.skillcheckrc.json', 'utf8'));
    opts.ignore.push(...(rc.ignore ?? []));
    opts.minScore ??= rc.minScore;
    opts.strict ??= rc.strict;
  } catch (e) {
    fail(`Invalid .skillcheckrc.json: ${e.message}`);
  }
}

const formats = { pretty, json, markdown, github };
if (!formats[opts.format]) fail(`Unknown format "${opts.format}". Use pretty, json, markdown or github`);
if (opts.minScore !== undefined && Number.isNaN(opts.minScore)) fail('--min-score must be a number');

let report;
try {
  report = lint(opts.paths.length ? opts.paths : ['.'], { ignore: opts.ignore });
} catch (e) {
  fail(e.message);
}

process.stdout.write(formats[opts.format](report, { quiet: opts.quiet }));

if (opts.badge) writeFileSync(opts.badge, badgeSvg(report.score));
if (opts.badgeUrl) process.stdout.write(`![skillcheck](${badgeUrl(report.score)})\n`);

const failed =
  report.skills === 0 ||
  report.errors > 0 ||
  (opts.strict && report.warnings > 0) ||
  (opts.minScore !== undefined && report.score < opts.minScore);
process.exit(failed ? 1 : 0);
