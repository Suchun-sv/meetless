#!/usr/bin/env python3
"""meetless-office conversion service (runs inside the meetless-office container).

POST /convert?kind=pptx|docx   body = original file bytes
GET  /health

Response (JSON):
  status      "ready" | "partial" | "failed"
  error       failure code when status == "failed" (unreadable | timeout | too_large | unsupported)
  converter   identifies the tool versions (part of the derivation cache key on the server)
  pages       [{index, png(base64)}]             rendered pages (PDF via LibreOffice, PNG via pdftoppm)
  slides      [{index, slideId, title, text, notes, hidden}]     pptx only
  blocks      [{index, kind: paragraph|heading|table_row, style, text}]   docx only
  unparsed    ["<code>@<where>:<n>", ...]        parts the preview/review cannot see (coverage limits)

Text extraction never interprets document content: it is returned as data.
Stdlib HTTP server only; one temp dir and one LibreOffice profile per request.
"""
import argparse
import base64
import glob
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MAX_BYTES = 50 * 1024 * 1024
MAX_PAGES = 200
SOFFICE_TIMEOUT = 120
RENDER_SLOTS = threading.Semaphore(2)


def tool_versions():
    try:
        out = subprocess.run(["soffice", "--version"], capture_output=True, text=True, timeout=60).stdout.strip()
        lo = out.split()[1] if out else "unknown"
    except Exception:
        lo = "unknown"
    import pptx  # noqa: E402
    import docx  # noqa: E402

    return "meetless-office/1 libreoffice-%s python-pptx-%s python-docx-%s" % (
        lo,
        getattr(pptx, "__version__", "?"),
        getattr(docx, "__version__", "?"),
    )


CONVERTER = None


def shape_texts(shape, slide_no, unparsed):
    """Text of one shape (recursing into groups); records what cannot be read."""
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    out = []
    st = shape.shape_type
    if st == MSO_SHAPE_TYPE.GROUP:
        for s in shape.shapes:
            out.extend(shape_texts(s, slide_no, unparsed))
        return out
    if getattr(shape, "has_chart", False) and shape.has_chart:
        unparsed.append("chart@slide:%d" % slide_no)
        return out
    if st == MSO_SHAPE_TYPE.PICTURE:
        unparsed.append("image@slide:%d" % slide_no)
        return out
    if st in (MSO_SHAPE_TYPE.MEDIA,):
        unparsed.append("media@slide:%d" % slide_no)
        return out
    if getattr(shape, "has_table", False) and shape.has_table:
        for row in shape.table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                out.append(" | ".join(cells))
        return out
    if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
        for p in shape.text_frame.paragraphs:
            t = "".join(r.text for r in p.runs).strip()
            if t:
                out.append(t)
        return out
    if st not in (MSO_SHAPE_TYPE.PLACEHOLDER, MSO_SHAPE_TYPE.AUTO_SHAPE, MSO_SHAPE_TYPE.TEXT_BOX, MSO_SHAPE_TYPE.LINE):
        unparsed.append("object@slide:%d" % slide_no)
    return out


def extract_pptx(data):
    from pptx import Presentation

    prs = Presentation(io.BytesIO(data))
    slides, unparsed = [], []
    for i, slide in enumerate(prs.slides):
        n = i + 1
        title = ""
        if slide.shapes.title is not None and slide.shapes.title.has_text_frame:
            title = slide.shapes.title.text_frame.text.strip()
        lines = []
        for shape in slide.shapes:
            lines.extend(shape_texts(shape, n, unparsed))
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text.strip()
        hidden = slide._element.get("show") == "0"
        if hidden:
            unparsed.append("hidden@slide:%d" % n)
        slides.append({"index": n, "slideId": int(slide.slide_id), "title": title, "text": "\n".join(lines), "notes": notes, "hidden": hidden})
    return {"slides": slides, "unparsed": unparsed}


