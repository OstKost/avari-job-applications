"""Render the 40s Russian store promo from anonymized product screenshots.

Python dependencies: Pillow, imageio-ffmpeg. Run from any directory.
Use --preview to render the storyboard only. Set AVARI_PROMO_FONT_DIR if needed.
"""
from pathlib import Path
import argparse
import math
import os
import shutil
import struct
import subprocess
import tempfile
import wave

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/chrome-store-assets"
SRC = OUT / "video-source"
W, H, FPS, DURATION = 1920, 1080, 24, 40
WHITE, MUTED, CYAN = "#edf4ff", "#a9bdd2", "#61d5ff"
FONT_DIR = Path(os.environ.get("AVARI_PROMO_FONT_DIR", "/System/Library/Fonts/Supplemental"))
REGULAR = FONT_DIR / "Arial.ttf"
BOLD = FONT_DIR / "Arial Bold.ttf"
if not REGULAR.exists():
    FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
    REGULAR, BOLD = FONT_DIR / "DejaVuSans.ttf", FONT_DIR / "DejaVuSans-Bold.ttf"
FONTS = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(str(BOLD if bold else REGULAR), size)
    return FONTS[key]


def text(im, xy, value, size=32, fill=WHITE, bold=False):
    ImageDraw.Draw(im).text(xy, value, font=font(size, bold), fill=fill, spacing=14)


def pill(im, xy, value, size=24, active=False):
    d = ImageDraw.Draw(im)
    x, y = xy
    tw = d.textlength(value, font=font(size))
    d.rounded_rectangle((x, y, x + tw + 44, y + 54), 18,
                        fill="#17364b" if active else "#142536", outline="#2b5067", width=1)
    text(im, (x + 22, y + 12), value, size, CYAN if active else MUTED)
    return tw + 60


def ease(v):
    v = min(1, max(0, v))
    return 1 - (1 - v) ** 3


# Static background is cached; only foreground motion is rendered per frame.
BG = Image.new("RGB", (W, H))
pixels = BG.load()
for y in range(H):
    for x in range(W):
        glow = max(0, 1 - math.hypot((x - 1530) / 1700, (y - 180) / 1200)) ** 2
        pixels[x, y] = (int(9 + 10 * glow), int(17 + 34 * glow), int(29 + 48 * glow))
logo = Image.open(ROOT / "apps/extension/public/brand/icon-128.png").convert("RGBA")
SCREENS = {name: Image.open(SRC / (name + ".png")).convert("RGB")
           for name in ("extension", "journal", "calendar")}


def screen(im, name, box, progress=0):
    x, y, w, h = box
    source = SCREENS[name]
    ratio = w / source.width
    resized = source.resize((w, round(source.height * ratio)), Image.Resampling.LANCZOS)
    offset = int(max(0, resized.height - h) * progress)
    crop = resized.crop((0, offset, w, offset + h))
    mask = Image.new("L", (w, h))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), 22, fill=255)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x - 12, y - 12, x + w + 12, y + h + 12), 32,
                        fill="#122537", outline="#2b5067", width=2)
    im.paste(crop, (x, y), mask)


STARTS = [0, 5, 13, 21, 28, 34, 40]


