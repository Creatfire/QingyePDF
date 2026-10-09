// 0.15.0 home layouts — data the renderer cannot read itself: recent-file details and the excerpts
// written into recent Markdown notes. Everything stays on this computer; nothing is indexed anew.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const unescape = text => String(text).replace(/\\([\\`*_{}\[\]<>#()!.+\-])/g, '$1');
// "> quote\n\n[name · 第 N 页](<file:///…#page=N&rect=…>)" — the excerpt format of ui/notes-mode.mjs.
const LINK = /\[([^\]\n]{1,300}?) · 第 (\d+) 页(?: · 区域)?\]\(<?(file:[^>)\s]+|#qingye-source-[^)>\s]+)>?\)/g;
function parseExcerpts(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    LINK.lastIndex = 0; const m = LINK.exec(lines[i]); if (!m) continue;
    let j = i - 1; while (j >= 0 && !lines[j].trim()) j--;
    const quote = []; while (j >= 0 && /^\s*>/.test(lines[j])) { quote.unshift(lines[j].replace(/^\s*>\s?/, '')); j--; }
    let file = null;
    if (m[3].startsWith('file:')) { try { file = fileURLToPath(m[3].replace(/#.*$/, '')); } catch { file = null; } }
    out.push({ quote: unescape(quote.reduce((t, line) => !t ? line.trim() : /[\u3000-\u9fff\uff00-\uffef]$/.test(t) || /^[\u3000-\u9fff\uff00-\uffef]/.test(line.trim()) ? t + line.trim() : t + ' ' + line.trim(), '')).slice(0, 200), source: unescape(m[1]).slice(0, 120), page: Number(m[2]) || 1, file, region: /· 区域\]/.test(m[0]) });
  }
  return out;
}

async function excerptsFrom(recent, { limitNotes = 12, limitItems = 16, maxBytes = 4 * 1024 * 1024 } = {}) {
  const notes = recent.filter(r => /\.(md|markdown|mdown|mkd)$/i.test(r.path)).slice(0, limitNotes), items = [];
  for (const note of notes) {
    try {
      const info = await fs.stat(note.path); if (info.size > maxBytes) continue;
      const found = parseExcerpts(await fs.readFile(note.path, 'utf8')).filter(e => e.quote);
      for (const e of found.reverse()) items.push({ ...e, note: path.basename(note.path), notePath: note.path, time: Math.max(Number(note.opened) || 0, info.mtimeMs || 0) });
    } catch {}
    if (items.length >= limitItems * 2) break;
  }
  return items.sort((a, b) => b.time - a.time).slice(0, limitItems);
}

async function sizes(paths) {
  return Promise.all(paths.map(async p => { try { return (await fs.stat(p)).size; } catch { return null; } }));
}
module.exports = { parseExcerpts, excerptsFrom, sizes };
