"""Generate Nafees Accountant / USHT app icons and splash screens.

Icons are derived from the master logo `static/icons/Icon.png` (the desktop
USHT logo: a rounded `#D23E56` square with a punched-out QR-style glyph) so the
mobile app matches the desktop branding. Requires Pillow (pinned in
requirements.txt).
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, 'static', 'icons', 'Icon.png')

LOGO_RED   = (210, 62, 86)    # #D23E56 - desktop logo fill
LOGO_NAVY  = (15, 15, 29)     # #0f0f1d - desktop bg-secondary
ACCENT     = (233, 69, 96)    # #e94560 - desktop accent (splash wordmark)
RAD_FRAC   = 0.22             # rounded-square corner radius as canvas fraction
FG_PANEL   = 0.62             # adaptive-icon foreground panel fraction (safe zone)

ANDROID_DENSITY = {
    'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192,
}

SPLASH = {
    'drawable/splash.png':              (480, 320),
    'drawable-land-hdpi/splash.png':    (800, 480),
    'drawable-land-mdpi/splash.png':    (480, 320),
    'drawable-land-xhdpi/splash.png':   (1280, 720),
    'drawable-land-xxhdpi/splash.png':  (1600, 960),
    'drawable-land-xxxhdpi/splash.png': (1920, 1280),
    'drawable-port-hdpi/splash.png':    (480, 800),
    'drawable-port-mdpi/splash.png':    (320, 480),
    'drawable-port-xhdpi/splash.png':   (720, 1280),
    'drawable-port-xxhdpi/splash.png':  (960, 1600),
    'drawable-port-xxxhdpi/splash.png': (1280, 1920),
}

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\segoeuib.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\segoeui.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]


def _rounded_rect(size, radius_frac, fill):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * radius_frac,
                        fill=fill)
    return img


def _glyph_holes(master, ref=512):
    """L-image: punched-out glyph pixels (inside the logo's rounded square)."""
    lg = master.resize((ref, ref), Image.LANCZOS).getchannel('A')
    sq = Image.new('L', (ref, ref), 0)
    ImageDraw.Draw(sq).rounded_rectangle(
        [0, 0, ref - 1, ref - 1], radius=ref * RAD_FRAC, fill=255)
    holes = sq.point(lambda v: 255, mode='L')
    holes = holes.point(lambda v: v if v == 255 else 0)
    for y in range(ref):
        for x in range(ref):
            if holes.getpixel((x, y)) == 255 and lg.getpixel((x, y)) >= 96:
                holes.putpixel((x, y), 0)
    return holes


def flatten_icon(size, master):
    """Navy rounded square + red logo with navy glyph (opaque, desktop look)."""
    canvas = _rounded_rect(size, RAD_FRAC, LOGO_NAVY)
    logo = master.resize((size, size), Image.LANCZOS)
    canvas.alpha_composite(logo)
    return canvas


def round_icon(size, master):
    icon = flatten_icon(size, master)
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([0, 0, size - 1, size - 1], fill=255)
    icon.putalpha(mask)
    return icon


def adaptive_foreground(size, master, holes_ref):
    """Red panel (in safe zone) with navy glyph, transparent outside."""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    px = int(round(size * (1 - FG_PANEL) / 2))
    panel_size = size - 2 * px
    d.rounded_rectangle([px, px, size - 1 - px, size - 1 - px],
                        radius=panel_size * RAD_FRAC, fill=LOGO_RED)
    holes = holes_ref.resize((panel_size, panel_size), Image.LANCZOS)
    holes = holes.point(lambda v: 255 if v > 96 else 0)
    navy = Image.new('RGBA', (panel_size, panel_size), LOGO_NAVY + (255,))
    canvas.paste(navy, (px, px), holes)
    return canvas


def splash_image(w, h, master):
    img = Image.new('RGBA', (w, h), LOGO_NAVY + (255,))
    logo_h = int(round(min(w, h) * (0.30 if h >= w else 0.22)))
    logo = master.resize((logo_h, logo_h), Image.LANCZOS)
    cx = (w - logo_h) // 2
    cy = (h - logo_h) // 2
    if h >= w:
        cy = int(h * 0.34 - logo_h / 2)
    else:
        cy = int(h * 0.40 - logo_h / 2)
    img.alpha_composite(logo, (cx, cy))

    font = _bold_font(int(logo_h * 0.34))
    if font is not None:
        d = ImageDraw.Draw(img)
        text = 'USHT'
        tw = d.textlength(text, font=font)
        ty = cy + logo_h + int(logo_h * 0.18)
        d.text(((w - tw) / 2, ty), text, font=font, fill=ACCENT + (255,))
    return img


def _bold_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return None


def main():
    master = Image.open(MASTER).convert('RGBA')
    holes = _glyph_holes(master)

    static_icons = os.path.join(ROOT, 'static', 'icons')
    os.makedirs(static_icons, exist_ok=True)
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512)]:
        flatten_icon(size, master).save(os.path.join(static_icons, name))
    print('Wrote static/icons/icon-192.png and icon-512.png')

    res = os.path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res')
    for density, size in ANDROID_DENSITY.items():
        mip = os.path.join(res, 'mipmap-' + density)
        os.makedirs(mip, exist_ok=True)
        flatten_icon(size, master).save(os.path.join(mip, 'ic_launcher.png'))
        round_icon(size, master).save(os.path.join(mip, 'ic_launcher_round.png'))
        adaptive_foreground(size, master, holes).save(
            os.path.join(mip, 'ic_launcher_foreground.png'))
    print('Wrote android launcher icons for', ', '.join(ANDROID_DENSITY))

    for rel, (w, h) in SPLASH.items():
        path = os.path.join(res, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        splash_image(w, h, master).save(path)
    print('Wrote', len(SPLASH), 'splash screens')

    color_path = os.path.join(res, 'values', 'ic_launcher_background.xml')
    with open(color_path, 'w') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<resources>\n'
                '    <color name="ic_launcher_background">#0F0F1D</color>\n'
                '</resources>\n')
    print('Updated ic_launcher_background.xml -> #0F0F1D')


if __name__ == '__main__':
    main()