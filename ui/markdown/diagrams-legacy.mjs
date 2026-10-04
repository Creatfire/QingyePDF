// Typora's ```sequence and ```flow diagram languages, converted to Mermaid so they render offline
// with the same engine, colours and export paths as ```mermaid (no extra libraries).
const esc = t => String(t).trim().replace(/;/g, '#59;').replace(/#(?![\d\w]+;)/g, '#35;');
const q = t => '"' + String(t).trim().replace(/"/g, '#quot;') + '"';

export function sequenceToMermaid(source) {
  const out = ['sequenceDiagram'], ids = new Map(), declared = [];
  const id = name => {
    name = name.trim();
    if (/^[A-Za-z_][\w]*$/.test(name)) { if (!ids.has(name)) { ids.set(name, name); } return name; }
    if (!ids.has(name)) { const n = 'P' + (ids.size + 1); ids.set(name, n); declared.push(`participant ${n} as ${esc(name)}`); }
    return ids.get(name);
  };
  const body = [];
  const arrows = [['-->>', '--)'], ['->>', '-)'], ['-->', '-->>'], ['->', '->>']];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let m;
    if ((m = /^title\s*:\s*(.*)$/i.exec(line))) { body.push(`title ${esc(m[1])}`); continue; }
    if ((m = /^participant\s+(.+)$/i.exec(line))) { const a = id(m[1]); if (!declared.some(d => d.startsWith(`participant ${a}`))) declared.push(`participant ${a}`); continue; }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(line))) {
      const where = m[1].toLowerCase(), who = m[2].split(',').map(id).join(',');
      body.push(`Note ${where} ${who}: ${esc(m[3])}`); continue;
    }
    const arrow = /^(.+?)\s*(-->>|->>|-->|->)\s*(.+?)\s*:\s*(.*)$/.exec(line) || /^(.+?)\s*(-->>|->>|-->|->)\s*(.+)$/.exec(line);
    if (arrow) {
      const [, from, op, to, text = ''] = arrow, mapped = arrows.find(([a]) => a === op)[1];
      body.push(`${id(from)}${mapped}${id(to)}: ${esc(text) || ' '}`); continue;
    }
    throw new Error('无法识别的序列图语句：' + line);
  }
  if (!body.length) throw new Error('序列图内容为空。');
  const titles = body.filter(l => l.startsWith('title ')), rest = body.filter(l => !l.startsWith('title '));
  return [...out, ...titles.map(t => '  ' + t), ...declared.map(d => '  ' + d), ...rest.map(l => '  ' + l)].join('\n');
}

const SHAPES = { start: l => `([${l}])`, end: l => `([${l}])`, operation: l => `[${l}]`, inputoutput: l => `[/${l}/]`, subroutine: l => `[[${l}]]`, condition: l => `{${l}}`, parallel: l => `{{${l}}}` };
const DIRECTIONS = new Set(['left', 'right', 'top', 'bottom']);

export function flowToMermaid(source) {
  const nodes = new Map(), edges = [], order = [];
  const node = (name, type = 'operation', label) => { if (!nodes.has(name)) { nodes.set(name, { type, label: label ?? name }); order.push(name); } return nodes.get(name); };
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = /^([\w-]+)\s*=>\s*(\w+)\s*(?::\s*(.*))?$/.exec(line))) {
      const type = m[2].toLowerCase(); if (!SHAPES[type]) throw new Error('未知的流程图节点类型：' + m[2]);
      let label = (m[3] ?? m[1]).replace(/:>\s*\S+.*$/, '').replace(/\|[^|]*$/, '').trim();
      const n = node(m[1], type, label || m[1]); n.type = type; n.label = label || m[1]; continue;
    }
    if (line.includes('->')) {
      const parts = line.split('->').map(s => s.trim()).filter(Boolean);
      const parsed = parts.map(p => { const mm = /^([\w-]+)(?:\(([^)]*)\))?$/.exec(p); if (!mm) throw new Error('无法识别的连接：' + p); return { name: mm[1], spec: mm[2] ? mm[2].split(',').map(s => s.trim()).filter(Boolean) : [] }; });
      parsed.forEach(p => node(p.name));
      for (let i = 0; i < parsed.length - 1; i++) {
        const label = parsed[i].spec.find(s => !DIRECTIONS.has(s.toLowerCase())) || '';
        edges.push([parsed[i].name, parsed[i + 1].name, label]);
      }
      continue;
    }
    throw new Error('无法识别的流程图语句：' + line);
  }
  if (!order.length) throw new Error('流程图内容为空。');
  const lines = ['flowchart TD'];
  for (const name of order) { const n = nodes.get(name); lines.push(`  ${name}${SHAPES[n.type](q(n.label))}`); }
  for (const [a, b, label] of edges) lines.push(label ? `  ${a} -->|${esc(label)}| ${b}` : `  ${a} --> ${b}`);
  return lines.join('\n');
}

export const LEGACY_LANGS = { sequence: 'sequence', flow: 'flow', flowchart: 'flow' };
export function legacyToMermaid(kind, source) { return kind === 'sequence' ? sequenceToMermaid(source) : flowToMermaid(source); }