def scene(index, local):
    im = BG.copy()
    entrance = round(28 * (1 - ease(local / .75)))
    icon = logo.resize((52, 52), Image.Resampling.LANCZOS)
    im.paste(icon, (96, 64), icon)
    text(im, (164, 69), "Avari.Jobs", 35, WHITE, True)
    text(im, (1480, 78), "ЖУРНАЛ ПОИСКА РАБОТЫ", 18, CYAN)
    y = 250 + entrance
    if index == 0:
        text(im, (100, y), "Десятки вакансий.", 94, WHITE, True)
        text(im, (100, y + 118), "Один журнал.", 94, CYAN, True)
        text(im, (104, y + 278), "Сохраняйте возможности.\nДержите следующий шаг перед глазами.", 38, MUTED)
        steps = [("Вакансия", 1100, 655), ("Отклик", 1330, 510), ("Интервью", 1560, 365)]
        d = ImageDraw.Draw(im)
        d.line([(1180, 708), (1410, 563), (1640, 418)], fill="#28556c", width=3)
        for j, (label, x, sy) in enumerate(steps):
            sy += round(30 * (1 - ease((local - j * .25) / .9)))
            d.rounded_rectangle((x, sy, x + 220, sy + 106), 24, fill="#142c3e", outline="#31637d", width=2)
            text(im, (x + 26, sy + 32), label, 28, CYAN, True)
        pill(im, (104, 850), "Расширение для Chrome", active=True)
    elif index == 1:
        text(im, (100, y), "Нашли вакансию?\nСохраните её.", 72, WHITE, True)
        text(im, (104, y + 224), "Компания, позиция и доступные\nданные — в вашем журнале.", 34, MUTED)
        text(im, (104, y + 354), "Меняйте этап, добавляйте\nзаметки и задачи из расширения.", 32, MUTED)
        pill(im, (104, 824), "Прямо из браузера", active=True)
        screen(im, "extension", (1120, 172 + entrance, 480, 770), .03)
    elif index == 2:
        text(im, (100, 180 + entrance), "От сохранённой вакансии до оффера", 66, WHITE, True)
        text(im, (104, 270 + entrance), "Этапы, группы и следующий шаг — в одном журнале.", 32, MUTED)
        screen(im, "journal", (105, 376 + entrance, 1710, 565), .05 + .55 * ease(local / 7.7))
    elif index == 3:
        text(im, (100, 180 + entrance), "Следующий шаг — в календаре", 70, WHITE, True)
        text(im, (104, 276 + entrance), "Планируйте интервью, встречи и подготовку.", 34, MUTED)
        screen(im, "calendar", (105, 382 + entrance, 1710, 554), .15 + .68 * ease(local / 6.7))
    elif index == 4:
        text(im, (100, 238 + entrance), "Ваши вакансии.\nВаш порядок.", 86, WHITE, True)
        text(im, (104, 478 + entrance), "Сохраняйте вакансии с карьерных сайтов", 36, MUTED)
        x = 104
        for site in ("hh.ru", "LinkedIn", "Getmatch", "Hirify"):
            x += pill(im, (x, 560 + entrance), site, 28, True)
        text(im, (106, 708 + entrance), "Этапы отбора  /  Заметки  /  Задачи", 34, CYAN)
        text(im, (106, 790 + entrance), "Для работы нужен аккаунт Avari.Jobs", 28, MUTED)
    else:
        big = logo.resize((142, 142), Image.Resampling.LANCZOS)
        im.paste(big, (100, 244 + entrance), big)
        text(im, (278, 260 + entrance), "Avari.Jobs", 92, WHITE, True)
        text(im, (106, 448 + entrance), "Ваш следующий\nкарьерный шаг", 78, WHITE, True)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((106, 718, 710, 814), 25, fill="#53caff")
        text(im, (145, 741), "Добавьте в Chrome  →", 43, "#092133", True)
        text(im, (108, 856), "jobs.avari.dev", 32, MUTED)
    d = ImageDraw.Draw(im)
    d.line((100, 1000, 1820, 1000), fill="#243a4c", width=1)
    text(im, (104, 1020), "Avari.Jobs  ·  Ваш следующий карьерный шаг", 19, MUTED)
    text(im, (1450, 1020), "Интерфейс с демоданными", 19, MUTED)
    return im


def frame(t):
    index = next(i for i in range(6) if t < STARTS[i + 1])
    local = t - STARTS[index]
    im = scene(index, local)
    # A short dissolve keeps every scene readable for almost its full duration.
    if index and local < .45:
        before = scene(index - 1, STARTS[index] - STARTS[index - 1])
        im = Image.blend(before, im, ease(local / .45))
    return im


def soundtrack(path):
    """Original quiet synth bed, generated locally; no third-party recordings."""
    rate = 44100
    chords = [(146.83, 220, 293.66, 349.23), (130.81, 196, 261.63, 329.63),
              (174.61, 220, 261.63, 349.23), (130.81, 196, 293.66, 392)]
    with wave.open(str(path), "wb") as wav:
        wav.setparams((2, 2, rate, 0, "NONE", "not compressed"))
        for second in range(DURATION):
            data = bytearray()
            for i in range(rate):
                t = second + i / rate
                chord_index, ct = int(t / 5) % 4, t % 5
                attack_release = min(1, ct / .6, (5 - ct) / 1.2)
                fade = min(1, t / 2, (DURATION - t) / 3)
                chord = chords[chord_index]
                pad = sum(math.sin(2 * math.pi * f * t) + .16 * math.sin(4 * math.pi * f * t) for f in chord) / 4
                beat = t % .625
                note = chord[int(t / .625) % 4] * 2
                pluck = math.sin(2 * math.pi * note * t) * math.exp(-beat * 12)
                value = int(32767 * fade * (.065 * pad * attack_release + .025 * pluck))
                data.extend(struct.pack("<hh", value, value))
            wav.writeframes(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True, parents=True)
    sheet = Image.new("RGB", (1440, 1215), "#0b1522")
    for i, t in enumerate([2, 8, 17, 25, 31, 37]):
        shot = frame(t)
        shot.thumbnail((720, 405), Image.Resampling.LANCZOS)
        sheet.paste(shot, ((i % 2) * 720, (i // 2) * 405))
    sheet.save(OUT / "promo-storyboard.jpg", quality=92)
    frame(37).save(OUT / "promo-thumbnail.jpg", quality=95)
    if args.preview:
        return
    ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory(prefix="avari-promo-") as temp:
        music = Path(temp) / "music.wav"
        soundtrack(music)
        output = OUT / "avari-jobs-promo-ru.mp4"
        command = [ffmpeg, "-hide_banner", "-loglevel", "warning", "-y",
                   "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                   "-i", "pipe:0", "-i", str(music), "-c:v", "libx264", "-preset", "fast",
                   "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                   "-movflags", "+faststart", "-t", str(DURATION), str(output)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE)
        try:
            for n in range(FPS * DURATION):
                process.stdin.write(frame(n / FPS).tobytes())
                if n % (FPS * 5) == 0:
                    print(f"Rendered {n // FPS}/{DURATION}s", flush=True)
            process.stdin.close()
            if process.wait() != 0:
                raise RuntimeError("Video encoding failed")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
        print(output)


if __name__ == "__main__":
    main()
