// The application icons are rendered from build/logo.png by scripts/make-icons.py and committed.
// This step (run before packaging) only verifies that they are present and consistent.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const ico = fs.readFileSync(path.join(root, 'build', 'icon.ico'));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('build/icon.ico is not a Windows icon.');
const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
for (const needed of [16, 32, 48, 256]) if (!sizes.includes(needed)) throw new Error(`build/icon.ico lacks the ${needed} px image; run scripts/make-icons.py.`);
const png = fs.readFileSync(path.join(root, 'ui', 'icon.png'));
if (png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(16) !== 256) throw new Error('ui/icon.png must be the 256 px icon; run scripts/make-icons.py.');
if (!fs.existsSync(path.join(root, 'ui', 'logo.png'))) throw new Error('ui/logo.png is missing; run scripts/make-icons.py.');
console.log(`Qingye application icon verified (${sizes.join(', ')} px).`);
