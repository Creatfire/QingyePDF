"""Restore pinned source archives from previous deliveries or their recorded upstream URLs."""
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
folder = root / 'third-party-source'
records = json.loads((folder / 'sources.json').read_text(encoding='utf-8'))
archives = sorted(root.parent.glob('*dependency-source.zip'), reverse=True)
for record in records:
    target = folder / record['file']
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == record['sha256']:
        print('verified', target.name, flush=True)
        continue
    found = False
    for old in archives:
        with zipfile.ZipFile(old) as archive:
            name = next((name for name in archive.namelist() if Path(name).name == target.name), None)
            if name:
                data = archive.read(name)
                if hashlib.sha256(data).hexdigest() == record['sha256']:
                    target.write_bytes(data)
                    found = True
                    break
    if not found:
        with urllib.request.urlopen(record['url'], timeout=120) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != record['sha256']:
            raise RuntimeError('Source checksum mismatch: ' + target.name)
        target.write_bytes(data)
    print('prepared', target.name, target.stat().st_size, flush=True)
