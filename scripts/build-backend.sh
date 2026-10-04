#!/usr/bin/env bash
# Freezes the PDF toolbox backend (backend/worker.py) with PyInstaller for macOS / Linux.
# Output: backend/bin/QingyeWorker/QingyeWorker (not committed). Windows uses build-backend.ps1.
set -euo pipefail
cd "$(dirname "$0")/.."
python=.backend-build/bin/python
if [ ! -x "$python" ]; then "${PYTHON:-python3}" -m venv .backend-build; fi
"$python" -m pip install --disable-pip-version-check -r backend/requirements.txt
"$python" -m PyInstaller --noconfirm --clean --onedir --console --name QingyeWorker \
  --distpath backend/bin --workpath .backend-build/pyinstaller --specpath .backend-build \
  --collect-all pymupdf --collect-all docx --collect-all openpyxl --collect-all pptx backend/worker.py
test -x backend/bin/QingyeWorker/QingyeWorker
# The committed licence texts were collected on Windows; refresh them when the script can.
"$python" scripts/collect-licenses.py || echo "warning: licence collection skipped on this platform" >&2
echo "Backend ready: backend/bin/QingyeWorker/QingyeWorker"
