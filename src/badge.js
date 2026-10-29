// Flat shields.io-style SVG badge, rendered locally so it works offline and in CI.

const COLORS = [[97, '#2ea043'], [90, '#3fb950'], [80, '#a3b818'], [70, '#dfb317'], [60, '#fe7d37'], [0, '#e05d44']];

export const badgeColor = score => COLORS.find(([min]) => score >= min)[1];

// Approximate Verdana 11px glyph widths, good enough for short labels.
const textWidth = s => [...s].reduce((w, ch) => w + (/[il.,:1|]/.test(ch) ? 4 : /[mwMW]/.test(ch) ? 10 : /[A-Z0-9]/.test(ch) ? 7.5 : 6.5), 0);

export function badgeSvg(score, label = 'skillcheck') {
  const value = `${score}/100`;
  const lw = Math.round(textWidth(label) + 12);
  const vw = Math.round(textWidth(value) + 12);
  const w = lw + vw;
  const color = badgeColor(score);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
<title>${label}: ${value}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="${lw / 2}" y="14">${label}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="${lw + vw / 2}" y="14">${value}</text>
</g>
</svg>
`;
}

export const badgeUrl = (score, label = 'skillcheck') =>
  `https://img.shields.io/badge/${encodeURIComponent(label)}-${score}%2F100-${badgeColor(score).slice(1)}`;
