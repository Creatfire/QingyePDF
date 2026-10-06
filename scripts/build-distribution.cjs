const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const template=path.join(root,'node_modules/app-builder-lib/templates/nsis/portable.nsi');
const original=fs.readFileSync(template);
// electron-builder 26 has no portable script override. Replace only its template
// during this build and always restore it, including on compilation failure.
try{
  execFileSync(process.execPath,['scripts/generate-icon.mjs'],{cwd:root,stdio:'inherit'});
  fs.copyFileSync(path.join(root,'build/portable-cache.nsi'),template);
  // Off Windows, electron-builder cannot edit the executable without Wine; scripts/after-pack.cjs
  // writes the icon and version information instead.
  const cross=process.platform==='win32'?[]:['-c.win.signAndEditExecutable=false'];
  execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--win',...process.argv.slice(2),'--x64','--publish','never',...cross],{cwd:root,stdio:'inherit'});
}finally{fs.writeFileSync(template,original);}
