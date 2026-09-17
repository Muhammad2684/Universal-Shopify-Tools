"""Generate Nafees Accountant app icons (pure-stdlib PNG writer)."""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ACCENT = (233, 69, 96)      # #e94560
CARD   = (255, 255, 255)    # white
DARK   = (10, 10, 20)       # #0a0a14


def _chunk(typ, data):
    c = struct.pack('>I', len(data)) + typ + data
    return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)


def write_png(path, size, pixel_fn):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel_fn(x, y))
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', ihdr) +
                _chunk(b'IDAT', idat) + _chunk(b'IEND', b''))


def _smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def _sd_rrect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    return min(max(qx, qy), 0.0) + math.hypot(ox, oy) - r


def _mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_icon(size, round_frac=0.22, card_frac=0.46):
    """Full rounded-square icon: accent bg + white card."""
    c = size / 2.0
    hw = size * (1.0 - round_frac) / 2.0
    r = size * round_frac
    chw = size * card_frac / 2.0
    cr = chw * 0.35

    def pixel(x, y):
        d = _sd_rrect(x + 0.5, y + 0.5, c, c, hw, hw, r)
        alpha = 1.0 - _smooth(-0.75, 0.75, d)
        if alpha <= 0:
            return (0, 0, 0, 0)
        dc = _sd_rrect(x + 0.5, y + 0.5, c, c, chw, chw, cr)
        col = _mix(ACCENT, CARD, _smooth(-0.75, 0.75, dc))
        return (col[0], col[1], col[2], int(alpha * 255))
    return pixel


def round_icon(size, card_frac=0.46):
    """Circular icon: accent disc + white card."""
    c = size / 2.0
    rad = size * 0.5 - 1.0
    chw = size * card_frac / 2.0
    cr = chw * 0.35

    def pixel(x, y):
        d = math.hypot(x + 0.5 - c, y + 0.5 - c) - rad
        alpha = 1.0 - _smooth(-0.75, 0.75, d)
        if alpha <= 0:
            return (0, 0, 0, 0)
        dc = _sd_rrect(x + 0.5, y + 0.5, c, c, chw, chw, cr)
        col = _mix(ACCENT, CARD, _smooth(-0.75, 0.75, dc))
        return (col[0], col[1], col[2], int(alpha * 255))
    return pixel


def adaptive_foreground(size, card_frac=0.48):
    """Transparent foreground: white card centered in the adaptive safe zone."""
    c = size / 2.0
    safe = (66.0 / 108.0) * 0.5   # safe half-size as fraction of canvas
    chw = size * safe * card_frac
    cr = chw * 0.35

    def pixel(x, y):
        dc = _sd_rrect(x + 0.5, y + 0.5, c, c, chw, chw, cr)
        a = 1.0 - _smooth(-0.75, 0.75, dc)
        if a <= 0:
            return (0, 0, 0, 0)
        return (CARD[0], CARD[1], CARD[2], int(a * 255))
    return pixel


ANDROID_DENSITY = {
    'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192,
}


def main():
    static_icons = os.path.join(ROOT, 'static', 'icons')
    os.makedirs(static_icons, exist_ok=True)
    write_png(os.path.join(static_icons, 'icon-192.png'), 192, rounded_icon(192))
    write_png(os.path.join(static_icons, 'icon-512.png'), 512, rounded_icon(512))
    print('Wrote static/icons/icon-192.png and icon-512.png')

    res = os.path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res')
    for density, size in ANDROID_DENSITY.items():
        mip = os.path.join(res, 'mipmap-' + density)
        os.makedirs(mip, exist_ok=True)
        write_png(os.path.join(mip, 'ic_launcher.png'), size, rounded_icon(size))
        write_png(os.path.join(mip, 'ic_launcher_round.png'), size, round_icon(size))
        write_png(os.path.join(mip, 'ic_launcher_foreground.png'), size, adaptive_foreground(size))
    print('Wrote android launcher icons for', ', '.join(ANDROID_DENSITY))


if __name__ == '__main__':
    main()