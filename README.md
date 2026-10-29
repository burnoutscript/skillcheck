# skillcheck

A linter for Agent Skills. It scores and badges your `SKILL.md` files for Claude Code, Cursor, Codex, OpenCode and any other agent that reads the [Agent Skills](https://agentskills.io) format.

[![CI](https://github.com/burnoutscript/skillcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/burnoutscript/skillcheck/actions/workflows/ci.yml)
![zero dependencies](https://img.shields.io/badge/dependencies-0-2ea043)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```bash
npx github:burnoutscript/skillcheck .claude/skills
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

Agents decide whether to load a skill from its description alone. When the description is vague, overlaps another skill, or the body links to a file that isn't there, the skill fails without telling anyone. A body that costs 8,000 tokens every time it loads doesn't announce itself either.

skillcheck looks for:

- weak triggers: no "Use when...", a description that's too short, vague words, first-person phrasing
- trigger collisions, where two skills claim the same phrase or have descriptions so close that the agent can pick the wrong one. This is the most common bug I've seen in large skill packs, and I haven't found another linter that checks it.
- context cost: body length, token estimates, and how many tokens every description in the pack keeps in context
- broken references: dead relative links, backslash paths, reference files that can only be reached through another reference
- spec problems: name format, reserved words, length limits, frontmatter keys agents ignore
- leaks: hardcoded API keys and tokens, paths that only exist on your machine

It has no dependencies and runs on Node 18 or newer.

## Results on popular repos

I ran it on two of the most-starred skill repos. Both are good, and both still have things to fix:

| Repo | Skills | Score | Highlights |
|---|---:|---:|---|
| [anthropics/skills](https://github.com/anthropics/skills) | 20 | 95 A | one description over the 1,024-character limit, one name with a reserved word, three bodies over 5k tokens |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 52 | 97 A+ | 9 trigger collisions (two skills both claim `"ambassador program"`, for one), and 13 reference files reachable only through other references |
| [burnoutscript/sales-skills](https://github.com/burnoutscript/sales-skills) | 16 | 100 A+ | linted with skillcheck in CI |

These scores are from October 2026 and will change as those repos improve.

## Usage

```bash
npx github:burnoutscript/skillcheck                       # every SKILL.md under the current directory
npx github:burnoutscript/skillcheck skills/cold-email     # one skill
npx github:burnoutscript/skillcheck . --min-score 90      # fail below 90
npx github:burnoutscript/skillcheck . --strict            # fail on warnings too
npx github:burnoutscript/skillcheck . --ignore body/no-examples,links/nested
npx github:burnoutscript/skillcheck . --format json       # json | markdown | github | pretty
npx github:burnoutscript/skillcheck . --badge skillcheck.svg
npx github:burnoutscript/skillcheck . --badge-url         # prints a shields.io badge for your README
npx github:burnoutscript/skillcheck --rules               # list every rule
```

To get a plain `skillcheck` command, install it once with `npm i -g github:burnoutscript/skillcheck`.

Exit code `0` means it passed, `1` means errors were found or the score is below `--min-score`, and `2` means bad usage.

### Config

Put a `.skillcheckrc.json` in your repo root:

```json
{
  "ignore": ["body/no-examples"],
  "minScore": 90,
  "strict": false
}
```

### GitHub Action

Findings show up as annotations on the PR diff, and a score table goes into the job summary.

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
npx github:burnoutscript/skillcheck skills --badge-url
# ![skillcheck](https://img.shields.io/badge/skillcheck-100%2F100-2ea043)
```

![skillcheck](https://img.shields.io/badge/skillcheck-100%2F100-2ea043)

### As a library

```bash
npm i github:burnoutscript/skillcheck
```

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
| `frontmatter/unknown-key` | info | Keys outside the spec, which agents ignore |
| `name/missing` | error · fatal | No `name` |
| `name/format` | error | Not kebab-case, or longer than 64 characters |
| `name/reserved` | error | Contains `claude` or `anthropic` |
| `name/dir-mismatch` | warn | Name differs from its folder |
| `description/missing` | error · fatal | No description, so the skill never triggers |
| `description/too-long` | error | Over 1,024 characters |
| `description/too-short` | warn | Under 60 characters |
| `description/no-trigger` | warn | Says what the skill does but not when to use it ("Use when the user...") |
| `description/person` | warn | "I can..." or "You can..." instead of third person |
| `description/vague` | info | "helps with", "various", "etc." |
| `body/empty` | error | No instructions |
| `body/too-long` | warn | Over 500 lines |
| `body/token-heavy` | warn | Over about 5,000 tokens |
| `body/no-structure` | info | Long body with no headings |
| `body/no-examples` | info | No example anywhere |
| `body/time-sensitive` | info | Phrases like "as of March 2025" that go stale |
| `links/broken` | error | Relative link to a missing file |
| `links/nested` | info | A file that can only be reached through another reference |
| `paths/absolute` | warn | `C:\Users\...`, `/home/...` |
| `paths/backslash` | warn | `..\file.md` breaks on macOS and Linux |
| `security/secret` | error · fatal | API keys, tokens, private keys |
| `pack/duplicate-name` | error | Two skills with the same name |
| `pack/trigger-collision` | warn | Shared trigger phrases or near-identical descriptions |

### Scoring

Each skill starts at 100 and loses 15 per error, 6 per warning and 2 per info finding. Info findings can take off at most 10 points in total, so nitpicks can't sink a good skill. A fatal finding caps the score at 30, because a skill that can't load or that leaks a key is broken whatever else it gets right. The pack score is the average.

| Grade | A+ | A | B | C | D | F |
|---|---|---|---|---|---|---|
| Score | 97+ | 90+ | 80+ | 70+ | 60+ | <60 |

The limits come from the [Agent Skills spec](https://agentskills.io) and Anthropic's [skill authoring best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices).

## Roadmap

- [ ] `--fix` for mechanical issues (names, backslashes, unknown keys)
- [ ] `CLAUDE.md` / `AGENTS.md` linting
- [ ] Trigger eval: generate prompts and check which skill an agent would pick
- [ ] VS Code extension

## Contributing

Issues and PRs are welcome. A new rule needs a fixture in `test/fixtures` and a test. Run `npm test` before you send it.

## License

MIT
