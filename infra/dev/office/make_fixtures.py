#!/usr/bin/env python3
"""Generates the small, real PPTX/DOCX fixtures used by the tests (PRD §13 story).

Run inside the meetless-office container (python-pptx / python-docx available):
  infra/dev/deps.sh fixtures      -> writes fixtures/office/*.pptx|*.docx
The generated files are committed; tests never regenerate them.

v1 deck claims "all customer fields"; v1 design doc and the code support 12 core
fields. v2 of both narrows the scope (the decision of the PRD §13 meeting).
v2 doc inserts a paragraph at the top so paragraph indexes shift (re-anchoring by text)
and rewrites the last paragraph (a comment there must be marked "needs re-anchoring").
"""
import io
import os
import sys

from docx import Document
from docx.shared import Pt
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt as PPt

OUT = sys.argv[1] if len(sys.argv) > 1 else "/out"
FIELDS = "姓名、手机号、邮箱、公司、职位、城市、来源渠道、负责人、阶段、创建时间、最近联系时间、备注"


def fixed_core(props):
    # Deterministic metadata so regenerating produces the same content.
    import datetime

    t = datetime.datetime(2026, 11, 5, 10, 0, 0)
    props.author = "Meetless fixtures"
    props.created = t
    props.modified = t
    props.last_modified_by = "Meetless fixtures"
    props.revision = 1


def chart_png():
    img = Image.new("RGB", (480, 270), (245, 245, 240))
    for i, h in enumerate([80, 140, 200, 120]):
        for x in range(60 + i * 100, 120 + i * 100):
            for y in range(250 - h, 250):
                img.putpixel((x, y), (60, 90, 160))
    b = io.BytesIO()
    img.save(b, format="PNG")
    b.seek(0)
    return b


def deck(path, scope_line):
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = "客户数据导出方案 / Customer data export"
    s.placeholders[1].text = "C-24 · R-12 支持数据导出"

    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "范围 / Scope"
    body = s.placeholders[1].text_frame
    body.text = scope_line
    p = body.add_paragraph()
    p.text = "导出格式：CSV（UTF-8） / Format: CSV (UTF-8)"
    p = body.add_paragraph()
    p.text = "1 万行 30 秒内完成 / 10k rows within 30 s"

    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "导出性能 / Export performance"
    s.shapes.add_picture(chart_png(), Inches(1.5), Inches(2), width=Inches(6))
    tb = s.shapes.add_textbox(Inches(1.5), Inches(6), Inches(6), Inches(0.6))
    tb.text_frame.text = "基准测试结果见附录 / Benchmark results in the appendix"
    for para in tb.text_frame.paragraphs:
        for r in para.runs:
            r.font.size = PPt(14)

    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "时间表 / Timeline"
    s.placeholders[1].text = "11 月 20 日交付首版 / First delivery on 20 Nov"
    fixed_core(prs.core_properties)
    prs.save(path)


def design(path, revised):
    d = Document()
    d.add_heading("导出方案 / Export design", level=1)
    if revised:
        d.add_paragraph("修订说明：依据 11 月 8 日评审会议决定，范围限定为 12 个核心字段。 / Revision: scope limited to 12 core fields per the 8 Nov review meeting.")
    d.add_paragraph("目标：客户可以将客户数据导出为 CSV 文件。 / Goal: customers can export customer data as a CSV file.")
    d.add_paragraph("范围：导出 12 个核心字段（%s）。 / Scope: export 12 core fields." % FIELDS)
    d.add_paragraph("性能：1 万行数据 30 秒内完成导出。 / Performance: 10k rows exported within 30 seconds.")
    d.add_heading("字段 / Fields", level=2)
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "字段 / Field"
    t.rows[0].cells[1].text = "来源 / Source"
    for f, src in [("姓名 / Name", "crm.contacts.name"), ("手机号 / Phone", "crm.contacts.phone"), ("邮箱 / Email", "crm.contacts.email")]:
        r = t.add_row()
        r.cells[0].text = f
        r.cells[1].text = src
    if revised:
        p = d.add_paragraph("非核心字段（自定义字段、附件）将在二期评估。 / Custom fields and attachments will be assessed in phase 2.")
    else:
        p = d.add_paragraph("非核心字段（自定义字段、附件）不在本次范围内。 / Custom fields and attachments are out of scope.")
    for r in p.runs:
        r.font.size = Pt(10)
    fixed_core(d.core_properties)
    d.save(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    deck(os.path.join(OUT, "export-deck-v1.pptx"), "支持导出全部客户字段 / All customer fields can be exported")
    deck(os.path.join(OUT, "export-deck-v2.pptx"), "导出 12 个核心客户字段 / Export 12 core customer fields")
    design(os.path.join(OUT, "export-design-v1.docx"), revised=False)
    design(os.path.join(OUT, "export-design-v2.docx"), revised=True)
    with open(os.path.join(OUT, "corrupt.docx"), "wb") as f:
        f.write(b"PK\x03\x04 this is not a real word document")
    for n in sorted(os.listdir(OUT)):
        print(n, os.path.getsize(os.path.join(OUT, n)))


if __name__ == "__main__":
    main()
