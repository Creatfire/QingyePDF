// Windows file associations for the portable build (per user, no elevation).
// Windows 10/11 do not let programs set the default app silently (UserChoice is hash-protected),
// so Qingye registers itself as a *candidate* handler under HKCU and then hands the final choice
// to Windows: the "Open with" picker (with "Always") or Settings → Default apps.
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const APP_KEY = 'QingyePDF';
const TYPES = {
  pdf: { progId: 'QingyePDF.pdf', exts: ['.pdf'], label: 'PDF 文档' },
  md: { progId: 'QingyePDF.md', exts: ['.md', '.markdown'], label: 'Markdown 文档' },
};
const CLASSES = 'HKCU\\Software\\Classes';
const KNOWN = { MSEdgePDF: 'Microsoft Edge', 'AcroExch.Document.DC': 'Adobe Acrobat', 'Acrobat.Document.DC': 'Adobe Acrobat', 'AcroExch.Document': 'Adobe Acrobat', ChromeHTML: 'Google Chrome', FirefoxPDF: 'Firefox', FoxitReader: 'Foxit', 'FoxitReader.Document': 'Foxit', 'WPS.PDF.1': 'WPS', txtfile: '记事本', 'VSCode.md': 'Visual Studio Code', 'Typora.md': 'Typora', 'Applications\\notepad.exe': '记事本' };

function reg(args) {
  return new Promise((resolve, reject) => execFile('reg.exe', args, { windowsHide: true, encoding: 'buffer', timeout: 15000 }, (error, stdout) => {
    if (error) reject(error); else resolve(stdout.toString('latin1'));
  }));
}
const add = (key, name, data, type = 'REG_SZ') => reg(['add', key, ...(name == null ? ['/ve'] : ['/v', name]), '/t', type, '/d', data, '/f']);
const del = (key, name) => reg(['delete', key, ...(name == null ? [] : ['/v', name]), '/f']).catch(() => {});
async function value(key, name) {
  try {
    const out = await reg(['query', key, ...(name == null ? ['/ve'] : ['/v', name])]);
    const line = out.split(/\r?\n/).find(l => /\sREG_\w+\s/.test(l));
    return line ? line.replace(/^\s*\S*\s+REG_\w+\s+/, '').trim() : '';
  } catch { return null; }
}

function createAssociations({ app, shell }) {
  // The portable launcher extracts to a cache folder; associations must point at the portable exe itself.
  const exe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const unsupported = () => process.platform === 'darwin' ? '在 Mac 上请到访达中选中一个 PDF 或 Markdown 文件，打开“显示简介”，在“打开方式”里选择青页 PDF，再点“全部更改…”。' : process.platform !== 'win32' ? '仅 Windows 支持文件关联。' : !app.isPackaged ? '开发模式下不可修改文件关联，请在打包后的 exe 中使用。' : '';
  const command = () => `"${exe()}" "%1"`;

  async function status() {
    const reason = unsupported();
    const types = {};
    for (const [kind, t] of Object.entries(TYPES)) {
      if (reason) { types[kind] = { registered: false, isDefault: false, current: '' }; continue; }
      const cmd = await value(`${CLASSES}\\${t.progId}\\shell\\open\\command`, null);
      const choice = await value(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${t.exts[0]}\\UserChoice`, 'ProgId');
      const current = !choice ? '' : choice === t.progId ? '青页 PDF' : KNOWN[choice] || (choice.startsWith('Applications\\') ? choice.slice(13).replace(/\.exe$/i, '') : choice);
      // reg.exe prints non-ASCII characters in the console code page; compare the ASCII parts only.
      const ascii = v => v.replace(/[^\x20-\x7e]/g, '').toLowerCase();
      types[kind] = { registered: cmd != null, stale: cmd != null && ascii(cmd) !== ascii(command()), isDefault: choice === t.progId, current };
    }
    return { supported: !reason, reason, exe: reason ? '' : exe(), types };
  }

  async function register(kinds = Object.keys(TYPES)) {
    const reason = unsupported(); if (reason) throw new Error(reason);
    const file = exe(), capabilities = `HKCU\\Software\\${APP_KEY}\\Capabilities`;
    await add(capabilities, 'ApplicationName', '青页 PDF');
    await add(capabilities, 'ApplicationDescription', '本地开源的 PDF 阅读器与 Markdown 编辑器');
    await add(capabilities, 'ApplicationIcon', `"${file}",0`);
    for (const kind of kinds) {
      const t = TYPES[kind]; if (!t) continue;
      const base = `${CLASSES}\\${t.progId}`;
      await add(base, null, `${t.label} · 青页 PDF`);
      await add(`${base}\\DefaultIcon`, null, `"${file}",0`);
      await add(`${base}\\shell\\open\\command`, null, command());
      for (const ext of t.exts) {
        await add(`${CLASSES}\\${ext}\\OpenWithProgids`, t.progId, '');
        await add(`${capabilities}\\FileAssociations`, ext, t.progId);
      }
    }
    await add('HKCU\\Software\\RegisteredApplications', APP_KEY, `Software\\${APP_KEY}\\Capabilities`);
    return status();
  }

  async function unregister() {
    const reason = unsupported(); if (reason) throw new Error(reason);
    for (const t of Object.values(TYPES)) {
      await del(`${CLASSES}\\${t.progId}`);
      for (const ext of t.exts) await del(`${CLASSES}\\${ext}\\OpenWithProgids`, t.progId);
    }
    await del(`HKCU\\Software\\${APP_KEY}`);
    await del('HKCU\\Software\\RegisteredApplications', APP_KEY);
    return status();
  }

  // Windows' own "How do you want to open this file?" picker, for a throw-away file of that type.
  async function choose(kind) {
    const reason = unsupported(); if (reason) throw new Error(reason);
    const t = TYPES[kind]; if (!t) throw new Error('未知的文件类型。');
    const sample = path.join(os.tmpdir(), `QingyePDF-默认打开方式${t.exts[0]}`);
    await fs.writeFile(sample, kind === 'pdf' ? Buffer.from('%PDF-1.4\n%%EOF\n') : '# 青页\n');
    await new Promise(resolve => execFile('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', sample], { windowsHide: false }, () => resolve()));
    return true;
  }

  async function openSettings() {
    const reason = unsupported(); if (reason) throw new Error(reason);
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${APP_KEY}`).catch(() => shell.openExternal('ms-settings:defaultapps'));
    return true;
  }

  return { status, register, unregister, choose, openSettings, TYPES };
}

module.exports = { createAssociations, TYPES };
