// References come only from tool results, never from a model-supplied file path.
export function documentReferences(name, value) {
  const doc = value?.document;
  if (!doc?.id) return [];
  const locations = name === 'read_document' ? (value.pages || [{ line: value.start_line || 1, offset: value.start_char, text: value.text }])
    : name === 'search_document' ? value.matches || []
    : name === 'get_outline' ? value.headings || value.outline || []
    : name === 'get_selection' && value.selection ? [{ page: value.page, line: value.cursor_line, offset: value.start_char, text: value.selection }] : [];
  const seen = new Set();
  return locations.filter(loc => Number.isInteger(loc.page || loc.line) && (loc.page || loc.line) > 0).map(loc => {
    const position = loc.page ? { page: loc.page } : { line: loc.line, ...(Number.isInteger(loc.offset) ? { offset: loc.offset } : {}) };
    const href = '#qingye-ref-' + encodeURIComponent(JSON.stringify([doc.id, loc.page ? 'page' : 'line', loc.page || loc.line, loc.offset ?? null]));
    return { href, sourceTool: name, documentId: doc.id, path: doc.path, name: doc.name, kind: doc.kind, ...position, quote: String(loc.text ?? loc.title ?? value.query ?? '').slice(0, 120), truncated: !!value.truncated };
  }).filter(ref => { if (seen.has(ref.href)) return false; seen.add(ref.href); return true; });
}

export function findReference(href, messages) {
  if (typeof href !== 'string' || !href.startsWith('#qingye-ref-')) return null;
  return messages.flatMap(m => m.references || []).find(ref => ref.href === href) || null;
}
