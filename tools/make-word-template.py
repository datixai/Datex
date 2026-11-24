"""Builds templates/word/reference.docx: the styles Datex uses for Word export.
Run once at development time (needs python-docx and the bundled pandoc)."""
import subprocess, os
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'templates', 'word', 'reference.docx')
os.makedirs(os.path.dirname(out), exist_ok=True)
pandoc = os.path.join(root, 'bin', 'pandoc', 'pandoc.exe')
subprocess.check_call([pandoc, '-o', out, '--print-default-data-file', 'reference.docx'])

doc = Document(out)
black = RGBColor(0, 0, 0)
def style(name, size=None, bold=None, font='Calibri', color=black, italic=None, before=None, after=None):
    try: s = doc.styles[name]
    except KeyError: return
    s.font.name = font
    s.element.rPr.rFonts.set(qn('w:eastAsia'), font) if s.element.rPr is not None and s.element.rPr.rFonts is not None else None
    if size: s.font.size = Pt(size)
    if bold is not None: s.font.bold = bold
    if italic is not None: s.font.italic = italic
    if color is not None: s.font.color.rgb = color
    if before is not None: s.paragraph_format.space_before = Pt(before)
    if after is not None: s.paragraph_format.space_after = Pt(after)

style('Normal', 11); style('Body Text', 11, after=6); style('First Paragraph', 11, after=6)
style('Title', 26, True, 'Calibri Light'); style('Subtitle', 14, False, 'Calibri Light', RGBColor(80, 80, 80))
style('Heading 1', 20, True, 'Calibri Light', before=24, after=10)
style('Heading 2', 15, True, 'Calibri Light', before=16, after=6)
style('Heading 3', 12.5, True, 'Calibri', before=12, after=4)
style('Heading 4', 11, True, 'Calibri')
style('Caption', 9.5, False, 'Calibri', RGBColor(70, 70, 70), italic=True)
style('Image Caption', 9.5, False, 'Calibri', RGBColor(70, 70, 70), italic=True)
style('Table Caption', 9.5, False, 'Calibri', RGBColor(70, 70, 70), italic=True)
style('Bibliography', 10)
style('Source Code', 9.5, font='Consolas')
style('Verbatim Char', 9.5, font='Consolas')
style('Hyperlink', color=RGBColor(0, 0, 0))

# Page setup and a "Page X of Y" footer.
for sec in doc.sections:
    sec.page_width, sec.page_height = Inches(8.27), Inches(11.69)
    sec.left_margin = sec.right_margin = Inches(1); sec.top_margin = sec.bottom_margin = Inches(1)
    p = sec.footer.paragraphs[0] if sec.footer.paragraphs else sec.footer.add_paragraph()
    p.alignment = 1
    def field(code):
        r = p.add_run(); r.font.size = Pt(9)
        for kind, text in (('begin', None), (None, code), ('separate', None), (None, '1'), ('end', None)):
            if kind:
                e = OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'), kind); r._r.append(e)
            elif text == code:
                e = OxmlElement('w:instrText'); e.set(qn('xml:space'), 'preserve'); e.text = code; r._r.append(e)
            else:
                e = OxmlElement('w:t'); e.text = text; r._r.append(e)
    def text(t):
        r = p.add_run(t); r.font.size = Pt(9); r.font.color.rgb = RGBColor(90, 90, 90)
    text('Page '); field(' PAGE '); text(' of '); field(' NUMPAGES ')
doc.save(out)
print('written', out)
