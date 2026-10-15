const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const template=path.join(root,'node_modules/app-builder-lib/templates/nsis/portable.nsi');
const original=fs.readFileSync(template);
// 0.15 ships the installer and a ZIP of the installed directory. The portable template swap is kept
// for a manual `portable` build only: electron-builder 26 has no portable script override, so the
// template is replaced during that build and always restored, including on compilation failure.
const portable=process.argv.includes('portable');
try{
  execFileSync(process.execPath,['scripts/generate-icon.mjs'],{cwd:root,stdio:'inherit'});
  if(portable)fs.copyFileSync(path.join(root,'build/portable-cache.nsi'),template);
  // Off Windows, electron-builder cannot edit the executable without Wine; scripts/after-pack.cjs
  // writes the icon and version information instead.
  const cross=process.platform==='win32'?[]:['-c.win.signAndEditExecutable=false'];
  execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--win',...process.argv.slice(2),'--x64','--publish','never',...cross],{cwd:root,stdio:'inherit'});
}finally{fs.writeFileSync(template,original);}
