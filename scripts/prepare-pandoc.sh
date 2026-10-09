#!/usr/bin/env bash
# Downloads the official Pandoc 3.12 for macOS / Linux, verifies its SHA-256 and places the
# unmodified executable at vendor/pandoc/pandoc (not committed; see .gitignore). Windows uses
# prepare-pandoc.ps1. Linux sums were verified against the release downloads on 2026-10-09.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version=3.12
os="$(uname -s)"
[ "$os" = "Darwin" ] || [ "$os" = "Linux" ] || { echo "prepare-pandoc.sh is for macOS/Linux; on Windows run scripts/prepare-pandoc.ps1." >&2; exit 1; }
case "$os" in
  Darwin)
    case "${QINGYE_ARCH:-$(uname -m)}" in
      arm64|aarch64) asset="pandoc-$version-arm64-macOS.zip";  sum=f148ca09c9f36594db527a9fc988ad736290ce428f79594c50208cd1ec58b3c0; folder="pandoc-$version-arm64" ;;
      x86_64|x64)    asset="pandoc-$version-x86_64-macOS.zip"; sum=18577f9460c3dc5d2651ad3bab37d513bc2034a5a777fbe18fa0a5acf2e936ea; folder="pandoc-$version-x86_64" ;;
      *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac ;;
  Linux)
    case "$(uname -m)" in
      x86_64)          asset="pandoc-$version-linux-amd64.tar.gz"; sum=67d7d011fed8c8543306022b985b9b2499ab9b74818df91d8727c7e9ebc5ba06; folder="pandoc-$version" ;;
      aarch64|arm64)   asset="pandoc-$version-linux-arm64.tar.gz"; sum=6cefcf7100e23a99447c26f89d1ff5b253f3407fcef99a9e27ae06f3ed16cb82; folder="pandoc-$version" ;;
      *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac ;;
esac
target="$root/vendor/pandoc/pandoc"
stamp="$root/vendor/pandoc/.unix-asset"
if [ -x "$target" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$sum" ]; then echo "Verified bundled Pandoc $version."; exit 0; fi
stage="$(mktemp -d "${TMPDIR:-/tmp}/qingye-pandoc-XXXXXX")"
trap 'rm -rf "$stage"' EXIT
curl --fail --location --silent --show-error -o "$stage/pandoc.download" "https://github.com/jgm/pandoc/releases/download/$version/$asset"
actual="$(shasum -a 256 "$stage/pandoc.download" | cut -d' ' -f1)"
[ "$actual" = "$sum" ] || { echo "Pandoc download checksum mismatch: $actual" >&2; exit 1; }
mkdir -p "$stage/unpacked" "$root/vendor/pandoc"
case "$asset" in
  *.zip) unzip -q "$stage/pandoc.download" -d "$stage/unpacked" ;;
  *.tar.gz) tar -xzf "$stage/pandoc.download" -C "$stage/unpacked" ;;
esac
cp "$stage/unpacked/$folder/bin/pandoc" "$target"
chmod 755 "$target"
printf '%s' "$sum" > "$stamp"
"$target" --version | head -1
echo "Prepared verified Pandoc $version."
