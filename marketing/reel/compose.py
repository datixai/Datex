"""Datex promo reel (45 s, 1080x1920): "typeset among the stars".

Black and white space theme taken from the Datex launch screen. Real Datex screens (demo project,
demo user) sit in a desktop window; zoom cards magnify each feature. An IN DEVELOPMENT badge stays
on screen the whole time. Soundtrack is synthesised: airy pad, soft beat, typewriter key clicks,
star chimes, risers. Run:  python compose.py [--preview t1 t2 ...]
"""
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from reelkit import (W, H, FPS, SR, TEXT, MUTED, font, clamp, ease, ease_out, ramp, A, Mixer, datix_tile)

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "work", "shots")
OUT = os.path.join(HERE, "datex-reel.mp4")
FFMPEG = "C:/Claud AI/reel-kit/bin/ffmpeg.exe"  # shared kit copy, not duplicated into the project
DUR = 45.0
WHITE, GREY, DIM, LINE = (245, 245, 245), (150, 150, 150), (90, 90, 90), (58, 58, 58)
CUR_A, CUR_B = (255, 176, 59), (94, 234, 212)

# Scene timings: (start, end, key)
SCENES = [(0.0, 3.6, "intro"), (3.6, 9.0, "four"), (9.0, 14.0, "write"), (14.0, 18.5, "packages"),
          (18.5, 23.0, "history"), (23.0, 28.0, "live"), (28.0, 34.5, "ai"), (34.5, 39.5, "word"), (39.5, 45.0, "outro")]


# ---------------------------------------------------------------- assets
def load(name):
    return Image.open(os.path.join(SHOTS, name + ".png")).convert("RGB")


SH = {n: load(n) for n in ("editor", "history", "share", "packages", "word", "ai")}
# Hide this PC's real network addresses in the live session screen: show a demo address instead.
_d = ImageDraw.Draw(SH["share"])
_bg = SH["share"].getpixel((1460, 190))
_d.rectangle([1164, 131, 1478, 173], fill=_bg)
_d.text((1168, 142), "Address: 192.168.1.20:7337", font=font("semibold", 15), fill=WHITE)
ICON = Image.open(os.path.join(HERE, "assets", "datex-icon.png")).convert("RGBA")

rng = np.random.default_rng(11)
STARS = [(rng.uniform(0, W), rng.uniform(0, H), rng.choice([1, 1, 1, 1.5, 2, 2.6]), rng.uniform(0.3, 1), rng.uniform(0.5, 2), rng.uniform(0, 6.3))
         for _ in range(420)]
# Constellation that resolves into the logo position during the intro.
CONST = [(250, 520), (380, 610), (470, 560), (610, 640), (720, 560), (830, 600), (540, 760), (420, 820)]


def scene_at(t):
    for s, e, k in SCENES:
        if s <= t < e:
            return k, t - s, e - s
    return "outro", t - SCENES[-1][0], SCENES[-1][1] - SCENES[-1][0]


