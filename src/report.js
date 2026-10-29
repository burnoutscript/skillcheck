const useColor = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const paint = code => s => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  red: paint('31'), yellow: paint('33'), blue: paint('34'), green: paint('32'),
  gray: paint('90'), bold: paint('1'), dim: paint('2'),
};

const SEV = {
  error: { label: 'error', color: c.red, icon: '✖' },
  warn: { label: 'warn ', color: c.yellow, icon: '▲' },
  info: { label: 'info ', color: c.blue, icon: '●' },
};

const gradeColor = g => (g.startsWith('A') ? c.green : g === 'B' || g === 'C' ? c.yellow : c.red);

function bar(score, width = 20) {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + c.gray('░'.repeat(width - filled));
}

export function pretty(report, { quiet = false } = {}) {
  const out = [];
  if (!report.skills) return c.yellow('No SKILL.md files found.\n');

  for (const r of report.results) {
    const shown = quiet ? r.findings.filter(f => f.severity === 'error') : r.findings;
    const head = `${gradeColor(r.grade)(r.grade.padEnd(2))} ${String(r.score).padStart(3)}  ${c.bold(r.file)}`;
    const meta = c.gray(`  ~${r.tokens.body} tok`);
    out.push(head + meta);
    for (const f of shown) {
      const s = SEV[f.severity];
      out.push(`     ${s.color(`${s.icon} ${s.label}`)} ${c.gray(`L${f.line ?? 1}`.padEnd(5))} ${f.message} ${c.dim(f.rule)}`);
    }
    if (shown.length) out.push('');
  }

  const g = gradeColor(report.grade);
  out.push('');
  out.push(`  ${c.bold('skillcheck')}  ${bar(report.score)}  ${g(c.bold(`${report.score}/100`))} ${g(report.grade)}`);
  out.push(
    `  ${report.skills} skill${report.skills === 1 ? '' : 's'} · ` +
    `${c.red(`${report.errors} error${report.errors === 1 ? '' : 's'}`)} · ` +
    `${c.yellow(`${report.warnings} warning${report.warnings === 1 ? '' : 's'}`)} · ` +
    `${c.blue(`${report.infos} info`)} · ` +
    c.gray(`~${report.alwaysOnTokens} tokens always in context`),
  );
  out.push('');
  return out.join('\n');
}

export function markdown(report) {
  const out = [
    `## skillcheck: ${report.score}/100 (${report.grade})`,
    '',
    `${report.skills} skills · ${report.errors} errors · ${report.warnings} warnings · ${report.infos} info · ~${report.alwaysOnTokens} tokens always in context`,
    '',
    '| Skill | Score | Body tokens | Issues |',
    '| --- | ---: | ---: | --- |',
  ];
  for (const r of report.results) {
    const issues = r.findings.map(f => `\`${f.rule}\``).join(', ') || '✅';
    out.push(`| \`${r.name ?? r.file}\` | ${r.score} ${r.grade} | ${r.tokens.body} | ${issues} |`);
  }
  const all = report.results.flatMap(r => r.findings.map(f => ({ ...f, file: r.file })));
  if (all.length) {
    out.push('', '<details><summary>All findings</summary>', '');
    for (const f of all) out.push(`- **${f.severity}** \`${f.file}:${f.line ?? 1}\` ${f.message} (\`${f.rule}\`)`);
    out.push('', '</details>');
  }
  return out.join('\n') + '\n';
}

// GitHub Actions workflow commands: findings show up inline on the PR diff.
export function github(report) {
  const level = { error: 'error', warn: 'warning', info: 'notice' };
  const esc = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const lines = report.results.flatMap(r =>
    r.findings.map(f => `::${level[f.severity]} file=${r.file},line=${f.line ?? 1},title=${f.rule}::${esc(f.message)}`),
  );
  lines.push(`skillcheck score: ${report.score}/100 (${report.grade})`);
  return lines.join('\n') + '\n';
}

export const json = report => JSON.stringify(report, null, 2) + '\n';
