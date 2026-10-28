import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
sources = root / 'third-party-source'
manifest = sources / 'sources.json'
if not manifest.is_file():
    raise SystemExit('Missing third-party-source/sources.json. Run python scripts/prepare-sources.py first.')
records = json.loads(manifest.read_text(encoding='utf-8'))
required = {'pymupdf', 'mupdf', 'pandoc', 'python-docx', 'openpyxl', 'python-pptx', 'pillow', 'lxml', 'typing_extensions', 'et-xmlfile', 'xlsxwriter', 'pyinstaller', 'flowchart.js', 'raphael', 'eve-raphael', 'underscore', 'js-sequence-diagrams'}
if not isinstance(records, list) or not required.issubset({r.get('name') for r in records}):
    raise SystemExit('Dependency source manifest is incomplete. Run python scripts/prepare-sources.py.')
for record in records:
    name = record.get('file', '')
    if not name or Path(name).name != name:
        raise SystemExit(f'Invalid dependency source filename: {name!r}')
    source = sources / name
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != record.get('sha256'):
        raise SystemExit(f'Missing or corrupt dependency source: {name}')
items = [p.name for p in root.glob('*.cjs')] + ['package.json', 'package-lock.json', 'README.md', '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc', '.npmrc', '.oxlintrc.json', 'ui', 'vendor', 'scripts', 'build', 'test', 'backend', 'docs', '.github', 'mobile']
out = root / 'dist'
out.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out / f'QingyePDF-{version}-source.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for item in items:
        path = root / item
        files = path.rglob('*') if path.is_dir() else [path]
        for file in files:
            rel = file.relative_to(root)
            if not file.is_file() or set(rel.parts) & {'__pycache__', 'node_modules', 'www', '.gradle'} or rel.parts[:2] in [('backend', 'bin'), ('vendor', 'libreoffice')] or rel.parts[:3] == ('mobile', 'android', 'build') or rel.parts[:4] == ('mobile', 'android', 'app', 'build'):
                continue
            if rel.as_posix() in {'vendor/pandoc/pandoc.exe', 'vendor/pandoc/pandoc', 'vendor/pandoc/.macos-asset'}:
                continue
            archive.write(file, rel.as_posix())
    archive.write(manifest, 'third-party-source/sources.json')
with zipfile.ZipFile(out / f'QingyePDF-{version}-dependency-source.zip', 'w', zipfile.ZIP_STORED) as archive:
    archive.write(manifest, 'sources.json')
    for record in records:
        archive.write(sources / record['file'], record['file'])
print('Source archives created and dependency checksums verified.')