# ---------------------------------------------------------------- drawing helpers
def starfield(img, t, drift=6.0):
    d = ImageDraw.Draw(img)
    for x, y, r, a, s, p in STARS:
        yy = (y + t * drift * r) % H
        al = 0.25 + 0.75 * (0.5 + 0.5 * math.sin(t * s + p)) * a
        c = int(255 * al)
        d.ellipse([x - r, yy - r, x + r, yy + r], fill=(c, c, c))
        if r > 2.5:
            d.line([(x - 7, yy), (x + 7, yy)], fill=(c // 3,) * 3)
            d.line([(x, yy - 7), (x, yy + 7)], fill=(c // 3,) * 3)


def layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def paste_a(base, im, xy, a):
    if a <= 0:
        return
    im = im.convert("RGBA")
    if a < 1:
        im.putalpha(im.getchannel("A").point(lambda v: round(v * a)))
    base.alpha_composite(im, (round(xy[0]), round(xy[1])))


def rounded(im, r):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], r, fill=255)
    out = im.convert("RGBA")
    out.putalpha(m)
    return out


def window(shot, w, a=1.0):
    """Desktop window mockup around a screenshot, width w."""
    sw = w - 16
    sh = round(shot.size[1] * sw / shot.size[0])
    win = Image.new("RGBA", (w, sh + 52), (0, 0, 0, 0))
    d = ImageDraw.Draw(win)
    d.rounded_rectangle([0, 0, w - 1, sh + 51], 18, fill=(18, 18, 18), outline=(70, 70, 70), width=2)
    paste_a(win, ICON.resize((22, 22), Image.LANCZOS), (18, 9), 1)
    d.text((50, 21), "Datex", font=font("semibold", 18), fill=GREY, anchor="lm")
    for i in range(3):  # minimise, maximise, close drawn as shapes
        cx = w - 30 - i * 40
        if i == 0:
            d.line([(cx - 7, 14), (cx + 7, 28)], fill=GREY, width=2); d.line([(cx - 7, 28), (cx + 7, 14)], fill=GREY, width=2)
        elif i == 1:
            d.rectangle([cx - 7, 14, cx + 7, 28], outline=GREY, width=2)
        else:
            d.line([(cx - 7, 21), (cx + 7, 21)], fill=GREY, width=2)
    win.alpha_composite(rounded(shot.resize((sw, sh), Image.LANCZOS), 8), (8, 44))
    if a < 1:
        win.putalpha(win.getchannel("A").point(lambda v: round(v * a)))
    return win


def zoom_card(shot, box, w, h, a=1.0):
    """Magnified crop of a screenshot in a framed card."""
    crop = shot.crop(box).resize((w, h), Image.LANCZOS)
    card = Image.new("RGBA", (w + 8, h + 8), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle([0, 0, w + 7, h + 7], 20, fill=(235, 235, 235))
    card.alpha_composite(rounded(crop, 16), (4, 4))
    if a < 1:
        card.putalpha(card.getchannel("A").point(lambda v: round(v * a)))
    return card


def lerp_box(b0, b1, p):
    return tuple(round(b0[i] + (b1[i] - b0[i]) * p) for i in range(4))


def caption(lay, t_in, head, sub, y=250):
    """Bold headline (words wrapped in * are underlined) and a muted subline."""
    a = ease(ramp(t_in, 0.0, 0.6))
    if a <= 0:
        return
    d = ImageDraw.Draw(lay)
    fb, fs = font("extrabold", 74), font("medium", 34)
    dy = (1 - a) * 30
    words = head.split(" ")
    plain = head.replace("*", "")
    x = W / 2 - d.textlength(plain, font=fb) / 2
    marking = False
    for i, wd in enumerate(words):
        if wd.startswith("*"):
            marking = True
        mark = marking
        if wd.endswith("*") or wd.endswith("*."):
            marking = False
        wd = wd.replace("*", "")
        d.text((x, y + dy), wd, font=fb, fill=A(WHITE, a), anchor="ls")
        tw = d.textlength(wd, font=fb)
        if mark:
            u = ease(ramp(t_in, 0.4, 1.0))
            d.rectangle([x, y + dy + 14, x + tw * u, y + dy + 20], fill=A(WHITE, a))
        x += tw + d.textlength(" ", font=fb)
    d.text((W / 2, y + 70 + dy), sub, font=fs, fill=A(GREY, a), anchor="ms")


def badge(lay, t):
    """Persistent IN DEVELOPMENT badge."""
    a = ease(ramp(t, 1.4, 2.2))
    if a <= 0:
        return
    d = ImageDraw.Draw(lay)
    f = font("bold", 26)
    txt = "IN DEVELOPMENT"
    tw = d.textlength(txt, font=f) + 8 * len(txt) * 0 + 60
    x0, y0 = W / 2 - tw / 2 - 10, 92
    d.rounded_rectangle([x0, y0, x0 + tw + 20, y0 + 52], 26, outline=A(WHITE, a), width=2, fill=A((0, 0, 0), a * 0.6))
    pulse = 0.5 + 0.5 * math.sin(t * 5)
    d.ellipse([x0 + 22, y0 + 19, x0 + 36, y0 + 33], fill=A(WHITE, a * (0.4 + 0.6 * pulse)))
    d.text((x0 + 50, y0 + 27), txt, font=f, fill=A(WHITE, a), anchor="lm")


def check(d, x, y, s, col, p=1.0):
    pts = [(x, y + s * 0.5), (x + s * 0.38, y + s * 0.85), (x + s, y)]
    if p < 0.5:
        e = (pts[0][0] + (pts[1][0] - pts[0][0]) * p * 2, pts[0][1] + (pts[1][1] - pts[0][1]) * p * 2)
        d.line([pts[0], e], fill=col, width=5)
    else:
        q = (p - 0.5) * 2
        e = (pts[1][0] + (pts[2][0] - pts[1][0]) * q, pts[1][1] + (pts[2][1] - pts[1][1]) * q)
        d.line([pts[0], pts[1], e], fill=col, width=5, joint="curve")


def file_icon(d, cx, cy, label, a, sz=1.0, solid=False):
    w, h, c = 150 * sz, 190 * sz, 40 * sz
    x0, y0 = cx - w / 2, cy - h / 2
    poly = [(x0, y0), (x0 + w - c, y0), (x0 + w, y0 + c), (x0 + w, y0 + h), (x0, y0 + h)]
    d.polygon(poly, fill=A(WHITE if solid else (20, 20, 20), a), outline=A(WHITE, a))
    d.line([(x0 + w - c, y0), (x0 + w - c, y0 + c), (x0 + w, y0 + c)], fill=A((0, 0, 0) if solid else WHITE, a), width=3)
    d.text((cx, cy + 30 * sz), label, font=font("extrabold", int(40 * sz)), fill=A((0, 0, 0) if solid else WHITE, a), anchor="mm")


# ---------------------------------------------------------------- scenes
def render(t):
    img = Image.new("RGB", (W, H), (0, 0, 0))
    starfield(img, t)
    base = img.convert("RGBA")
    lay = layer()
    d = ImageDraw.Draw(lay)
    k, u, dur = scene_at(t)
    fade_out = 1 - ease(ramp(u, dur - 0.45, dur))
    fade_in = ease(ramp(u, 0, 0.45))
    a = min(fade_in, fade_out) if k not in ("intro", "outro") else 1

    if k == "intro":
        # Constellation lines draw, then the icon and name appear.
        n = len(CONST)
        p = ease(ramp(u, 0.1, 1.6))
        for i in range(n - 1):
            q = clamp(p * (n - 1) - i)
            if q > 0:
                x0, y0 = CONST[i]; x1, y1 = CONST[i + 1]
                d.line([(x0, y0), (x0 + (x1 - x0) * q, y0 + (y1 - y0) * q)], fill=A(WHITE, 0.45 * (1 - ease(ramp(u, 1.8, 2.4)))), width=2)
        for x, y in CONST:
            d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=A(WHITE, 0.9 * (1 - ease(ramp(u, 1.8, 2.4)))))
        ia = ease_out(ramp(u, 1.5, 2.3))
        sz = round(260 * (0.7 + 0.3 * ia))
        glow = Image.new("RGBA", (sz + 160, sz + 160), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([20, 20, sz + 140, sz + 140], fill=(255, 255, 255, round(60 * ia)))
        paste_a(lay, glow.filter(ImageFilter.GaussianBlur(40)), (W / 2 - (sz + 160) / 2, 760 - (sz + 160) / 2), 1)
        paste_a(lay, ICON.resize((sz, sz), Image.LANCZOS), (W / 2 - sz / 2, 760 - sz / 2), ia)
        ta = ease(ramp(u, 2.0, 2.8))
        f = font("regular", 120)
        word = "DATEX"
        sp = 34
        tw = sum(d.textlength(c, font=f) for c in word) + sp * (len(word) - 1)
        x = W / 2 - tw / 2
        for c in word:
            d.text((x, 1060 + (1 - ta) * 30), c, font=f, fill=A(WHITE, ta), anchor="ls")
            x += d.textlength(c, font=f) + sp
        d.text((W / 2, 1140), "LATEX WRITING STUDIO FOR WINDOWS", font=font("semibold", 30), fill=A(GREY, ta), anchor="ms")
        if u > 3.0:
            fo = ease(ramp(u, 3.0, 3.6))
            lay.putalpha(lay.getchannel("A").point(lambda v: round(v * (1 - fo))))

    elif k == "four":
        caption(lay, u, "Four tools. *One* app.", "Editor, TeX engine, PDF viewer and Pro features")
        names = [("Editor", "like WinEdt"), ("TeX engine", "like MiKTeX"), ("PDF viewer", "with SyncTeX"), ("Pro features", "like Overleaf")]
        p = ease(ramp(u, 2.6, 3.6))
        for i, (nm, sub) in enumerate(names):
            ti = ease_out(ramp(u, 0.4 + i * 0.35, 1.0 + i * 0.35))
            col, row = i % 2, i // 2
            tx, ty = 130 + col * 440, 470 + row * 300
            cx, cy = W / 2 - 200 + (tx - (W / 2 - 200)) * (1 - p), 900 + (ty - 900) * (1 - p)
            sc = 1 - 0.6 * p
            bw, bh = 380 * sc, 240 * sc
            al = ti * (1 - p) * a
            d.rounded_rectangle([cx, cy, cx + bw, cy + bh], 24, outline=A(WHITE, al), width=3, fill=A((14, 14, 14), al))
            d.text((cx + bw / 2, cy + bh / 2 - 10), nm, font=font("bold", 46), fill=A(WHITE, al), anchor="mm")
            d.text((cx + bw / 2, cy + bh / 2 + 42), sub, font=font("medium", 28), fill=A(GREY, al), anchor="mm")
        wa = ease(ramp(u, 3.0, 3.8)) * a
        if wa > 0:
            win = window(SH["editor"], 1000, wa)
            paste_a(lay, win, ((W - 1000) / 2, 620 + (1 - wa) * 60), 1)
            d.text((W / 2, 1360), "One installer for Windows 10 and 11", font=font("semibold", 34), fill=A(WHITE, wa), anchor="ms")

    elif k == "write":
        caption(lay, u, "Write LaTeX. *See it typeset*.", "Live PDF preview. Double-click to jump to the code.")
        paste_a(lay, window(SH["editor"], 1000), ((W - 1000) / 2, 430), a)
        p = ease(ramp(u, 1.6, 3.2))
        box = lerp_box((245, 115, 860, 470), (880, 95, 1460, 450), p)
        card = zoom_card(SH["editor"], box, 960, round(960 * (box[3] - box[1]) / (box[2] - box[0])), a * ease(ramp(u, 0.4, 1.0)))
        paste_a(lay, card, ((W - card.size[0]) / 2, 1080), 1)

    elif k == "packages":
        caption(lay, u, "Every package, *built in*.", "Common ones ship with Datex. Others install on first use.")
        card = zoom_card(SH["packages"], (112, 246, 1374, 620), 980, 290, a * ease(ramp(u, 0.2, 0.8)))
        paste_a(lay, card, ((W - card.size[0]) / 2, 520), 1)
        pk = ["amsmath", "tikz", "IEEEtran", "biblatex", "chemfig"]
        for i, nm in enumerate(pk):
            ti = ramp(u, 1.0 + i * 0.4, 1.4 + i * 0.4)
            if ti <= 0:
                continue
            y = 940 + i * 92
            d.rounded_rectangle([250, y, 830, y + 72], 36, outline=A(LINE, a), width=2, fill=A((12, 12, 12), a))
            d.text((300, y + 36), nm, font=font("semibold", 36), fill=A(WHITE, a * ease(ti)), anchor="lm")
            check(d, 740, y + 22, 34, A(WHITE, a), ease(ti))

    elif k == "history":
        caption(lay, u, "Every version, *saved*.", "History, track changes, comments and restore")
        paste_a(lay, window(SH["history"], 1000), ((W - 1000) / 2, 1160), a * 0.9)
        card = zoom_card(SH["history"], (1139, 48, 1484, 500), 640, 838, a * ease(ramp(u, 0.2, 0.8)))
        paste_a(lay, card, ((W - card.size[0]) / 2, 330 + 40), 1)

    elif k == "live":
        caption(lay, u, "Write *together,* live.", "Share on your network. Edits merge instantly.")
        card = zoom_card(SH["share"], (1139, 48, 1484, 330), 640, 523, a * ease(ramp(u, 0.2, 0.8)))
        paste_a(lay, card, ((W - card.size[0]) / 2, 400), 1)
        # Two co-authors typing in the same paragraph.
        box_y = 1040
        d.rounded_rectangle([110, box_y, 970, box_y + 470], 24, fill=A((12, 12, 12), a), outline=A(LINE, a), width=2)
        lines = ["\\section{Results}", "Our method improves accuracy", "on every dataset we tested.", "\\begin{equation}", "  E = mc^2", "\\end{equation}"]
        fm = font("medium", 34)
        for i, ln in enumerate(lines):
            d.text((150, box_y + 60 + i * 66), ln, font=fm, fill=A(WHITE if not ln.startswith("\\") else (200, 200, 200), a), anchor="ls")
        for name, col, line, base_x, ph in (("Co-author A", CUR_A, 1, 150, 0.0), ("Co-author B", CUR_B, 4, 150, 1.2)):
            txt = lines[line]
            prog = clamp((u - 0.8 - ph) / 2.4)
            cx = base_x + d.textlength(txt[:round(len(txt) * prog)], font=fm)
            cy = box_y + 60 + line * 66
            d.rectangle([cx, cy - 34, cx + 4, cy + 6], fill=A(col, a))
            tw = d.textlength(name, font=font("bold", 22)) + 20
            d.rounded_rectangle([cx, cy - 66, cx + tw, cy - 36], 8, fill=A(col, a))
            d.text((cx + 10, cy - 51), name, font=font("bold", 22), fill=A((0, 0, 0), a), anchor="lm")

    elif k == "ai":
        caption(lay, u, "AI that stays on *your* PC.", "A local model, no cloud, no account")
        steps = [("1  INPUT", "The text you select,", "or the compile errors"),
                 ("2  LOCAL AI MODEL", "reads it on this computer", "and writes a better version"),
                 ("3  OUTPUT", "Replace or insert", "in one click")]
        for i, (h1, l1, l2) in enumerate(steps):
            ti = ease_out(ramp(u, 0.5 + i * 0.7, 1.1 + i * 0.7)) * a
            y = 430 + i * 250
            d.rounded_rectangle([110, y, 970, y + 190], 26, outline=A(WHITE, ti), width=3, fill=A((14, 14, 14), ti))
            d.text((150, y + 52), h1, font=font("extrabold", 34), fill=A(WHITE, ti), anchor="lm")
            d.text((150, y + 105), l1, font=font("medium", 34), fill=A((210, 210, 210), ti), anchor="lm")
            d.text((150, y + 150), l2, font=font("medium", 34), fill=A((210, 210, 210), ti), anchor="lm")
            if i < 2:
                fl = ramp(u, 1.1 + i * 0.7, 1.6 + i * 0.7)
                for j in range(3):  # little particles flowing to the next step
                    pp = (u * 1.6 + j / 3) % 1
                    d.ellipse([536, y + 190 + pp * 60 - 5, 546, y + 190 + pp * 60 + 5], fill=A(WHITE, fl * a))
        ca = ease(ramp(u, 2.8, 3.5)) * a
        card = zoom_card(SH["ai"], (1139, 300, 1484, 440), 860, 349, ca)
        paste_a(lay, card, ((W - card.size[0]) / 2, 1200), 1)
        d.text((W / 2, 1610), "Real output from Datex, running on a local model", font=font("medium", 28), fill=A(GREY, ca), anchor="ms")

    elif k == "word":
        caption(lay, u, "One click. *PDF* and *Word*.", "For readers who do not use LaTeX")
        p = ease(ramp(u, 0.6, 1.8))
        file_icon(d, W / 2, 620, ".tex", a, 1.1)
        for sx, lbl in ((-1, "PDF"), (1, "DOCX")):
            cx = W / 2 + sx * 300 * p
            ap = a * ease(ramp(u, 0.8, 1.6))
            if ap > 0:
                d.line([(W / 2, 730), (cx, 820)], fill=A(LINE, ap), width=3)
                file_icon(d, cx, 920, lbl, ap, 1.0, solid=(lbl == "DOCX"))
        card = zoom_card(SH["word"], (140, 312, 1345, 545), 960, 186, a * ease(ramp(u, 2.0, 2.6)))
        paste_a(lay, card, ((W - card.size[0]) / 2, 1130), 1)
        d.text((W / 2, 1400), "Cover, contents, figures, tables, equations and references kept", font=font("medium", 29), fill=A((210, 210, 210), a * ease(ramp(u, 2.4, 3.0))), anchor="ms")

    else:  # outro
        ia = ease_out(ramp(u, 0.1, 0.9))
        paste_a(lay, ICON.resize((200, 200), Image.LANCZOS), (W / 2 - 100, 300), ia)
        d.text((W / 2, 610), "DATEX", font=font("regular", 96), fill=A(WHITE, ia), anchor="ms")
        pills = ["Built-in TeX", "SyncTeX", "Live co-editing", "Local AI", "Word export", "Git and cloud"]
        fp = font("semibold", 30)
        rows = [pills[:3], pills[3:]]
        for r, row in enumerate(rows):
            widths = [d.textlength(s, font=fp) + 56 for s in row]
            x = W / 2 - (sum(widths) + 18 * (len(row) - 1)) / 2
            for i, s in enumerate(row):
                pa = ease(ramp(u, 0.6 + (r * 3 + i) * 0.12, 1.0 + (r * 3 + i) * 0.12))
                y = 690 + r * 86
                d.rounded_rectangle([x, y, x + widths[i], y + 62], 31, outline=A(WHITE, pa), width=2)
                d.text((x + widths[i] / 2, y + 31), s, font=fp, fill=A(WHITE, pa), anchor="mm")
                x += widths[i] + 18
        ca = ease(ramp(u, 1.4, 2.0))
        d.text((W / 2, 960), "In development", font=font("extrabold", 60), fill=A(WHITE, ca), anchor="ms")
        d.text((W / 2, 1020), "Coming soon for Windows 10 and 11", font=font("medium", 34), fill=A(GREY, ca), anchor="ms")
        # Credit
        cr = ease(ramp(u, 2.2, 2.9))
        if cr > 0:
            y0 = 1180
            d.line([(W / 2 - 220, y0), (W / 2 + 220, y0)], fill=A(LINE, cr), width=2)
            d.text((W / 2, y0 + 64), "DEVELOPED BY", font=font("semibold", 26), fill=A(MUTED, cr), anchor="ms")
            fb = font("extrabold", 58)
            label = "Datix AI & XactGen AI"
            tw = d.textlength(label, font=fb)
            gx = round(W / 2 - (100 + 26 + tw) / 2)
            tile = datix_tile().resize((100, 100), Image.LANCZOS)
            paste_a(lay, tile, (gx, y0 + 100), cr)
            d.text((gx + 126, y0 + 172), label, font=fb, fill=A(WHITE, cr), anchor="ls")
        if u > dur - 0.6:
            fo = ease(ramp(u, dur - 0.6, dur))
            lay.putalpha(lay.getchannel("A").point(lambda v: round(v * (1 - fo))))

    badge(lay, t)
    base.alpha_composite(lay)
    return base.convert("RGB")


# ---------------------------------------------------------------- soundtrack
def synth(path):
    m = Mixer(DUR, seed=5)
    m.pad([(110, 1.0), (164.8, 0.7), (220, 0.6), (246.9, 0.35), (329.6, 0.3)], gain=0.12, wobble=11)
    beat = 60 / 96
    tt = np.arange(int(0.25 * SR)) / SR
    kick = np.sin(2 * math.pi * (50 + 70 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 9)
    for i in range(int(3.6 / beat), int(39.5 / beat)):
        m.add(kick, i * beat, 0.55)
        hat = m.noise(0.05) * np.exp(-np.arange(int(0.05 * SR)) / SR * 90)
        m.add(hat - Mixer.smooth(hat, 4), i * beat + beat / 2, 0.12, pan=0.3)
    m.add(m.boom(), 1.5, 0.9)
    for s, e, k in SCENES[1:]:
        m.add(m.riser(0.8), s - 0.8, 0.35)
        m.add(m.bell(1568 if k != "outro" else 1046.5), s, 0.18, pan=-0.2)
    m.add(m.boom(), 39.5, 0.8)
    # Typewriter key clicks while code is written and co-authors type.
    r = np.random.default_rng(3)
    for t0, t1 in ((9.4, 13.5), (23.8, 27.0)):
        t = t0
        while t < t1:
            c = m.click(r.uniform(1500, 2300))
            nz = m.noise(0.03) * 0.15 * np.exp(-np.arange(int(0.03 * SR)) / SR * 120)
            c[:len(nz)] += nz
            m.add(c, t, 0.25, pan=r.uniform(-0.4, 0.4))
            t += r.uniform(0.07, 0.16)
    for i in range(5):  # package ticks
        m.add(m.tone(1318.5 + i * 110, 0.3, 14), 15.4 + i * 0.4, 0.22)
    for i in range(3):  # AI steps
        m.add(m.tone(659.3 * (1.25 ** i), 0.5, 7), 29.1 + i * 0.7, 0.25)
    for x in (35.4, 35.6):  # file split
        m.add(m.tone(880, 0.4, 9), x, 0.2, pan=-0.5 if x < 35.5 else 0.5)
    for t in np.arange(0.2, DUR, 2.7):  # distant star chimes
        m.add(m.bell(2093 + (t * 37) % 500), float(t), 0.05, pan=float(math.sin(t)))
    m.write(path)


# ---------------------------------------------------------------- run
def main():
    if "--preview" in sys.argv:
        pdir = os.path.join(HERE, "work", "preview")
        os.makedirs(pdir, exist_ok=True)
        ts = [float(x) for x in sys.argv[sys.argv.index("--preview") + 1:]]
        for x in ts:
            render(x).save(os.path.join(pdir, f"t{x:05.1f}.jpg"), quality=85)
        print("preview ->", pdir)
        return
    wav = os.path.join(HERE, "work", "datex-reel.wav")
    synth(wav)
    cmd = [FFMPEG, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", wav,
           "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    total = int(DUR * FPS)
    for i in range(total):
        proc.stdin.write(render(i / FPS).tobytes())
        if i % 150 == 0:
            print(f"frame {i}/{total}", flush=True)
    proc.stdin.close()
    proc.wait()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
