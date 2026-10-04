$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskPython=Join-Path $taskRoot '.backend-build\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
  python -m venv .backend-build
  if($LASTEXITCODE -ne 0) { throw 'Python 3.12+ is required to build the backend.' }
}
& $taskPython -m pip install --disable-pip-version-check -r backend/requirements.txt
if($LASTEXITCODE -ne 0) { throw 'Backend dependencies failed.' }
& $taskPython -m PyInstaller --noconfirm --clean --onedir --console --name QingyeWorker --distpath backend/bin --workpath .backend-build/pyinstaller --specpath .backend-build --collect-all pymupdf --collect-all docx --collect-all openpyxl --collect-all pptx backend/worker.py
if($LASTEXITCODE -ne 0) { throw 'Backend packaging failed.' }
& $taskPython scripts/collect-licenses.py
if($LASTEXITCODE -ne 0) { throw 'License collection failed.' }
