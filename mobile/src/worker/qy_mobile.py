# SPDX-License-Identifier: AGPL-3.0-only
"""Android glue around the shared backend/worker.py.

worker.py runs unchanged inside Pyodide. The only desktop facility missing from the WebAssembly
build of PyMuPDF is its built-in Tesseract, so Pixmap.pdfocr_tobytes is provided here on top of
the Tesseract WebAssembly module that the hosting Web Worker exposes as qingye_js.ocr().
"""
import json
import shutil
import traceback
from pathlib import Path

import pymupdf as fitz
import qingye_js
import worker


def _pdfocr_tobytes(self, compress=True, language='eng', tessdata=None):
    """One-page PDF: the pixmap as the page image plus an invisible, selectable text layer."""
    xres = self.xres if self.xres and self.xres > 1 else 72
    yres = self.yres if self.yres and self.yres > 1 else xres
    sx, sy = 72 / xres, 72 / yres
    tsv = qingye_js.ocr(self.tobytes('png'), language or 'eng')
    doc = fitz.open()
    page = doc.new_page(width=self.width * sx, height=self.height * sy)
    page.insert_image(page.rect, pixmap=self)
    shape = page.new_shape()
    previous = None
    for row in str(tsv).splitlines():
        cells = row.split('\t')
        if len(cells) < 12 or cells[0] != '5':
            continue
        text = cells[11].strip()
        if not text:
            continue
        left, top, width, height = (float(v) for v in cells[6:10])
        if width <= 0 or height <= 0:
            continue
        line = tuple(cells[1:5])
        # Words on one line are separated by a space so that copied text keeps its word breaks.
        if previous == line and text.isascii():
            text = ' ' + text
        previous = line
        natural = fitz.get_text_length(text, fontname='china-s', fontsize=1) or 1
        size = max(height * sy * .5, min(width * sx / natural, height * sy * 1.3))
        try:
            shape.insert_text((left * sx, (top + height * .82) * sy), text, fontname='china-s', fontsize=size, render_mode=3)
        except Exception:
            continue
    shape.commit()
    data = doc.tobytes(garbage=3, deflate=bool(compress))
    doc.close()
    return data


fitz.Pixmap.pdfocr_tobytes = _pdfocr_tobytes


def _progress(done, total, label=''):
    qingye_js.progress(json.dumps({'done': done, 'total': total, 'label': label}, ensure_ascii=False))


worker.progress = _progress


def run_job(config_text):
    job = json.loads(config_text)
    output = Path(job['output'])
    shutil.rmtree(output, ignore_errors=True)
    try:
        result = worker.process(job['request'], Path(job['input']), output)
        _progress(1, 1, '完成')
        return json.dumps({'ok': True, **result}, ensure_ascii=False)
    except MemoryError:
        return json.dumps({'ok': False, 'error': '内存不足：文件过大，手机无法完成此操作。'}, ensure_ascii=False)
    except Exception as error:  # the message is shown to the user, as on the desktop
        traceback.print_exc()
        return json.dumps({'ok': False, 'error': str(error) or error.__class__.__name__}, ensure_ascii=False)
