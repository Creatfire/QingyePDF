import importlib.metadata as metadata
import json
import shutil
import sys
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'backend' / 'licenses'
out.mkdir(exist_ok=True)
records = []
for dist in metadata.distributions():
    name = dist.metadata['Name']
    records.append({'name': name, 'version': dist.version, 'license': dist.metadata.get('License-Expression') or dist.metadata.get('License'), 'source': dist.metadata.get('Home-page'), 'urls': dist.metadata.get_all('Project-URL')})
    for file in dist.files or []:
        if '__pycache__' in str(file) or str(file).endswith(('.pyc', '.pyo')):
            continue
        if any(term in str(file).lower() for term in ('license','copying','notice')):
            source = Path(dist.locate_file(file))
            if source.is_file():
                folder = out / name
                folder.mkdir(exist_ok=True)
                shutil.copyfile(source, folder / str(file).replace('/','_').replace('\\','_'))
(out / 'packages.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
shutil.copyfile(root / 'LICENSE', out / 'AGPL-3.0.txt')
python_notice=Path(sys.base_prefix)/'LICENSE.txt'
if python_notice.exists():shutil.copyfile(python_notice,out/'CPython-LICENSE.txt')
source=root/'third-party-source'/'mupdf-1.28.2-source.tar.gz'
if source.exists():
    notices=out/'MuPDF'
    notices.mkdir(exist_ok=True)
    with tarfile.open(source) as archive:
        for member in archive.getmembers():
            filename=Path(member.name).name.lower()
            if member.isfile() and member.size<2_000_000 and any(term in filename for term in ('license','copying','copyright','notice')):
                name=member.name.replace('/','_').replace('\\','_')
                (notices/name).write_bytes(archive.extractfile(member).read())
