#!/usr/bin/env bash
# Prepare the official macOS LibreOffice app, pinned to a checked release and architecture.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(uname -s)" = Darwin ] || { echo 'This script requires macOS.' >&2; exit 1; }
version=26.2.6
case "${QINGYE_ARCH:-$(uname -m)}" in
  arm64|aarch64) arch=aarch64; sum=94bb3248df074c225490a8a6d1d9dc87c7d6783dbb7a8e9f0d0c3d94348552af ;;
  x86_64|x64) arch=x86-64; sum=135b8a95b8133396d54bf8e726dbc0066145efa0d785963fc3d4592acbfcfe5b ;;
  *) echo 'Unsupported architecture.' >&2; exit 1 ;;
esac
asset="LibreOffice_${version}_MacOS_${arch}.dmg"
url="https://download.documentfoundation.org/libreoffice/stable/$version/mac/$([ "$arch" = aarch64 ] && echo aarch64 || echo x86_64)/$asset"
dest="$root/vendor/libreoffice"
if [ -x "$dest/LibreOffice.app/Contents/MacOS/soffice" ] && [ "$(cat "$dest/.macos-asset" 2>/dev/null)" = "$sum" ]; then echo "LibreOffice $version is prepared."; exit 0; fi
stage="$(mktemp -d "${TMPDIR:-/tmp}/qingye-lo-XXXXXX")"
mount="$stage/mount"
cleanup() { hdiutil detach "$mount" -quiet 2>/dev/null || true; rm -rf "$stage"; }
trap cleanup EXIT
curl --fail --location --silent --show-error -o "$stage/lo.dmg" "$url"
actual="$(shasum -a 256 "$stage/lo.dmg" | cut -d' ' -f1)"
[ "$actual" = "$sum" ] || { echo "LibreOffice checksum mismatch: $actual" >&2; exit 1; }
mkdir "$mount"
hdiutil attach "$stage/lo.dmg" -nobrowse -readonly -mountpoint "$mount" -quiet
test -x "$mount/LibreOffice.app/Contents/MacOS/soffice"
mkdir "$stage/libreoffice"
ditto "$mount/LibreOffice.app" "$stage/libreoffice/LibreOffice.app"
printf '%s' "$sum" > "$stage/libreoffice/.macos-asset"
printf '{"name":"LibreOffice","version":"%s","architecture":"%s","source":"%s","sha256":"%s"}\n' "$version" "$arch" "$url" "$sum" > "$stage/libreoffice/manifest.json"
mkdir -p "$root/vendor"
rm -rf "$dest"
mv "$stage/libreoffice" "$dest"
echo "Prepared LibreOffice $version ($arch)."
