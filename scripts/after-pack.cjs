// electron-builder afterPack hook. On Windows electron-builder writes the icon and version
// information into the executable itself (rcedit). When the Windows build is produced on
// another system that step is switched off (it needs Wine) and this hook does the same with
// resedit, a pure JavaScript editor for executable resources.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32' || process.platform === 'win32') return;
  const { NtExecutable, NtExecutableResource, Data, Resource } = await import('resedit');
  const info = context.packager.appInfo, root = context.packager.projectDir;
  const file = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const exe = NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  // Icon: replace every icon group the Electron executable ships with.
  const icon = Data.IconFile.from(fs.readFileSync(path.join(root, 'build', 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map(item => item.data));
  // Version information shown in Explorer's Properties → Details.
  const [major = 0, minor = 0, patch = 0] = info.version.split('.').map(part => parseInt(part, 10) || 0);
  const versions = Resource.VersionInfo.fromEntries(resources.entries);
  const version = versions[0] || Resource.VersionInfo.createEmpty();
  version.setFileVersion(major, minor, patch, 0); version.setProductVersion(major, minor, patch, 0);
  const languages = version.getAllLanguagesForStringValues();
  for (const language of languages.length ? languages : [{ lang: 1033, codepage: 1200 }]) version.setStringValues(language, {
    ProductName: info.productName, FileDescription: info.productName, CompanyName: info.companyName || 'Qingye PDF contributors', LegalCopyright: info.copyright,
    OriginalFilename: `${info.productFilename}.exe`, InternalName: info.productFilename, FileVersion: info.version, ProductVersion: info.version });
  version.outputToResourceEntries(resources.entries);
  resources.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
  console.log(`  • executable resources written (icon ${icon.icons.length} sizes, version ${info.version})`);
};
