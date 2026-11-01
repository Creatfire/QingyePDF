// 0.19.1: release consistency. These are the mistakes that used to be caught only by reading the
// diff by hand — a version bumped in one file, or a new main-process module that never made it into
// the packaged file list, which ships as "module not found" on the user's machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const versionIn = (text, pattern) => (pattern.exec(text) || [])[1];

// Top-level modules the app requires at runtime. Everything else is bundled under ui/ or vendor/.
const MODULE_EXTENSIONS = ['.cjs'];

test('release: every file that states the version states the same one', () => {
  const version = json('package.json').version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/, 'package.json version must be x.y.z or x.y.z-beta.n');
  assert.equal(json('docs/releases/RELEASE-TARGET.json').version, version, 'RELEASE-TARGET.json version');
  assert.equal(json('docs/releases/RELEASE-TARGET.json').buildRevision, version, 'release build revision');
  assert.equal(json('package.json').build.extraMetadata.buildRevision, version, 'packaged build revision');
  assert.equal(versionIn(read('docs/history/CHANGELOG.md'), /^#\s*(\d+\.\d+\.\d+(?:-beta\.\d+)?)/m), version, 'CHANGELOG.md heading');
  assert.equal(versionIn(read('docs/features/FEATURES.md'), /^#\s*青页 PDF\s*(\d+\.\d+\.\d+(?:-beta\.\d+)?)/m), version, 'FEATURES.md heading');
  assert.equal(versionIn(read('docs/releases/HANDOFF.md'), /^#\s*青页 PDF\s*(\d+\.\d+\.\d+(?:-beta\.\d+)?)/m), version, 'HANDOFF.md heading');
});

test('release: the deferred Android build keeps its own version numbers in step', () => {
  // Android is not built while the Windows line is the active one, so its version is allowed to lag
  // behind package.json — but the two places that name it must agree, and the bump has to reach
  // versionCode as well (0.18.0 -> 1800, i.e. major*10000 + minor*100 + patch).
  const mobile = json('mobile/package.json').version;
  const gradle = read('mobile/android/app/build.gradle');
  assert.equal(versionIn(gradle, /versionName\s+"([^"]+)"/), mobile, 'android versionName must match mobile/package.json');
  const [major, minor, patch] = mobile.split('.').map(Number);
  assert.equal(Number(versionIn(gradle, /versionCode\s+(\d+)/)), major * 10000 + minor * 100 + patch, 'android versionCode must match the version');
});

test('packaging: every main-process module is in the packaged file list', () => {
  const files = json('package.json').build.files;
  const modules = readdirSync(root).filter(name => MODULE_EXTENSIONS.some(ext => name.endsWith(ext)));
  const missing = modules.filter(name => !files.includes(name));
  assert.deepEqual(missing, [], 'these modules would be missing from the installer and the ZIP');
});

test('packaging: every entry in the packaged file list exists', () => {
  const files = json('package.json').build.files;
  const missing = files.filter(name => !name.includes('*') && !existsSync(join(root, name)));
  assert.deepEqual(missing, []);
});
