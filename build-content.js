#!/usr/bin/env node
// Regenerates index.html from index-v2.template.html + content.md.
// No dependencies. Run: node build-content.js

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CONTENT_PATH = path.join(DIR, 'content.md');
const TEMPLATE_PATH = path.join(DIR, 'index-v2.template.html');
const OUTPUT_PATH = path.join(DIR, 'index.html');


// Global counter so footnote numbers stay sequential across the whole
// document (sections are rendered in the order they appear in the template).
let footnoteIndex = 0;

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
    `<span class="provisional" data-provisional="true" title="Unresolved placeholder">${inner.trim()}</span>`
  );

  // {{footnote: <note text>}} — renders as a numbered superscript that
  // reveals the note in a hover tooltip (pure CSS, no separate footnotes
  // section). tabindex makes it reachable/hover-equivalent via keyboard.
  text = text.replace(/\{\{footnote:\s*([\s\S]*?)\}\}/g, (_, inner) => {
    footnoteIndex += 1;
    const note = inner.trim().replace(/\s+/g, ' ');
    return `<span class="footnote" tabindex="0"><sup class="footnote-marker">${footnoteIndex}</sup><span class="footnote-tooltip">${note}</span></span>`;
  });

  // ![alt](src) — must run before [text](url) so the outer link syntax
  // (if the image is wrapped in one) still matches correctly.
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
    `<img src="${src}" alt="${alt}" class="content-logo">`
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

  // Blank lines mark paragraph breaks — render as <br><br>. Within each
  // paragraph, collapse internal newlines/whitespace from wrapped source lines.
  text = text
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .join('<br><br>');

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
      inner = `<span class="provisional-badge" data-provisional="true" title="Unconfirmed partner">${name}?</span>`;
    } else if (hasLogo) {
      inner = `<img src="./images/partners/${escapeHtml(logoFile)}" alt="${name}">`;
    } else {
      inner = name;
    }

    // Tile styling lives in the template stylesheet (.partner-tile and its
    // modifiers) so the build only decides the markup.
    const classes = ['partner-tile'];
    if (provisional) classes.push('partner-tile--provisional');
    else if (!hasLogo) classes.push('partner-tile--text');

    const tag = url ? 'a' : 'div';
    const linkAttrs = url ? ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` : '';

    return `        <li><${tag} class="${classes.join(' ')}"${linkAttrs}>${inner}</${tag}></li>`;
  });
  return items.join('\n');
}

function main() {
  footnoteIndex = 0;
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
