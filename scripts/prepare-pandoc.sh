#!/usr/bin/env bash
# Downloads the official Pandoc 3.12 for macOS, verifies its SHA-256 and places the unmodified
# executable at vendor/pandoc/pandoc (not committed; see .gitignore). Windows uses prepare-pandoc.ps1.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version=3.12
[ "$(uname -s)" = "Darwin" ] || { echo "prepare-pandoc.sh is for macOS; on Windows run scripts/prepare-pandoc.ps1." >&2; exit 1; }
case "${QINGYE_ARCH:-$(uname -m)}" in
  arm64|aarch64) asset="pandoc-$version-arm64-macOS.zip";  sum=f148ca09c9f36594db527a9fc988ad736290ce428f79594c50208cd1ec58b3c0; folder="pandoc-$version-arm64" ;;
  x86_64|x64)    asset="pandoc-$version-x86_64-macOS.zip"; sum=18577f9460c3dc5d2651ad3bab37d513bc2034a5a777fbe18fa0a5acf2e936ea; folder="pandoc-$version-x86_64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
target="$root/vendor/pandoc/pandoc"
stamp="$root/vendor/pandoc/.macos-asset"
if [ -x "$target" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$sum" ]; then echo "Verified bundled Pandoc $version."; exit 0; fi
stage="$(mktemp -d "${TMPDIR:-/tmp}/qingye-pandoc-XXXXXX")"
trap 'rm -rf "$stage"' EXIT
curl --fail --location --silent --show-error -o "$stage/pandoc.zip" "https://github.com/jgm/pandoc/releases/download/$version/$asset"
actual="$(shasum -a 256 "$stage/pandoc.zip" | cut -d' ' -f1)"
[ "$actual" = "$sum" ] || { echo "Pandoc download checksum mismatch: $actual" >&2; exit 1; }
unzip -q "$stage/pandoc.zip" -d "$stage/unpacked"
mkdir -p "$root/vendor/pandoc"
cp "$stage/unpacked/$folder/bin/pandoc" "$target"
chmod 755 "$target"
printf '%s' "$sum" > "$stamp"
"$target" --version | head -1
echo "Prepared verified Pandoc $version."
