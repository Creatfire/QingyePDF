import json
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
items=['main.cjs','preload.cjs','core.cjs','offline.cjs','recovery.cjs','diagnostics.cjs','markdown-files.cjs','markdown-tools.cjs','markdown-ipc.cjs','pandoc-engine.cjs','converter-ipc.cjs','CONVERSION.md','RELEASE-TARGET.json','i18n-main.cjs','file-associations.cjs','ai-service.cjs','ai-api-server.cjs','ai-ipc.cjs','package.json','package-lock.json','LICENSE','LICENSE-MIT','THIRD_PARTY_NOTICES.md','README.md','FEATURES.md','CHANGELOG.md','.gitignore','ui','vendor','scripts','build','test','backend']
items.extend(['HANDOFF.md','converter-presets.cjs','notes-markdown.cjs','library-index.cjs','docs','CONTRIBUTING.md','.github','.gitattributes','.editorconfig','mobile/README.md'])
output=root/'dist'/f'QingyePDF-{version}-source.zip'
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for item in items:
        path=root/item
        files=path.rglob('*') if path.is_dir() else [path]
        for file in files:
            rel=file.relative_to(root)
            if not file.is_file() or '__pycache__' in rel.parts or rel.parts[:2]==('backend','bin'):continue
            if rel.as_posix()=='vendor/pandoc/pandoc.exe':continue
            archive.write(file,rel.as_posix())
    if (root/'third-party-source'/'sources.json').exists():archive.write(root/'third-party-source'/'sources.json','third-party-source/sources.json')
with zipfile.ZipFile(root/'dist'/f'QingyePDF-{version}-dependency-source.zip','w',zipfile.ZIP_STORED) as archive:
    for file in (root/'third-party-source').glob('*'):
        if file.is_file():archive.write(file,file.name)
print('Source archives created.')
