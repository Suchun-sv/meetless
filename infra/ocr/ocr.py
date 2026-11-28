"""OCR one image or PDF: prints {"pages": [text, ...]} as JSON. Usage: ocr.py <file> [max_pages]"""
import glob, json, os, subprocess, sys, tempfile
from rapidocr_onnxruntime import RapidOCR

engine = RapidOCR()


def page_text(path):
    result, _ = engine(path)
    boxes = sorted(result or [], key=lambda r: (round(r[0][0][1] / 12), r[0][0][0]))
    lines, last_y, row = [], None, []
    for box, text, _score in boxes:
        y = box[0][1]
        if last_y is not None and abs(y - last_y) > 12:
            lines.append(' '.join(row))
            row = []
        row.append(text)
        last_y = y
    if row:
        lines.append(' '.join(row))
    return '\n'.join(lines)


def main():
    path = sys.argv[1]
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    if path.lower().endswith('.pdf'):
        out = tempfile.mkdtemp()
        subprocess.run(['pdftoppm', '-r', '200', '-l', str(max_pages), '-png', path, os.path.join(out, 'p')], check=True, capture_output=True)
        pages = sorted(glob.glob(os.path.join(out, 'p-*.png')), key=lambda p: int(p.rsplit('-', 1)[1][:-4]))
        texts = [page_text(p) for p in pages]
    else:
        texts = [page_text(path)]
    print(json.dumps({'pages': texts}, ensure_ascii=False))


main()
