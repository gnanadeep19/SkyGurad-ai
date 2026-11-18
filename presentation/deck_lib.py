"""Shared helpers for building the SkyGuard AI presentation."""
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_LABEL_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

NAVY = RGBColor(0x10, 0x2A, 0x43)
INK = RGBColor(0x1C, 0x2B, 0x39)
GREY = RGBColor(0x5C, 0x6B, 0x7A)
TEAL = RGBColor(0x00, 0x9E, 0x9E)
AMBER = RGBColor(0xD9, 0x82, 0x25)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
CARD = RGBColor(0xF1, 0xF6, 0xF8)
GRID = RGBColor(0xD8, 0xE1, 0xE8)
PALE_TEAL = RGBColor(0xE2, 0xF3, 0xF2)
RGB_LIGHT = RGBColor(0xC5, 0xD6, 0xE2)
RGB_RULE = RGBColor(0x35, 0x5A, 0x76)
RGB_MID = RGBColor(0x1B, 0x49, 0x66)
RGB_DARK = RGBColor(0x0B, 0x1F, 0x33)
RGB_RED = RGBColor(0xB8, 0x4A, 0x3C)

BODY = "Segoe UI"
MONO = "Consolas"

SW, SH = 13.333, 7.5


def rect(slide, x, y, w, h, fill, line=None, radius=0.08,
         kind=MSO_SHAPE.ROUNDED_RECTANGLE):
    shape = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if kind == MSO_SHAPE.ROUNDED_RECTANGLE and radius is not None:
        try:
            shape.adjustments[0] = radius
        except Exception:
            pass
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    shape.shadow.inherit = False
    shape.text_frame.word_wrap = True
    return shape


