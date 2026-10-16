// Manual update check (Settings → About → 检查更新). Asks the GitHub Releases API for the latest
// published release only when the user clicks; nothing runs in the background and nothing is
// downloaded or installed automatically — the release page opens in the browser.
const REPO = 'Creatfire/QingyePDF';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_PAGE = new RegExp(`^https://github\\.com/${REPO.replace('/', '\\/')}/releases(?:/|$)`);

// "v0.19.0" / "0.19.0-beta.1" → comparable parts; a pre-release sorts before its release.
function parse(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(version || '').trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' } : null;
}
function compareVersions(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

async function checkForUpdate({ current, fetch, timeout = 15000 }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try { response = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'QingyePDF/' + current }, signal: controller.signal }); }
  catch (error) { throw new Error(error.name === 'AbortError' ? '检查更新超时，请检查网络连接。' : '无法连接到 GitHub，请检查网络连接。'); }
  finally { clearTimeout(timer); }
  if (response.status === 404) return { current, latest: '', newer: false, url: `https://github.com/${REPO}/releases` };
  if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）。`);
  const release = await response.json();
  const latest = String(release.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const pick = re => assets.find(a => re.test(a.name || ''));
  const installer = pick(/Setup.*\.exe$/i), zip = pick(/\.zip$/i);
  const url = RELEASE_PAGE.test(release.html_url || '') ? release.html_url : `https://github.com/${REPO}/releases`;
  return {
    current, latest, newer: !!latest && compareVersions(latest, current) > 0, url,
    name: String(release.name || release.tag_name || ''), publishedAt: release.published_at || '',
    notes: String(release.body || '').slice(0, 4000),
    installer: installer ? { name: installer.name, size: installer.size } : null,
    zip: zip ? { name: zip.name, size: zip.size } : null,
  };
}
const isReleasePage = url => RELEASE_PAGE.test(String(url || ''));

module.exports = { REPO, LATEST, compareVersions, checkForUpdate, isReleasePage };
