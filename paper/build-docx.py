#!/usr/bin/env python3
"""Build SkyGuard-IEEE-Paper.docx from skyguard-ieee-paper.html.

Produces a native Word document (no HTML import): one-column title block,
two-column IEEE body, native tables with booktabs rules, cropped Fig. 1 from
the rendered PDF, and hanging-indent references.

    python paper/build-docx.py
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from html.parser import HTMLParser

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, "skyguard-ieee-paper.html")
PDF = os.path.join(HERE, "SkyGuard-IEEE-Paper.pdf")
DOCX = os.path.join(HERE, "SkyGuard-IEEE-Paper.docx")

SERIF = "Times New Roman"
MONO = "Consolas"
COL_W = 3.5           # inches, one column of the two-column body
VOID = {"br", "img", "meta", "link", "hr"}


# --------------------------------------------------------------------------- #
# HTML tree
# --------------------------------------------------------------------------- #
class Node:
    __slots__ = ("tag", "attrs", "children", "text")

    def __init__(self, tag, attrs=None, text=""):
        self.tag = tag
        self.attrs = dict(attrs or {})
        self.children = []
        self.text = text

    @property
    def cls(self):
        return self.attrs.get("class", "")

    def find_all(self, tag=None, cls=None):
        for ch in self.children:
            if ch.tag == "#text":
                continue
            if (tag is None or ch.tag == tag) and (cls is None or cls in ch.cls.split()):
                yield ch
            yield from ch.find_all(tag, cls)


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(Node("#text", None, data))


def load(root_node=None):
    with open(HTML, encoding="utf-8") as fh:
        parser = Tree()
        parser.feed(fh.read())
        root = parser.root
    for node in root.find_all("div"):
        if "paper" in node.cls.split():
            return node
    raise SystemExit("could not find div.paper")


# --------------------------------------------------------------------------- #
# inline runs
# --------------------------------------------------------------------------- #
def collect(node, bold=False, italic=False, vert=None, out=None):
    """Flatten inline HTML into (text, bold, italic, vert) tuples."""
    out = [] if out is None else out
    for ch in node.children:
        if ch.tag == "#text":
            out.append((ch.text, bold, italic, vert))
        elif ch.tag == "br":
            out.append(("\n", bold, italic, vert))
        elif ch.tag in ("i", "em"):
            collect(ch, bold, True, vert, out)
        elif ch.tag in ("b", "strong"):
            collect(ch, bold, italic, vert, out)
        elif ch.tag in ("sup", "sub"):
            collect(ch, bold, italic, ch.tag, out)
        else:  # span, a
            collect(ch, bold, italic, vert, out)
    return out


def write_runs(par, node, size=10.0, bold=False, italic=False,
               font=SERIF, small_caps=False):
    pieces = collect(node, bold, italic)
    # collapse whitespace, then trim the paragraph's outer spaces
    flat = []
    for text, b, i, v in pieces:
        if text == "\n":
            flat.append(("\n", b, i, v))
        else:
            flat.append((re.sub(r"\s+", " ", text), b, i, v))
    joined_bold = bold
    if flat:
        first = flat[0][0].lstrip()
        flat[0] = (first, *flat[0][1:])
        last = flat[-1][0].rstrip()
        flat[-1] = (last, *flat[-1][1:])
    prev_space = True
    for text, b, i, v in flat:
        if text == "\n":
            par.add_run().add_break()
            prev_space = True
            continue
        if not text:
            continue
        if prev_space:
            text = text.lstrip()
            if not text:
                continue
        prev_space = text.endswith(" ")
        run = par.add_run(text)
        run.font.name = font
        run.font.size = Pt(size)
        run.bold = b or joined_bold
        run.italic = i
        if small_caps:
            run.font.small_caps = True
        if v == "sup":
            run.font.superscript = True
        elif v == "sub":
            run.font.subscript = True
    return par


def para(doc_or_cell, *, align="justify", size=10.0, indent=0.18,
         before=0.0, after=0.0, line=None, keep_next=False, left=0.0,
         hanging=0.0, space_line=1.0):
    par = doc_or_cell.add_paragraph()
    fmt = par.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.first_line_indent = Inches(indent)
    fmt.left_indent = Inches(left)
    fmt.line_spacing = space_line
    fmt.alignment = {"justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
                     "center": WD_ALIGN_PARAGRAPH.CENTER,
                     "right": WD_ALIGN_PARAGRAPH.RIGHT,
                     "left": WD_ALIGN_PARAGRAPH.LEFT}[align]
    fmt.keep_with_next = keep_next
    fmt.widow_control = True
    return par


# --------------------------------------------------------------------------- #
# tables
# --------------------------------------------------------------------------- #
def _insert(tblPr, elm, *successors):
    tblPr.insert_element_before(elm, *successors)


def style_table(table, ncols):
    tblPr = table._tbl.tblPr

    width = OxmlElement("w:tblW")
    width.set(qn("w:type"), "pct")
    width.set(qn("w:w"), "5000")
    _insert(tblPr, width, "w:jc", "w:tblCellSpacing", "w:tblInd",
            "w:tblBorders", "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook")

    borders = OxmlElement("w:tblBorders")
    for edge, val, sz in (("top", "single", 8), ("left", "nil", 0),
                          ("bottom", "single", 8), ("right", "nil", 0),
                          ("insideH", "nil", 0), ("insideV", "nil", 0)):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), val)
        if sz:
            e.set(qn("w:sz"), str(sz))
            e.set(qn("w:space"), "0")
            e.set(qn("w:color"), "000000")
        borders.append(e)
    _insert(tblPr, borders, "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook")

    margins = OxmlElement("w:tblCellMar")
    for side, w in (("top", 10), ("left", 50), ("bottom", 10), ("right", 50)):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:w"), str(w))
        e.set(qn("w:type"), "dxa")
        margins.append(e)
    _insert(tblPr, margins, "w:tblLook")

    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True

    for idx, row in enumerate(table.rows):
        trPr = row._tr.get_or_add_trPr()
        trPr.append(OxmlElement("w:cantSplit"))
        if idx == 0:  # repeat the head row when a table continues on a new page
            trPr.append(OxmlElement("w:tblHeader"))


def header_rule(row):
    for cell in row.cells:
        tcPr = cell._tc.get_or_add_tcPr()
        b = OxmlElement("w:tcBorders")
        e = OxmlElement("w:bottom")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), "4")
        e.set(qn("w:space"), "0")
        e.set(qn("w:color"), "000000")
        b.append(e)
        tcPr.append(b)


def add_table(cell_parent, node):
    thead = body = None
    for ch in node.children:
        if ch.tag == "thead":
            thead = ch
        elif ch.tag == "tbody":
            body = ch
    rows = []
    for part in (thead, body):
        if part is None:
            continue
        for tr in part.children:
            if tr.tag != "tr":
                continue
            rows.append([c for c in tr.children if c.tag in ("td", "th")])
    if not rows:
        return
    ncols = max(len(r) for r in rows)
    table = cell_parent.add_table(rows=len(rows), cols=ncols)
    style_table(table, ncols)

    for r_idx, cells in enumerate(rows):
        for c_idx in range(ncols):
            cell = table.cell(r_idx, c_idx)
            cell.paragraphs[0]._element.getparent().remove(cell.paragraphs[0]._element)
            src = cells[c_idx] if c_idx < len(cells) else None
            align = "left"
            if src is not None:
                cls = src.cls.split()
                if "n" in cls:
                    align = "right"
                elif "c" in cls:
                    align = "center"
            par = para(cell, align=align, size=7.5, indent=0.0)
            if src is not None:
                write_runs(par, src, size=7.5, bold=(src.tag == "th"))
    if thead is not None:
        header_rule(table.rows[0])


# --------------------------------------------------------------------------- #
# figure 1 (crop from the rendered PDF)
# --------------------------------------------------------------------------- #
def crop_figure(out_png):
    import pymupdf

    doc = pymupdf.open(PDF)
    for page in doc:
        hits = page.search_for("Layered data flow")
        if not hits:
            continue
        cap = hits[0]
        half = page.rect.width / 2
        boxes = []
        for d in page.get_drawings():
            r = pymupdf.Rect(d["rect"])
            if (r.x1 <= half + 6 and r.y1 <= cap.y0 - 1 and r.y0 < cap.y0
                    and r.width > 60 and r.height > 10):
                boxes.append(r)
        if not boxes:
            continue
        clip = boxes[0]
        for r in boxes[1:]:
            clip |= r
        clip = pymupdf.Rect(clip.x0 - 2, clip.y0 - 2, clip.x1 + 2, clip.y1 + 2)
        page.get_pixmap(clip=clip, dpi=400).save(out_png)
        return
    raise SystemExit("Fig. 1 not found in the PDF")


# --------------------------------------------------------------------------- #
# document
# --------------------------------------------------------------------------- #
def setup(doc):
    sec = doc.sections[0]
    sec.page_width = Inches(8.5)
    sec.page_height = Inches(11)
    sec.top_margin = Inches(0.75)
    sec.bottom_margin = Inches(1.0)
    sec.left_margin = Inches(0.625)
    sec.right_margin = Inches(0.625)
    sec.header_distance = Inches(0.4)
    sec.footer_distance = Inches(0.4)

    normal = doc.styles["Normal"]
    normal.font.name = SERIF
    normal.font.size = Pt(10)
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), SERIF)
    pf = normal.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing = 1.0

    doc.core_properties.title = ("SkyGuard AI: Source-Aware Anomaly Triage for "
                                 "Automatic Weather Station Networks")
    doc.core_properties.author = "SkyGuard AI Project"
    doc.core_properties.subject = "IEEE conference paper"


def set_columns(section, num, space_twips=360):
    sectPr = section._sectPr
    cols = sectPr.find(qn("w:cols"))
    if cols is None:
        cols = OxmlElement("w:cols")
        sectPr.append(cols)
    cols.set(qn("w:num"), str(num))
    cols.set(qn("w:space"), str(space_twips))
    cols.set(qn("w:equalWidth"), "1")


def title_block(doc, paper):
    block = next(n for n in paper.children if "titleblock" in n.cls.split())

    title = next(n for n in block.children if n.tag == "h1")
    par = para(doc, align="center", size=22, indent=0.0, after=10, line=1.05)
    write_runs(par, title, size=22)

    authors = next(n for n in block.children if "authors" in n.cls.split())
    for span in authors.children:
        if span.tag != "span":
            continue
        cls = span.cls.split()
        if "name" in cls:
            par = para(doc, align="center", size=11, indent=0.0, after=2)
            write_runs(par, span, size=11)
        elif "aff" in cls:
            par = para(doc, align="center", size=9.5, indent=0.0, after=1)
            write_runs(par, span, size=9.5, italic=True)
        elif "mail" in cls:
            par = para(doc, align="center", size=9, indent=0.0, after=9)
            write_runs(par, span, size=9)

    note = next(n for n in block.children if "firstnote" in n.cls.split())
    par = para(doc, align="justify", size=8, indent=0.0, after=8, line=1.1)
    write_runs(par, note, size=8)

    abstract = next(n for n in block.children if "abstract" in n.cls.split())
    par = para(doc, align="justify", size=9, indent=0.0, after=7, line=1.1)
    write_runs(par, abstract, size=9, bold=True)
    italicise_label(par)  # IEEE prints the label in italics, the text in bold

    keywords = next(n for n in block.children if "keywords" in n.cls.split())
    par = para(doc, align="justify", size=9, indent=0.0, after=10, line=1.1)
    write_runs(par, keywords, size=9, bold=True)
    italicise_label(par)


def italicise_label(par):
    """The first run is the italic label ("Abstract", "Index Terms")."""
    if par.runs and par.runs[0].text.strip() in ("Abstract", "Index Terms"):
        par.runs[0].italic = True


def heading(doc, node, level):
    par = para(doc, align="center", size=10, indent=0.0,
               before=8 if level == 2 else 5, after=3 if level == 2 else 1,
               keep_next=True, line=1.0)
    if level == 2:
        write_runs(par, node, size=10, small_caps=True)
    else:
        write_runs(par, node, size=10, italic=True)


def body_paragraph(doc, node, indent):
    par = para(doc, align="justify", size=10, indent=indent, after=0, line=1.06)
    write_runs(par, node, size=10)


def equation(doc, node):
    parts = [n for n in node.children if n.tag == "div"]
    body = next((p for p in parts if "body" in p.cls.split()), None)
    num = next((p for p in parts if "num" in p.cls.split()), None)
    par = para(doc, align="left", size=10, indent=0.0, before=1, after=3)
    par.paragraph_format.tab_stops.add_tab_stop(Inches(COL_W / 2),
                                                WD_TAB_ALIGNMENT.CENTER)
    par.paragraph_format.tab_stops.add_tab_stop(Inches(COL_W),
                                                WD_TAB_ALIGNMENT.RIGHT)
    par.add_run("\t")
    if body is not None:
        write_runs(par, body, size=10)
    par.add_run("\t")
    if num is not None:
        write_runs(par, num, size=10)


def code_block(doc, node):
    text = "".join(c.text for c in node.children if c.tag == "#text")
    lines = text.strip("\n").split("\n")
    for idx, line in enumerate(lines):
        par = doc.add_paragraph()
        fmt = par.paragraph_format
        fmt.space_before = Pt(0)
        fmt.space_after = Pt(0)
        fmt.left_indent = Inches(0.06)
        fmt.line_spacing = 1.0
        fmt.keep_with_next = idx < len(lines) - 1
        fmt.keep_together = True
        run = par.add_run(line if line else "")
        run.font.name = MONO
        run.font.size = Pt(7.5)


def table_figure(doc, node):
    cap = next(n for n in node.children if "tabcap" in n.cls.split())
    par = para(doc, align="center", size=8, indent=0.0, after=2, keep_next=True,
               line=1.05)
    first = True
    for ch in cap.children:
        if ch.tag == "span" and "num" in ch.cls.split():
            write_runs(par, ch, size=8, small_caps=True)
            first = False
        elif ch.tag == "br":
            par.add_run().add_break()
        elif ch.tag == "#text":
            text = ch.text.strip()
            if text:
                run = par.add_run(text.upper() if first else text)
                run.font.name = SERIF
                run.font.size = Pt(8)
                first = False
        else:
            write_runs(par, ch, size=8)
    table = next(n for n in node.children if n.tag == "table")
    add_table(doc, table)


def image_figure(doc, node, png):
    cap = next(n for n in node.children if n.tag == "figcaption")
    par = para(doc, align="center", size=10, indent=0.0, before=6, after=2,
               keep_next=True)
    par.add_run().add_picture(png, width=Inches(3.35))
    par2 = para(doc, align="center", size=8, indent=0.0, after=8, line=1.05)
    write_runs(par2, cap, size=8)


def contrib_list(doc, node):
    items = [li for li in node.children if li.tag == "li"]
    for i, li in enumerate(items, start=1):
        first = doc.add_paragraph()
        fmt = first.paragraph_format
        fmt.space_before = Pt(0)
        fmt.space_after = Pt(2)
        fmt.left_indent = Inches(0.26)
        fmt.first_line_indent = Inches(-0.26)
        fmt.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        fmt.line_spacing = 1.06
        run = first.add_run(f"{i}.")
        run.font.name = SERIF
        run.font.size = Pt(10)
        tab_run = first.add_run("\t")
        tab_run.font.name = SERIF
        tab_run.font.size = Pt(10)
        write_runs(first, li, size=10)


def references(doc, node):
    for p in node.children:
        if p.tag != "p":
            continue
        par = para(doc, align="justify", size=8, indent=-0.22, left=0.22,
                   after=1.5, line=1.05)
        write_runs(par, p, size=8)


def main():
    paper = load()
    tmp = tempfile.mkdtemp()
    png = os.path.join(tmp, "fig1.png")
    crop_figure(png)

    doc = Document()
    setup(doc)
    title_block(doc, paper)

    body = doc.add_section(WD_SECTION.CONTINUOUS)
    set_columns(body, 2)
    body.top_margin = Inches(0.75)
    body.bottom_margin = Inches(1.0)
    body.left_margin = Inches(0.625)
    body.right_margin = Inches(0.625)
    set_columns(doc.sections[0], 1)

    first_after_heading = False
    for node in paper.children:
        if node.tag == "#text":
            continue
        cls = node.cls.split()
        if node.tag == "div" and "titleblock" in cls:
            continue
        if node.tag == "h2":
            heading(doc, node, 2)
            first_after_heading = True
        elif node.tag == "h3":
            heading(doc, node, 3)
            first_after_heading = True
        elif node.tag == "p":
            if "srccap" in cls:
                par = para(doc, align="center", size=8, indent=0.0, after=8)
                write_runs(par, node, size=8)
            else:
                body_paragraph(doc, node, 0.0 if ("noindent" in cls or
                                                  first_after_heading) else 0.18)
                first_after_heading = False
        elif node.tag == "ol":
            contrib_list(doc, node)
            first_after_heading = False
        elif node.tag == "figure":
            if "tbl" in cls:
                table_figure(doc, node)
            else:
                image_figure(doc, node, png)
            first_after_heading = True
        elif node.tag == "div" and "eq" in cls:
            equation(doc, node)
            first_after_heading = False
        elif node.tag == "div" and "refs" in cls:
            references(doc, node)
            first_after_heading = False
        elif node.tag == "pre":
            code_block(doc, node)
            first_after_heading = True

    doc.save(DOCX)
    print("wrote", DOCX, round(os.path.getsize(DOCX) / 1024), "KB")
    print("paragraphs:", len(doc.paragraphs), "tables:", len(doc.tables),
          "sections:", len(doc.sections))


if __name__ == "__main__":
    sys.exit(main())
