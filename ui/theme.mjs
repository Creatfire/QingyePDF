// Interface theme: the toolbar button, the saved choice, the system preference, and the color
// scheme handed to every PDF.js frame (they render their own documents).
export function createTheme({ api, sessions, $ }) {
  const stored = () => { const value = localStorage.getItem('qingye-theme'); return value === 'dark' || value === 'light' ? value : 'system'; };
  const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  let timer;
  function set(dark, remember = true) {
    if (document.body.classList.contains('dark') !== dark) { document.body.classList.add('themeSwitching'); clearTimeout(timer); timer = setTimeout(() => document.body.classList.remove('themeSwitching'), 320); }
    document.body.classList.toggle('dark', dark);
    $('themeButton').setAttribute('aria-label', dark ? '切换浅色界面' : '切换深色界面');
    $('themeButton').title = dark ? '切换浅色界面' : '切换深色界面';
    $('themeButton').dataset.icon = dark ? 'sun' : 'moon';
    $('themeButton').setAttribute('aria-pressed', String(dark));
    if (remember) localStorage.setItem('qingye-theme', dark ? 'dark' : 'light');
    api.titleBarTheme?.(dark).catch(() => {});
    for (const s of sessions.values()) if (s.frame?.contentDocument) s.frame.contentDocument.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }
  // Applied on start and after the settings dialog changes the mode.
  const apply = () => { const mode = stored(); set(mode === 'system' ? systemDark() : mode === 'dark', false); };
  const setMode = mode => { if (mode === 'system') { localStorage.removeItem('qingye-theme'); set(systemDark(), false); } else set(mode === 'dark'); };
  $('themeButton').onclick = () => set(!document.body.classList.contains('dark'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => { if (!localStorage.getItem('qingye-theme')) set(event.matches, false); });
  return { set, apply, mode: stored, setMode };
}
