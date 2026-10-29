import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';

// Limits follow the Agent Skills spec and Anthropic's authoring guidance.
export const LIMITS = {
  nameMax: 64,
  descriptionMax: 1024,
  descriptionMin: 60,
  bodyLinesMax: 500,
  bodyTokensMax: 5000,
};

const KNOWN_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility', 'version']);
const RESERVED = ['anthropic', 'claude'];
const TRIGGER_CUES = /\b(use (this |it )?(when|whenever|for|if|to)|when (the )?user|triggers?( on| when)?|invoke when|ask(s|ed)? (for|to|about)|mentions?)\b/i;
const FIRST_PERSON = /(^|[.!?]\s+)(i|i'm|i'll|i can|we|we'll|my|our)\b/i;
const SECOND_PERSON_DESC = /^\s*(you can|you should|this lets you|you will)\b/i;
const VAGUE = /\b(helps? with|various|stuff|things|etc\.?|and more|misc(ellaneous)?)\b/i;
const TIME_SENSITIVE = /\b(as of|until|before|after) (jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?|q[1-4]|20\d\d)\b/i;
const ABS_PATH = /(?:^|[\s`'"(])((?:[A-Za-z]:\\(?:Users|Windows|Program Files)[^\s`'")]*)|(?:\/(?:Users|home)\/[A-Za-z0-9._-]+\/[^\s`'")]*))/;

const SECRET_PATTERNS = [
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ['GitHub token', /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

export const estimateTokens = text => Math.ceil(text.length / 4);

// Returns body lines with fenced code blocks blanked out, so examples inside
// ``` fences don't trigger link and path rules.
function proseLines(body) {
  let inFence = false;
  return body.split(/\r?\n/).map(line => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return ''; }
    return inFence ? '' : line;
  });
}

export function extractLinks(body) {
  const links = [];
  proseLines(body).forEach((line, idx) => {
    const stripped = line.replace(/`[^`]*`/g, '');
    for (const m of stripped.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ target: m[1], line: idx });
    }
  });
  return links;
}

const isLocal = t => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(t);
// [text](URL) or [text](link) is a template placeholder, not a file reference.
const isPlaceholder = t => /^[A-Za-z_-]+$/.test(t) && !/^(LICENSE|README|CHANGELOG|NOTICE)$/i.test(t);

function finding(rule, message, line) {
  return { rule: rule.id, severity: rule.severity, message, line, ...(rule.fatal && { fatal: true }) };
}

export const RULES = [
  {
    id: 'frontmatter/missing',
    severity: 'error',
    fatal: true,
    summary: 'SKILL.md must start with a --- YAML frontmatter block',
    check(s) {
      if (s.raw === null) return [finding(this, 'No YAML frontmatter found. Start the file with ---, name:, description:, ---', 1)];
    },
  },
  {
    id: 'frontmatter/invalid',
    severity: 'error',
    summary: 'Frontmatter must be valid YAML',
    check(s) {
      return s.fmErrors.map(e => finding(this, e.message, e.line));
    },
  },
  {
    id: 'frontmatter/unknown-key',
    severity: 'info',
    summary: 'Frontmatter keys outside the spec are ignored by most agents',
    check(s) {
      return Object.keys(s.data)
        .filter(k => !KNOWN_KEYS.has(k))
        .map(k => finding(this, `Unknown frontmatter key "${k}". Agents ignore it; move it under metadata:`, s.keyLine(k)));
    },
  },
  {
    id: 'name/missing',
    severity: 'error',
    fatal: true,
    summary: 'A skill needs a name',
    check(s) {
      if (s.raw !== null && !s.data.name) return [finding(this, 'Missing "name" in frontmatter', 1)];
    },
  },
  {
    id: 'name/format',
    severity: 'error',
    summary: 'Names are lowercase letters, digits and single hyphens, max 64 chars',
    check(s) {
      const n = s.data.name;
      if (typeof n !== 'string' || !n) return;
      const out = [];
      if (n.length > LIMITS.nameMax) out.push(finding(this, `Name is ${n.length} chars (max ${LIMITS.nameMax})`, s.keyLine('name')));
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) out.push(finding(this, `Name "${n}" must be kebab-case (a-z, 0-9, single hyphens)`, s.keyLine('name')));
      return out;
    },
  },
  {
    id: 'name/reserved',
    severity: 'error',
    summary: 'Names cannot contain reserved words',
    check(s) {
      const n = String(s.data.name || '').toLowerCase();
      const hit = RESERVED.find(w => n.split('-').includes(w));
      if (hit) return [finding(this, `Name contains reserved word "${hit}"`, s.keyLine('name'))];
    },
  },
  {
    id: 'name/dir-mismatch',
    severity: 'warn',
    summary: 'The name should match the skill folder',
    check(s) {
      const n = s.data.name;
      if (n && s.dirName && n !== s.dirName) {
        return [finding(this, `Name "${n}" doesn't match folder "${s.dirName}"`, s.keyLine('name'))];
      }
    },
  },
  {
    id: 'description/missing',
    severity: 'error',
    fatal: true,
    summary: 'The description is how agents decide to load the skill',
    check(s) {
      if (s.raw !== null && !s.data.description) {
        return [finding(this, 'Missing "description". Without it the skill never triggers', 1)];
      }
    },
  },
  {
    id: 'description/too-long',
    severity: 'error',
    summary: `Descriptions are capped at ${LIMITS.descriptionMax} chars`,
    check(s) {
      const d = s.description;
      if (d.length > LIMITS.descriptionMax) {
        return [finding(this, `Description is ${d.length} chars (max ${LIMITS.descriptionMax}). It may be truncated or rejected`, s.keyLine('description'))];
      }
    },
  },
  {
    id: 'description/too-short',
    severity: 'warn',
    summary: 'Short descriptions rarely trigger reliably',
    check(s) {
      const d = s.description;
      if (d && d.length < LIMITS.descriptionMin) {
        return [finding(this, `Description is only ${d.length} chars. Say what it does AND when to use it`, s.keyLine('description'))];
      }
    },
  },
  {
    id: 'description/no-trigger',
    severity: 'warn',
    summary: 'Descriptions should say when to use the skill',
    check(s) {
      const d = s.description;
      if (d && !TRIGGER_CUES.test(d)) {
        return [finding(this, 'Description says what the skill is but not when to use it. Add "Use when the user ..." with real phrases', s.keyLine('description'))];
      }
    },
  },
  {
    id: 'description/person',
    severity: 'warn',
    summary: 'Write descriptions in third person',
    check(s) {
      const d = s.description;
      if (d && (FIRST_PERSON.test(d) || SECOND_PERSON_DESC.test(d))) {
        return [finding(this, 'Description uses first or second person. It is injected into the system prompt, so write it in third person ("Writes...", "Use when...")', s.keyLine('description'))];
      }
    },
  },
  {
    id: 'description/vague',
    severity: 'info',
    summary: 'Vague words weaken trigger matching',
    check(s) {
      const m = s.description.match(VAGUE);
      if (m) return [finding(this, `Vague wording "${m[0]}" in description. Name the concrete tasks instead`, s.keyLine('description'))];
    },
  },
  {
    id: 'body/empty',
    severity: 'error',
    summary: 'A skill needs instructions',
    check(s) {
      if (s.raw !== null && s.body.trim().length < 20) return [finding(this, 'Skill body is empty', s.bodyOffset + 1)];
    },
  },
  {
    id: 'body/too-long',
    severity: 'warn',
    summary: `Keep SKILL.md under ${LIMITS.bodyLinesMax} lines; move detail into reference files`,
    check(s) {
      const n = s.body.split(/\r?\n/).length;
      if (n > LIMITS.bodyLinesMax) {
        return [finding(this, `Body is ${n} lines (recommended max ${LIMITS.bodyLinesMax}). Split detail into references/*.md and link it`, s.bodyOffset + LIMITS.bodyLinesMax)];
      }
    },
  },
  {
    id: 'body/token-heavy',
    severity: 'warn',
    summary: `Bodies over ~${LIMITS.bodyTokensMax} tokens eat context every time the skill loads`,
    check(s) {
      const t = estimateTokens(s.body);
      if (t > LIMITS.bodyTokensMax) {
        return [finding(this, `Body is ~${t} tokens (recommended max ${LIMITS.bodyTokensMax}). Use progressive disclosure`, s.bodyOffset + 1)];
      }
    },
  },
  {
    id: 'body/no-structure',
    severity: 'info',
    summary: 'Headings help agents navigate long instructions',
    check(s) {
      const lines = s.body.split(/\r?\n/).length;
      if (lines > 40 && !/^#{1,4}\s/m.test(s.body)) {
        return [finding(this, `${lines} lines with no headings. Break it into sections`, s.bodyOffset + 1)];
      }
    },
  },
  {
    id: 'body/no-examples',
    severity: 'info',
    summary: 'Concrete examples improve output quality more than extra rules',
    check(s) {
      if (s.body.split(/\r?\n/).length > 30 && !/(^#{1,4}.*example|```|\bexample\b|\be\.g\.)/im.test(s.body)) {
        return [finding(this, 'No examples found. Show at least one input to output example', s.bodyOffset + 1)];
      }
    },
  },
  {
    id: 'body/time-sensitive',
    severity: 'info',
    summary: 'Date-bound statements go stale',
    check(s) {
      const out = [];
      proseLines(s.body).forEach((line, i) => {
        const m = line.match(TIME_SENSITIVE);
        if (m) out.push(finding(this, `Time-sensitive phrase "${m[0]}". Move it to an "Old patterns" section or remove it`, s.bodyOffset + i + 1));
      });
      return out.slice(0, 3);
    },
  },
  {
    id: 'links/broken',
    severity: 'error',
    summary: 'Relative links must point to files that exist',
    check(s) {
      const out = [];
      for (const l of extractLinks(s.body)) {
        if (!isLocal(l.target) || isPlaceholder(l.target)) continue;
        const target = decodeURIComponent(l.target.split('#')[0]);
        if (!target) continue;
        const abs = resolve(s.dir, target);
        if (!existsSync(abs)) out.push(finding(this, `Broken link: ${l.target}`, s.bodyOffset + l.line + 1));
      }
      return out;
    },
  },
  {
    id: 'links/nested',
    severity: 'info',
    summary: 'Keep references one level deep from SKILL.md',
    check(s) {
      const out = [];
      const toAbs = (base, t) => resolve(base, decodeURIComponent(t.split('#')[0]));
      const direct = extractLinks(s.body).filter(l => isLocal(l.target));
      const directSet = new Set(direct.map(l => toAbs(s.dir, l.target)));
      for (const l of direct) {
        const abs = toAbs(s.dir, l.target);
        if (extname(abs) !== '.md' || !existsSync(abs) || !statSync(abs).isFile()) continue;
        const hidden = extractLinks(readFileSync(abs, 'utf8'))
          .filter(x => isLocal(x.target) && extname(x.target.split('#')[0]) === '.md')
          .map(x => ({ ...x, abs: toAbs(dirname(abs), x.target) }))
          .filter(x => !directSet.has(x.abs) && !x.abs.endsWith('SKILL.md'));
        if (hidden.length && !out.some(f => f.message.startsWith(`${hidden[0].target} `))) {
          out.push(finding(this, `${hidden[0].target} is only reachable through ${l.target}. Link it from SKILL.md so agents find it`, s.bodyOffset + l.line + 1));
        }
      }
      return out;
    },
  },
  {
    id: 'paths/absolute',
    severity: 'warn',
    summary: 'Absolute paths break on every other machine',
    check(s) {
      const out = [];
      s.text.split(/\r?\n/).forEach((line, i) => {
        const m = line.match(ABS_PATH);
        if (m) out.push(finding(this, `Machine-specific path "${m[1].replace(/[.,;:]+$/, '')}". Use a path relative to the skill`, i + 1));
      });
      return out.slice(0, 3);
    },
  },
  {
    id: 'paths/backslash',
    severity: 'warn',
    summary: 'Use forward slashes in paths',
    check(s) {
      const out = [];
      for (const l of extractLinks(s.body)) {
        if (isLocal(l.target) && l.target.includes('\\')) {
          out.push(finding(this, `Backslash in link "${l.target}". Use / so it works on macOS and Linux`, s.bodyOffset + l.line + 1));
        }
      }
      return out;
    },
  },
  {
    id: 'security/secret',
    severity: 'error',
    fatal: true,
    summary: 'Never ship credentials inside a skill',
    check(s) {
      const out = [];
      s.text.split(/\r?\n/).forEach((line, i) => {
        for (const [label, re] of SECRET_PATTERNS) {
          if (re.test(line)) out.push(finding(this, `Looks like a hardcoded ${label}`, i + 1));
        }
      });
      return out;
    },
  },
];

const STOP = new Set('a an and are as at be by for from has in is it its of on or that the this to use used user uses when whenever with you your skill skills asks ask about any also can into like more not other see their them then these they which will'.split(' '));

const words = d => new Set(d.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter(w => !STOP.has(w)) ?? []);
// Quoted trigger phrases. Single quotes count only at word boundaries, so
// apostrophes ("it's not x, it's y") aren't read as quotes.
const quoted = d => [
  ...d.matchAll(/["“]([^"”]{4,60})["”]/g),
  ...d.matchAll(/(?:^|[\s(,:])['‘]([^'’]{4,60}?)['’](?=[\s,.;:)!?]|$)/g),
].map(m => m[1].toLowerCase().replace(/[\s.,;:!?]+$/, '').trim());

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// Rules that need to see every skill at once.
export const PACK_RULES = [
  {
    id: 'pack/duplicate-name',
    severity: 'error',
    summary: 'Two skills with the same name shadow each other',
    check(skills) {
      const seen = new Map();
      const out = [];
      for (const s of skills) {
        const n = s.data.name;
        if (!n) continue;
        if (seen.has(n)) out.push({ skill: s, rule: this.id, severity: this.severity, message: `Name "${n}" is also used by ${seen.get(n).rel}`, line: s.keyLine('name') });
        else seen.set(n, s);
      }
      return out;
    },
  },
  {
    id: 'pack/trigger-collision',
    severity: 'warn',
    summary: 'Overlapping descriptions make agents pick the wrong skill',
    check(skills) {
      const out = [];
      for (let i = 0; i < skills.length; i++) {
        for (let j = i + 1; j < skills.length; j++) {
          const a = skills[i], b = skills[j];
          if (!a.description || !b.description) continue;
          const sim = jaccard(words(a.description), words(b.description));
          const qa = quoted(a.description), qb = new Set(quoted(b.description));
          const shared = qa.filter(p => qb.has(p));
          if (shared.length) {
            out.push({ skill: b, rule: this.id, severity: this.severity, line: b.keyLine('description'), message: `Trigger phrase "${shared[0]}" is also claimed by ${a.data.name || a.rel}` });
          } else if (sim >= 0.5) {
            out.push({ skill: b, rule: this.id, severity: this.severity, line: b.keyLine('description'), message: `Description is ${Math.round(sim * 100)}% similar to ${a.data.name || a.rel}. Agents may pick the wrong one; sharpen what makes each unique` });
          }
        }
      }
      return out;
    },
  },
];

export const ALL_RULES = [...RULES, ...PACK_RULES];
