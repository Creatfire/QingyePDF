"""Download exact upstream source distributions; never execute downloaded files."""
import hashlib
import json
import tarfile
import urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]
folder=root/'third-party-source'
folder.mkdir(exist_ok=True)
index=[]
packages={'pymupdf':'1.28.2','python-docx':'1.2.0','openpyxl':'3.1.5','python-pptx':'1.0.2','pillow':'12.3.0','lxml':'6.1.3','typing_extensions':'4.16.0','et-xmlfile':'2.0.0','xlsxwriter':'3.2.9','pyinstaller':'6.22.3'}
for name,version in packages.items():
    with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json') as response:
        release=json.load(response)
    source=next(item for item in release['urls'] if item['packagetype']=='sdist')
    target=folder/source['filename']
    if not target.exists():urllib.request.urlretrieve(source['url'],target)
    checksum=hashlib.sha256(target.read_bytes()).hexdigest()
    if checksum!=source['digests']['sha256']:raise RuntimeError(f'Checksum mismatch: {name}')
    index.append({'name':name,'version':version,'file':target.name,'sha256':checksum,'url':source['url']})
    print(name,version,target.stat().st_size,flush=True)
    if name=='pymupdf':
        with tarfile.open(target) as archive:
            bundled=[entry.name for entry in archive.getmembers() if entry.name.endswith(('.tgz','.tar.gz')) and 'mupdf' in entry.name.lower()]
            index[-1]['bundledMuPDFSources']=bundled
url='https://casper.mupdf.com/downloads/archive/mupdf-1.28.2-source.tar.gz'
target=folder/'mupdf-1.28.2-source.tar.gz'
if not target.exists():urllib.request.urlretrieve(url,target)
index.append({'name':'mupdf','version':'1.28.2','file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'url':url})
print('mupdf',target.stat().st_size,flush=True)
diagram_packages={'flowchart.js':'1.18.0','raphael':'2.3.0','eve-raphael':'0.5.0','underscore':'1.13.8'}
for name,version in diagram_packages.items():
    url=f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'
    target=folder/f'{name}-{version}.tgz'
    if not target.exists():urllib.request.urlretrieve(url,target)
    index.append({'name':name,'version':version,'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'url':url})
    print(name,version,target.stat().st_size,flush=True)
url='https://codeload.github.com/bramp/js-sequence-diagrams/tar.gz/a6c252b2ed0d1e6b1d16be066f582afd2895e6c9'
target=folder/'js-sequence-diagrams-2.0.1.tar.gz'
if not target.exists():urllib.request.urlretrieve(url,target)
index.append({'name':'js-sequence-diagrams','version':'2.0.1','commit':'a6c252b2ed0d1e6b1d16be066f582afd2895e6c9','file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'url':url})
print('js-sequence-diagrams',target.stat().st_size,flush=True)
(folder/'sources.json').write_text(json.dumps(index,indent=2),encoding='utf-8')
