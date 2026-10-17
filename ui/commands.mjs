// Commands pushed by the main process (menu items, window events, the conversion progress cards).
// The main process never touches the DOM; everything it wants shown arrives here.
export function createCommands(ctx) {
  const { $, sessions, current, activeId, isMd, open, addDocuments, status, message, officeProgress, reconvertOffice, reviewSave, closeTab, closeApp, nextTab, newMarkdown, markdown, navigation, chrome, windowStyle } = ctx;
  async function run(command, data) {
    if (command === 'open') return open();
    if (command === 'opened') return addDocuments(data);
    if (command === 'first-run') { status('欢迎使用青页 PDF'); return message('首次启动说明', '青页可以直接打开 PDF、Markdown，以及 Word、Excel、PowerPoint 等 Office 文件。Office 文件由内置的 LibreOffice 转换后以 PDF 形式打开，原文件不会被改动；第一次转换需要几秒钟。\n\n所有文档处理都在本机完成，不联网、不上传文件。'); }
    if (command === 'status') return status(String(data || ''));
    if (command === 'office-progress') return officeProgress.update(data);
    if (command === 'office-source-changed') return officeProgress.sourceChanged(data, () => reconvertOffice(data.id));
    if (command === 'save' || command === 'save-as') return reviewSave(current(), command === 'save-as');
    if (command === 'close-tab') return closeTab(activeId());
    if (command === 'close-app') return closeApp();
    if (command === 'next-tab' || command === 'previous-tab') return nextTab(command === 'next-tab' ? 1 : -1);
    if (command === 'find') return isMd(current()) ? markdown.openFind(current(), false) : navigation.show('search');
    if (command === 'new-markdown') return newMarkdown();
    if (command === 'spell') return markdown.onSpell(data);
    if (command === 'file-changed') { const s = sessions.get(data?.id); if (isMd(s) && s.loaded) return markdown.external(s, data.state); return; }
    if (command === 'fullscreen-changed') return chrome.fullscreen(data);
    if (command === 'window-maximized') return windowStyle.maximized(data);
    if (command === 'window-focus') return windowStyle.focused(data);
    if (command === 'help') return $('helpButton').click();
    if (command === 'print') return isMd(current()) ? markdown.print(current()) : current()?.app?.eventBus.dispatch('print', { source: current().app });
  }
  return { run };
}
