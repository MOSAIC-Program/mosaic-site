#!/usr/bin/env node
// Regenerates index-v2.html from index-v2.template.html + content.md.
// No dependencies. Run: node build-content.js

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CONTENT_PATH = path.join(DIR, 'content.md');
const TEMPLATE_PATH = path.join(DIR, 'index-v2.template.html');
const OUTPUT_PATH = path.join(DIR, 'index-v2.html');

const PROVISIONAL_INLINE_STYLE =
  'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.86em; ' +
  'line-height: 1.5; color: var(--terracotta); background: var(--prov-bg); ' +
  'box-shadow: inset 0 0 0 1px var(--prov-line); border-radius: 2px; padding: 0.15em 0.4em;';

const PROVISIONAL_BADGE_STYLE =
  'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; ' +
  'color: var(--terracotta); background: var(--prov-bg); box-shadow: inset 0 0 0 1px var(--prov-line); ' +
  'border-radius: 2px; padding: 0.25em 0.5em;';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseSections(md) {
  const sections = {};
  const lines = md.split('\n');
  let currentKey = null;
  let buf = [];
  const flush = () => {
    if (currentKey) sections[currentKey] = buf.join('\n').trim();
    buf = [];
  };
  for (const line of lines) {
    const m = /^###\s+(\S+)\s*$/.exec(line);
    if (m) {
      flush();
      currentKey = m[1];
    } else if (currentKey) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

// Strips markdown comment lines (<!-- ... -->) that live on their own line(s).
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function renderInline(raw) {
  let text = escapeHtml(raw);

  // {{provisional: <text>}}
  text = text.replace(/\{\{provisional:\s*([\s\S]*?)\}\}/g, (_, inner) =>
    `<span data-provisional="true" title="Unresolved placeholder" style="${PROVISIONAL_INLINE_STYLE}">${inner.trim()}</span>`
  );

  // [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const external = /^https?:\/\//.test(url);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${url}"${attrs}>${label}</a>`;
  });

  // **bold**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // *italic*
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Collapse any internal newlines/whitespace from wrapped source lines.
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

const PARTNER_LOGOS_DIR = path.join(DIR, 'images', 'partners');

function renderPartners(raw) {
  const lines = stripComments(raw).split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
  const items = lines.map(line => {
    let rest = line.replace(/^-\s*/, '');
    let provisional = false;

    const qm = /^\?\s*/.exec(rest);
    if (qm) { provisional = true; rest = rest.slice(qm[0].length); }

    const parts = rest.split('|').map(p => p.trim());
    const rawName = parts[0] || '';
    const name = escapeHtml(rawName);
    const url = parts[1] || '';
    const logoFile = parts[2] || '';

    const hasLogo = !!logoFile && fs.existsSync(path.join(PARTNER_LOGOS_DIR, logoFile));
    if (logoFile && !hasLogo) {
      console.warn(`Partners: logo "${logoFile}" for "${rawName}" not found in images/partners/ — showing text instead.`);
    }

    let inner;
    if (provisional) {
      inner = `<span data-provisional="true" title="Unconfirmed partner" style="${PROVISIONAL_BADGE_STYLE}">${name}?</span>`;
    } else if (hasLogo) {
      inner = `<img src="./images/partners/${escapeHtml(logoFile)}" alt="${name}" style="max-width: 100%; max-height: 36px; object-fit: contain; filter: grayscale(1); opacity: 0.72; transition: filter .2s ease, opacity .2s ease;">`;
    } else {
      inner = name;
    }

    const justify = hasLogo && !provisional ? 'justify-content: center;' : '';
    const tileStyle = `display: flex; align-items: center; ${justify} height: 100%; box-sizing: border-box; padding: 18px 20px; background: var(--ground-2); font-family: Newsreader, Georgia, serif; font-size: 1.25rem; line-height: 1.2;`;

    const tag = url ? 'a' : 'div';
    const linkAttrs = url ? ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` : '';
    const cls = url && hasLogo && !provisional ? ' class="partner-tile"' : '';
    const linkStyle = url ? ' text-decoration: none; color: inherit;' : '';

    return `        <li style="padding: 0;"><${tag}${cls}${linkAttrs} style="${tileStyle}${linkStyle}">${inner}</${tag}></li>`;
  });
  return items.join('\n');
}

function main() {
  const md = fs.readFileSync(CONTENT_PATH, 'utf8');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const sections = parseSections(md);

  let out = template;
  const usedKeys = new Set();
  const missing = [];

  out = out.replace(/@@([a-zA-Z0-9-]+)@@/g, (_, key) => {
    usedKeys.add(key);
    if (!(key in sections)) {
      missing.push(key);
      return `@@${key}@@`;
    }
    const raw = stripComments(sections[key]);
    return key === 'partners' ? renderPartners(sections[key]) : renderInline(raw);
  });

  if (missing.length) {
    console.error('Missing content.md sections for: ' + missing.join(', '));
    process.exit(1);
  }

  const unusedKeys = Object.keys(sections).filter(k => !usedKeys.has(k));
  if (unusedKeys.length) {
    console.warn('content.md has sections not used by the template: ' + unusedKeys.join(', '));
  }

  const banner =
    '<!-- AUTO-GENERATED by build-content.js from index-v2.template.html + content.md.\n' +
    '     Edit content.md (or the template for structure/style), then run: node build-content.js\n' +
    '     Do not hand-edit this file — your changes will be overwritten on the next build. -->\n';

  fs.writeFileSync(OUTPUT_PATH, banner + out, 'utf8');
  console.log('Wrote ' + path.relative(DIR, OUTPUT_PATH));
}

main();
