export function userError(error) {
  let text = String(error?.message ?? error ?? '').trim(), previous;
  do {
    previous = text;
    text = text.replace(/^(?:Error invoking remote method ['"][^'"]+['"]:\s*|(?:\w*Error):\s*)/, '').trim();
  } while (text !== previous);
  return text || '操作未完成，请重试。';
}
