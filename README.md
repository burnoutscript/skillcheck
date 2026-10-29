# skillcheck

**ESLint for Agent Skills.** Lint, score and badge your `SKILL.md` files for Claude Code, Cursor, Codex, OpenCode and any agent that speaks the [Agent Skills](https://agentskills.io) format.

[![CI](https://github.com/burnoutscript/skillcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/burnoutscript/skillcheck/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/skillcheck)](https://www.npmjs.com/package/skillcheck)
![zero dependencies](https://img.shields.io/badge/dependencies-0-2ea043)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```bash
npx skillcheck .claude/skills
```

```
F   21  skills/Bad_Name/SKILL.md  ~26 tok
     ✖ error L2    Name "Bad_Name" must be kebab-case (a-z, 0-9, single hyphens)       name/format
     ▲ warn  L3    Description says what the skill is but not when to use it.           description/no-trigger
     ▲ warn  L3    Description uses first or second person. Write it in third person    description/person
     ✖ error L7    Broken link: docs/guide.md                                           links/broken
     ▲ warn  L8    Machine-specific path "C:\Users\alice\config.json"                   paths/absolute

A+ 100  skills/pdf-forms/SKILL.md  ~128 tok

  skillcheck  ████████████░░░░░░░░  61/100 D
  2 skills · 3 errors · 5 warnings · 2 info · ~59 tokens always in context
```

## Why

A skill that never triggers is dead code you can't see. Agents pick skills **only by their description**, and nothing tells you when yours is too vague, collides with another skill, links to a file that doesn't exist, or quietly burns 8,000 tokens every time it loads.

skillcheck catches those before your users do:

- **Trigger quality:** missing "Use when...", too short, vague words, first-person phrasing.
- **Trigger collisions:** two skills claiming the same phrase, or descriptions so similar the agent will pick the wrong one. No other linter checks this, and it's the most common bug in big skill packs.
- **Context cost:** body size, token estimates, and the always-on cost of every description in your pack.
- **Broken references:** dead relative links, backslash paths, references only reachable through other references.
- **Spec compliance:** name format, reserved words, length limits, unknown frontmatter keys.
- **Safety:** hardcoded API keys and tokens, machine-specific absolute paths.

Zero dependencies. Runs anywhere Node 18+ runs.

## Real-world results

We ran skillcheck on two of the most popular skill repos. Both are excellent, and even they have things to fix:

| Repo | Skills | Score | Highlights |
|---|---:|---:|---|
| [anthropics/skills](https://github.com/anthropics/skills) | 20 | 95 A | a description over the 1,024-char limit, a name containing a reserved word, 3 bodies over 5k tokens |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 52 | 97 A+ | 9 trigger collisions, like `"ambassador program"` claimed by two skills, and 13 references only reachable through other references |
| [burnoutscript/sales-skills](https://github.com/burnoutscript/sales-skills) | 16 | 100 A+ | linted with skillcheck in CI |

*Scores from October 2026. Run it yourself, the numbers will change as those repos improve.*

## Usage

```bash
npx skillcheck                       # lint every SKILL.md under the current directory
npx skillcheck skills/cold-email     # one skill
npx skillcheck . --min-score 90      # fail below 90
npx skillcheck . --strict            # fail on warnings too
npx skillcheck . --ignore body/no-examples,links/nested
npx skillcheck . --format json       # json | markdown | github | pretty
npx skillcheck . --badge skillcheck.svg
npx skillcheck . --badge-url         # prints a shields.io badge for your README
npx skillcheck --rules               # list every rule
```

Exit codes: `0` passed, `1` errors found (or below `--min-score`), `2` bad usage.

### Config

Drop a `.skillcheckrc.json` in your repo root:

```json
{
  "ignore": ["body/no-examples"],
  "minScore": 90,
  "strict": false
}
```

### GitHub Action

Findings show up as inline annotations on the PR, and a score table lands in the job summary.

```yaml
# .github/workflows/skills.yml
name: skills
on: [push, pull_request]
jobs:
  skillcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: burnoutscript/skillcheck@v0
        with:
          path: skills
          min-score: 90
```

### Badge

```bash
npx skillcheck skills --badge-url
# ![skillcheck](https://img.shields.io/badge/skillcheck-100%2F100-2ea043)
```

![skillcheck](https://img.shields.io/badge/skillcheck-100%2F100-2ea043)

### As a library

```js
import { lint } from 'skillcheck';

const report = lint(['skills']);
console.log(report.score, report.grade);   // 96 'A'
for (const r of report.results) console.log(r.name, r.findings);
```

## Rules

| Rule | Severity | What it catches |
|---|---|---|
| `frontmatter/missing` | error · fatal | No `---` YAML block, so the skill can't load |
| `frontmatter/invalid` | error | YAML the agent can't parse |
| `frontmatter/unknown-key` | info | Keys outside the spec that agents ignore |
| `name/missing` | error · fatal | No `name` |
| `name/format` | error | Not kebab-case, or over 64 chars |
| `name/reserved` | error | Contains `claude` or `anthropic` |
| `name/dir-mismatch` | warn | Name differs from its folder |
| `description/missing` | error · fatal | No description, so it never triggers |
| `description/too-long` | error | Over 1,024 chars |
| `description/too-short` | warn | Under 60 chars |
| `description/no-trigger` | warn | Says what, not when ("Use when the user...") |
| `description/person` | warn | "I can..." / "You can..." instead of third person |
| `description/vague` | info | "helps with", "various", "etc." |
| `body/empty` | error | No instructions |
| `body/too-long` | warn | Over 500 lines |
| `body/token-heavy` | warn | Over ~5,000 tokens |
| `body/no-structure` | info | Long body with no headings |
| `body/no-examples` | info | No example anywhere |
| `body/time-sensitive` | info | "as of March 2025" and friends go stale |
| `links/broken` | error | Relative link to a missing file |
| `links/nested` | info | A file only reachable through another reference |
| `paths/absolute` | warn | `C:\Users\...`, `/home/...` |
| `paths/backslash` | warn | `..\file.md` breaks on macOS and Linux |
| `security/secret` | error · fatal | API keys, tokens, private keys |
| `pack/duplicate-name` | error | Two skills with the same name |
| `pack/trigger-collision` | warn | Shared trigger phrases or near-identical descriptions |

### Scoring

Each skill starts at 100: **-15** per error, **-6** per warning, **-2** per info (info is capped at -10 so nitpicks can't sink a good skill). Fatal findings cap the score at 30, because a skill that can't load or leaks a key is broken no matter what else is right. The pack score is the average.

| Grade | A+ | A | B | C | D | F |
|---|---|---|---|---|---|---|
| Score | 97+ | 90+ | 80+ | 70+ | 60+ | <60 |

Limits follow the [Agent Skills spec](https://agentskills.io) and Anthropic's [skill authoring best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices).

## Roadmap

- [ ] `--fix` for mechanical issues (names, backslashes, unknown keys)
- [ ] `CLAUDE.md` / `AGENTS.md` linting
- [ ] Trigger eval: generate prompts and check which skill an agent would pick
- [ ] VS Code extension

## Contributing

Issues and PRs welcome. New rules need a fixture in `test/fixtures` and a test. Run `npm test` before sending.

## License

MIT
