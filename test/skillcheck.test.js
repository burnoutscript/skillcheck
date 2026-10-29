import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint, scoreFindings, grade } from '../src/index.js';
import { parseFrontmatter, splitFrontmatter } from '../src/frontmatter.js';
import { badgeSvg, badgeUrl } from '../src/badge.js';
import { jaccard } from '../src/rules.js';

const fx = p => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));
const cli = fileURLToPath(new URL('../bin/skillcheck.js', import.meta.url));
const rulesOf = report => report.results.flatMap(r => r.findings.map(f => f.rule));

test('a well-formed skill scores 100 with no findings', () => {
  const r = lint([fx('good')]);
  assert.equal(r.skills, 1);
  assert.equal(r.score, 100);
  assert.equal(r.grade, 'A+');
  assert.deepEqual(r.results[0].findings, []);
});

test('flags the classic mistakes', () => {
  const rules = rulesOf(lint([fx('bad/Bad_Name')]));
  for (const id of [
    'name/format', 'description/too-short', 'description/no-trigger', 'description/person',
    'description/vague', 'frontmatter/unknown-key', 'links/broken', 'paths/backslash', 'paths/absolute',
  ]) {
    assert.ok(rules.includes(id), `expected ${id}`);
  }
});

test('missing frontmatter and leaked secrets cap the score', () => {
  const r = lint([fx('bad/no-frontmatter'), fx('bad/leaky')]);
  for (const res of r.results) assert.ok(res.score <= 30, `${res.file} scored ${res.score}`);
  assert.ok(rulesOf(r).includes('frontmatter/missing'));
  assert.ok(rulesOf(r).includes('security/secret'));
});

test('detects two skills claiming the same trigger phrase', () => {
  const r = lint([fx('collide')]);
  const hit = r.results.flatMap(x => x.findings).find(f => f.rule === 'pack/trigger-collision');
  assert.ok(hit);
  assert.match(hit.message, /create an invoice/);
});

test('--ignore skips rules', () => {
  const r = lint([fx('collide')], { ignore: ['pack/trigger-collision'] });
  assert.equal(r.score, 100);
});

test('frontmatter parser handles quotes, block scalars, lists and maps', () => {
  const { data, errors } = parseFrontmatter([
    'name: "quoted-name"',
    'description: >',
    '  Folded text',
    '  over lines.',
    'allowed-tools: [Read, Grep]',
    'metadata:',
    '  version: 1.2',
    '  owner: team',
    'license: |',
    '  MIT',
  ].join('\n'));
  assert.deepEqual(errors, []);
  assert.equal(data.name, 'quoted-name');
  assert.equal(data.description, 'Folded text over lines.');
  assert.deepEqual(data['allowed-tools'], ['Read', 'Grep']);
  assert.deepEqual(data.metadata, { version: '1.2', owner: 'team' });
  assert.equal(data.license, 'MIT');
});

test('splitFrontmatter tolerates BOM and CRLF', () => {
  const { raw, body } = splitFrontmatter('﻿---\r\nname: x\r\n---\r\nhello');
  assert.equal(raw, 'name: x');
  assert.equal(body, 'hello');
});

test('scoring and grades', () => {
  assert.equal(scoreFindings([]), 100);
  assert.equal(scoreFindings([{ severity: 'error' }, { severity: 'warn' }]), 79);
  // info penalties are capped so nitpicks can't sink a good skill
  assert.equal(scoreFindings(Array(20).fill({ severity: 'info' })), 90);
  assert.equal(grade(97), 'A+');
  assert.equal(grade(59), 'F');
});

test('jaccard similarity', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
});

test('badge renders score and color', () => {
  const svg = badgeSvg(92);
  assert.match(svg, /92\/100/);
  assert.match(svg, /#3fb950/);
  assert.match(badgeUrl(55), /e05d44$/);
});

test('CLI exits 0 on clean skills and 1 on errors', () => {
  const ok = spawnSync(process.execPath, [cli, fx('good')], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  const bad = spawnSync(process.execPath, [cli, fx('bad')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

test('CLI --min-score and json output', () => {
  const r = spawnSync(process.execPath, [cli, fx('collide'), '--min-score', '99'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const out = JSON.parse(execFileSync(process.execPath, [cli, fx('good'), '-f', 'json'], { encoding: 'utf8' }));
  assert.equal(out.score, 100);
});

test('CLI github format emits workflow annotations', () => {
  const r = spawnSync(process.execPath, [cli, fx('bad/leaky'), '-f', 'github'], { encoding: 'utf8' });
  assert.match(r.stdout, /^::error file=.*leaky\/SKILL\.md,line=6,title=security\/secret::/m);
});