def extract_docx(data):
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    d = docx.Document(io.BytesIO(data))
    blocks, unparsed = [], []
    body = d.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(child, d)
            text = p.text.strip()
            has_drawing = bool(child.findall(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing"))
            if has_drawing:
                unparsed.append("image@paragraph:%d" % (len(blocks) + 1))
            if not text:
                continue
            style = p.style.name if p.style is not None else ""
            kind = "heading" if style.lower().startswith("heading") or style.lower() == "title" else "paragraph"
            blocks.append({"index": len(blocks) + 1, "kind": kind, "style": style, "text": text})
        elif tag == "tbl":
            t = Table(child, d)
            for row in t.rows:
                cells = [c.text.strip() for c in row.cells]
                if any(cells):
                    blocks.append({"index": len(blocks) + 1, "kind": "table_row", "style": "table", "text": " | ".join(cells)})
        elif tag == "sectPr":
            continue
        else:
            unparsed.append("object@paragraph:%d" % (len(blocks) + 1))
    for s in d.sections:
        for part in (s.header, s.footer):
            if part is not None and not part.is_linked_to_previous and any(p.text.strip() for p in part.paragraphs):
                unparsed.append("header_footer@document:1")
                break
    # Comments, footnotes and tracked changes are not read in this version.
    return {"blocks": blocks, "unparsed": sorted(set(unparsed), key=unparsed.index)}


def render(data, kind):
    """original -> PDF (LibreOffice) -> PNG per page (pdftoppm). Returns (pages, unparsed)."""
    with RENDER_SLOTS:
        tmp = tempfile.mkdtemp(prefix="mlo-")
        try:
            src = os.path.join(tmp, "input." + kind)
            with open(src, "wb") as f:
                f.write(data)
            profile = "file://" + os.path.join(tmp, "profile")
            subprocess.run(
                ["soffice", "-env:UserInstallation=" + profile, "--headless", "--norestore", "--nologo", "--convert-to", "pdf", "--outdir", tmp, src],
                capture_output=True,
                timeout=SOFFICE_TIMEOUT,
                check=False,
            )
            pdf = os.path.join(tmp, "input.pdf")
            if not os.path.exists(pdf):
                return [], ["render_failed@document:1"]
            subprocess.run(["pdftoppm", "-png", "-r", "60", "-l", str(MAX_PAGES), pdf, os.path.join(tmp, "page")], capture_output=True, timeout=SOFFICE_TIMEOUT, check=True)
            files = sorted(glob.glob(os.path.join(tmp, "page-*.png")), key=lambda p: int(p.rsplit("-", 1)[1].split(".")[0]))
            pages = []
            for i, p in enumerate(files):
                with open(p, "rb") as f:
                    pages.append({"index": i + 1, "png": base64.b64encode(f.read()).decode("ascii")})
            info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, timeout=30).stdout
            total = next((int(l.split()[-1]) for l in info.splitlines() if l.startswith("Pages:")), len(pages))
            return pages, (["pages_truncated@document:%d" % MAX_PAGES] if total > len(pages) else [])
        except subprocess.TimeoutExpired:
            return [], ["render_timeout@document:1"]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def convert(data, kind):
    base = {"converter": CONVERTER, "kind": kind, "pages": [], "slides": [], "blocks": [], "unparsed": []}
    if kind not in ("pptx", "docx"):
        return dict(base, status="failed", error="unsupported")
    if len(data) > MAX_BYTES:
        return dict(base, status="failed", error="too_large")
    if not zipfile.is_zipfile(io.BytesIO(data)):
        return dict(base, status="failed", error="unreadable")
    try:
        ext = extract_pptx(data) if kind == "pptx" else extract_docx(data)
    except Exception as e:  # corrupt / not really an OOXML file of this kind
        return dict(base, status="failed", error="unreadable", detail=type(e).__name__)
    pages, render_unparsed = render(data, kind)
    unparsed = ext["unparsed"] + render_unparsed
    if kind == "pptx" and pages and len(pages) != len([s for s in ext["slides"] if not s["hidden"]]):
        unparsed.append("page_count_mismatch@document:1")
    out = dict(base, status="partial" if unparsed else "ready", pages=pages, unparsed=unparsed)
    out.update({k: v for k, v in ext.items() if k != "unparsed"})
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "meetless-office/1"

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._json(200, {"ok": True, "converter": CONVERTER})
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/convert":
            return self._json(404, {"error": "not_found"})
        kind = (parse_qs(u.query).get("kind") or [""])[0]
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_BYTES:
            return self._json(200, {"converter": CONVERTER, "kind": kind, "status": "failed", "error": "too_large", "pages": [], "slides": [], "blocks": [], "unparsed": []})
        data = self.rfile.read(n)
        self._json(200, convert(data, kind))

    def log_message(self, fmt, *args):
        pass


def main():
    global CONVERTER
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    CONVERTER = tool_versions()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print("meetless-office listening on %s:%d (%s)" % (a.host, a.port, CONVERTER), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
