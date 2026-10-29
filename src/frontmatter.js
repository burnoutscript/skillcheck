// Minimal YAML frontmatter parser. Skills only use a small subset of YAML
// (scalars, quoted strings, block scalars, one level of nesting), so a full
// YAML dependency isn't worth it.

export function splitFrontmatter(text) {
  const src = text.replace(/^﻿/, '');
  const m = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { raw: null, body: src, bodyOffset: 0 };
  const bodyOffset = m[0].split('\n').length - 1;
  return { raw: m[1], body: src.slice(m[0].length), bodyOffset };
}

function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

export function parseFrontmatter(raw) {
  const data = {};
  const errors = [];
  const lines = raw.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) { i++; continue; }

    if (/^\s/.test(line)) {
      errors.push({ line: i + 2, message: `Unexpected indentation: "${line.trim()}"` });
      i++;
      continue;
    }

    const km = line.match(/^([A-Za-z0-9_-]+)\s*:(.*)$/);
    if (!km) {
      errors.push({ line: i + 2, message: `Cannot parse line: "${line.trim()}"` });
      i++;
      continue;
    }

    const key = km[1];
    let rest = km[2].trim();
    i++;

    // Collect the indented continuation block, if any.
    const block = [];
    while (i < lines.length && (lines[i].trim() === '' || /^\s/.test(lines[i]))) {
      block.push(lines[i]);
      i++;
    }
    while (block.length && !block.at(-1).trim()) block.pop();

    if (key in data) errors.push({ line: i + 1, message: `Duplicate key "${key}"` });

    if (/^[|>][+-]?$/.test(rest)) {
      const indent = Math.min(...block.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
      const content = block.map(l => l.slice(indent));
      data[key] = rest[0] === '|' ? content.join('\n') : content.join(' ').replace(/\s+/g, ' ').trim();
    } else if (rest === '' && block.length) {
      const items = block.filter(l => l.trim());
      if (items.every(l => l.trim().startsWith('- '))) {
        data[key] = items.map(l => unquote(l.trim().slice(2)));
      } else {
        const obj = {};
        for (const l of items) {
          const sm = l.trim().match(/^([A-Za-z0-9_-]+)\s*:(.*)$/);
          if (sm) obj[sm[1]] = unquote(sm[2]);
        }
        data[key] = obj;
      }
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest.slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else {
      // Plain scalars may wrap onto indented lines.
      const joined = [rest, ...block.map(l => l.trim())].filter(Boolean).join(' ');
      data[key] = unquote(joined);
    }
  }

  return { data, errors };
}
