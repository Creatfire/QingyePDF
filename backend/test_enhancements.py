"""Image enhancement and text-only OCR checks using visible PDF output."""
import io
import tempfile
from pathlib import Path
import pymupdf as fitz
from PIL import Image, ImageFilter, ImageStat, ImageDraw
from worker import process


def check():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='qingye-enhancement-') as folder:
        base = Path(folder)
        original = fitz.open()
        page = original.new_page(width=420, height=240)
        page.insert_text((30, 75), 'SCAN SELECT 789', fontsize=28)
        page.insert_text((30, 125), 'OFFLINE OCR TEST', fontsize=22)
        page.insert_text((30, 170), '中文文字识别', fontname='china-s', fontsize=22)
        reference = page.search_for('SCAN')[0]
        reference_center = fitz.Point((reference.x0+reference.x1)/2, (reference.y0+reference.y1)/2)
        pix = page.get_pixmap(dpi=144, alpha=False)
        blurred = Image.open(io.BytesIO(pix.tobytes('png'))).filter(ImageFilter.GaussianBlur(.7))
        image = io.BytesIO(); blurred.save(image, format='PNG')
        original.close()
        scan = base/'scanned.pdf'
        with fitz.open() as doc:
            for index, rotation in enumerate((0, 90, 270, 90)):
                if index == 3:
                    turned = io.BytesIO(); blurred.rotate(90, expand=True).save(turned, format='PNG')
                    p = doc.new_page(width=240, height=420)
                    p.insert_image(p.rect, stream=turned.getvalue())
                    p.set_rotation(rotation)
                    continue
                p = doc.new_page(width=420, height=240)
                p.insert_image(p.rect, stream=image.getvalue())
                p.set_rotation(rotation)
            doc.set_toc([[1, 'Scanned chapter', 1]])
            doc.set_metadata({'title': 'Preserve this title'})
            doc[0].add_rect_annot(fitz.Rect(10, 10, 25, 25)).update()
            doc.save(scan)
        before = fitz.open(stream=scan.read_bytes(), filetype='pdf')
        initial = [p.get_pixmap(dpi=144, alpha=False).samples for p in before]
        ocr_out = base/'ocr'
        result = process({'action':'ocr-layer', 'tessdata':str(root/'vendor/ocr')}, scan, ocr_out)
        assert result['files'] == ['result.pdf']
        with fitz.open(ocr_out/'result.pdf') as doc:
            assert len(doc) == 4 and doc.get_toc() == before.get_toc()
            assert doc.metadata['title'] == before.metadata['title']
            for index, page in enumerate(doc):
                assert page.rotation == before[index].rotation
                assert page.get_pixmap(dpi=144, alpha=False).samples == initial[index], 'OCR must not change visible pixels'
                text = page.get_text().upper()
                assert 'SCAN' in text and 'SELECT' in text and '789' in text, text
                word = page.search_for('SCAN')[0]
                center = fitz.Point((word.x0+word.x1)/2, (word.y0+word.y1)/2) * page.rotation_matrix
                expected = reference_center * page.rotation_matrix if index < 3 else reference_center
                assert abs(center.x-expected.x)<10 and abs(center.y-expected.y)<10, (index,center,expected)
                assert '中文' in page.get_text(), page.get_text()
                # Hidden text direction must align with the displayed scan,
                # including intrinsically rotated pages.
                spans = [line for block in page.get_text('dict')['blocks'] if block['type']==0 for line in block['lines']]
                assert spans
            assert len(list(doc[0].annots())) == 1
            doc.save(base/'ocr-saved.pdf')
        no_change = process({'action':'ocr-layer', 'tessdata':str(root/'vendor/ocr')}, base/'ocr-saved.pdf', base/'again')
        assert no_change['unchanged'], 'Do not add duplicate OCR text layers'
        sharp_out = base/'sharp'
        process({'action':'sharpen','strength':'standard'}, scan, sharp_out)
        with fitz.open(sharp_out/'result.pdf') as doc:
            assert len(doc)==4 and doc.get_toc()==before.get_toc()
            assert doc.metadata['title']==before.metadata['title']
            assert [p.rotation for p in doc]==[0,90,270,90]
            assert len(list(doc[0].annots()))==1
            enhanced = Image.open(io.BytesIO(doc.extract_image(doc[0].get_images()[0][0])['image'])).convert('L')
            a = ImageStat.Stat(blurred.convert('L').filter(ImageFilter.FIND_EDGES)).var[0]
            b = ImageStat.Stat(enhanced.filter(ImageFilter.FIND_EDGES)).var[0]
            assert b > a, (a,b)
        # Existing vector text must survive sharpening.
        with fitz.open(scan) as doc:
            doc[0].insert_text((30, 220),'EXISTING VECTOR',fontsize=12)
            doc.save(base/'mixed.pdf')
        process({'action':'sharpen','strength':'mild'},base/'mixed.pdf',base/'mixed-out')
        with fitz.open(base/'mixed-out/result.pdf') as doc:
            assert 'EXISTING VECTOR' in doc[0].get_text()
        transparent=Image.new('RGBA',(120,80),(0,0,0,0));ImageDraw.Draw(transparent).rectangle((15,15,100,65),fill=(255,20,20,128))
        buffer=io.BytesIO();transparent.save(buffer,format='PNG')
        with fitz.open() as doc:
            p=doc.new_page(width=120,height=80);p.insert_image(p.rect,stream=buffer.getvalue());doc.save(base/'alpha.pdf')
        process({'action':'sharpen','strength':'strong'},base/'alpha.pdf',base/'alpha-out')
        with fitz.open(base/'alpha-out/result.pdf') as doc:
            item=doc[0].get_images()[0];alpha=fitz.Pixmap(doc,item[1])
            assert alpha.samples==transparent.getchannel('A').tobytes(), 'Sharpening preserves transparency'
        before.close()
        print('ENHANCEMENT PASS: sharper edges; OCR pixel/rotation/outline/annotation preservation; selectable CJK/English; no duplicate layer')


if __name__ == '__main__':
    check()