def text(slide, x, y, w, h, value, size=18, bold=False, color=INK, font=BODY,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.0, italic=False,
         space_after=0):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, line in enumerate(str(value).split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        p.space_after = Pt(space_after)
        run = p.add_run()
        run.text = line
        f = run.font
        f.size = Pt(size)
        f.bold = bold
        f.italic = italic
        f.name = font
        f.color.rgb = color
    return box


def label(shape, value, size=14, bold=False, color=WHITE, align=PP_ALIGN.CENTER,
          anchor=MSO_ANCHOR.MIDDLE, font=BODY, spacing=0.95):
    tf = shape.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.08)
    tf.margin_top = tf.margin_bottom = Inches(0.03)
    tf.vertical_anchor = anchor
    for i, line in enumerate(str(value).split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        run = p.add_run()
        run.text = line
        f = run.font
        f.size = Pt(size)
        f.bold = bold
        f.name = font
        f.color.rgb = color


def _bullet(p, char, color, mar_l=0.30, indent=-0.24):
    pPr = p._p.get_or_add_pPr()
    pPr.set("marL", str(int(Inches(mar_l))))
    pPr.set("indent", str(int(Inches(indent))))
    for tag in ("a:buClr", "a:buFont", "a:buChar"):
        el = pPr.makeelement(qn(tag), {})
        if tag == "a:buClr":
            clr = el.makeelement(qn("a:srgbClr"), {"val": str(color)})
            el.append(clr)
        elif tag == "a:buFont":
            el.set("typeface", "Arial")
        else:
            el.set("char", char)
        pPr.append(el)


def bullets(slide, x, y, w, h, items, size=18, color=INK, gap=11, sub_gap=6):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    for i, item in enumerate(items):
        value, level = item[0], item[1] if len(item) > 1 else 0
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.line_spacing = 0.95
        p.space_before = Pt(0 if i == 0 else (sub_gap if level else gap))
        _bullet(p, "\u25b8" if level == 0 else "\u2013",
                TEAL if level == 0 else GREY,
                mar_l=0.32 if level == 0 else 0.66,
                indent=-0.24 if level == 0 else -0.20)
        parts = value.split("::", 1)
        if len(parts) == 2:
            r1 = p.add_run()
            r1.text = parts[0]
            r1.font.bold = True
            r1.font.size = Pt(size if level == 0 else size - 3)
            r1.font.name = BODY
            r1.font.color.rgb = color
            value = parts[1]
        run = p.add_run()
        run.text = value
        run.font.size = Pt(size if level == 0 else size - 3)
        run.font.name = BODY
        run.font.color.rgb = color if level == 0 else GREY
    return box


def header(slide, kicker, title, who=None, number=None):
    text(slide, 0.65, 0.40, 10.6, 0.28, kicker, size=10.5, bold=True, color=TEAL)
    text(slide, 0.65, 0.66, 10.7, 0.75, title, size=27, bold=True, color=NAVY)
    rect(slide, 0.65, 1.40, 1.05, 0.045, TEAL, radius=None,
         kind=MSO_SHAPE.RECTANGLE)
    if who:
        chip = rect(slide, 10.70, 0.44, 1.95, 0.34, PALE_TEAL, radius=0.5)
        label(chip, who, size=10, bold=True, color=TEAL)
    footer(slide, number)


def footer(slide, number=None):
    rect(slide, 0.65, 7.00, 12.03, 0.012, GRID, radius=None,
         kind=MSO_SHAPE.RECTANGLE)
    text(slide, 0.65, 7.08, 8.0, 0.25,
         "SkyGuard AI \u00b7 Source-Aware Anomaly Triage for AWS Networks",
         size=9, color=GREY)
    if number is not None:
        text(slide, 11.45, 7.08, 1.23, 0.25, str(number), size=9, color=GREY,
             align=PP_ALIGN.RIGHT)


def stat(slide, x, y, w, h, value, caption, color=TEAL):
    card = rect(slide, x, y, w, h, CARD, radius=0.06)
    rect(slide, x, y, 0.055, h, color, radius=None, kind=MSO_SHAPE.RECTANGLE)
    text(slide, x + 0.22, y + 0.16, w - 0.34, 0.55, value, size=29, bold=True,
         color=NAVY)
    text(slide, x + 0.22, y + 0.72, w - 0.34, 0.55, caption, size=11.5,
         color=GREY, spacing=0.95)


def table(slide, x, y, w, rows, col_w, size=11.5, row_h=0.33,
          head_color=NAVY, align_right=(), bold_first=False):
    nrows, ncols = len(rows), len(rows[0])
    shape = slide.shapes.add_table(nrows, ncols, Inches(x), Inches(y),
                                   Inches(w), Inches(row_h * nrows))
    tbl = shape.table
    tbl.first_row = False
    tbl.horz_banding = False
    for i, cw in enumerate(col_w):
        tbl.columns[i].width = Inches(cw)
    for r in range(nrows):
        tbl.rows[r].height = Inches(row_h)
        for c in range(ncols):
            cell = tbl.cell(r, c)
            cell.margin_left = cell.margin_right = Inches(0.09)
            cell.margin_top = cell.margin_bottom = Inches(0.02)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            if r == 0:
                cell.fill.fore_color.rgb = head_color
            else:
                cell.fill.fore_color.rgb = WHITE if r % 2 else CARD
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.RIGHT if (r > 0 and c in align_right) else PP_ALIGN.LEFT
            run = p.add_run()
            run.text = str(rows[r][c])
            f = run.font
            f.size = Pt(size)
            f.name = BODY
            f.bold = (r == 0) or (bold_first and c == 0)
            f.color.rgb = WHITE if r == 0 else INK
    return tbl


def chart(slide, x, y, w, h, categories, values, kind, fmt='0.0"%"',
          color=TEAL, vmax=100, step=25, labels=True, size=11):
    data = CategoryChartData()
    data.categories = categories
    data.add_series("Flag rate", values)
    frame = slide.shapes.add_chart(kind, Inches(x), Inches(y), Inches(w),
                                   Inches(h), data)
    ch = frame.chart
    ch.has_legend = False
    ch.has_title = False
    ch.font.name = BODY
    ch.font.size = Pt(size)
    ch.font.color.rgb = GREY
    plot = ch.plots[0]
    plot.gap_width = 45
    plot.vary_by_categories = False
    series = plot.series[0]
    series.format.fill.solid()
    series.format.fill.fore_color.rgb = color
    if labels:
        plot.has_data_labels = True
        dl = plot.data_labels
        dl.number_format = fmt
        dl.number_format_is_linked = False
        dl.font.size = Pt(9.5)
        dl.font.bold = True
        dl.font.name = BODY
        dl.font.color.rgb = NAVY
        dl.position = XL_LABEL_POSITION.OUTSIDE_END
    va = ch.value_axis
    va.maximum_scale = vmax
    va.minimum_scale = 0
    va.major_unit = step
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb = GRID
    va.format.line.fill.background()
    va.tick_labels.font.size = Pt(9.5)
    va.tick_labels.font.color.rgb = GREY
    ca = ch.category_axis
    ca.format.line.color.rgb = GRID
    ca.tick_labels.font.size = Pt(10)
    ca.tick_labels.font.color.rgb = INK
    return ch


def notes(slide, value):
    slide.notes_slide.notes_text_frame.text = value
