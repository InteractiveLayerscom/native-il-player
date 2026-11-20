"""Generate the original program, stills, and linear ad with Pillow and FFmpeg."""
from pathlib import Path
import math
import random
import subprocess
import tempfile
import wave
from array import array

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "public" / "demo"
HLS = ROOT / "test" / "fixtures" / "hls"
WIDTH, HEIGHT = 960, 540

PALETTES = [
    ((36, 61, 88), (247, 167, 110), (225, 149, 105), (19, 51, 59), 575),
    ((47, 65, 84), (190, 185, 161), (195, 207, 199), (23, 53, 55), 675),
    ((34, 76, 109), (249, 201, 146), (249, 177, 105), (21, 54, 57), 444),
]


def mix(a, b, amount):
    return tuple(round(x * (1 - amount) + y * amount) for x, y in zip(a, b))


def gradient(size, a, b, horizontal=False):
    width, height = size
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    length = width if horizontal else height
    for point in range(length):
        color = mix(a, b, point / (length - 1))
        line = (point, 0, point, height) if horizontal else (0, point, width, point)
        draw.line(line, fill=color)
    return image


def ridge(seed, baseline, amplitude, pinches):
    rng = random.Random(seed)
    peak_positions = sorted(rng.sample(range(50, WIDTH - 40), pinches))
    profile = [(0, baseline + rng.randrange(-35, 20))]
    for position in peak_positions:
        peak = baseline - rng.uniform(0.27, 1.0) * amplitude
        if position - profile[-1][0] > 25:
            profile.append(((position + profile[-1][0]) / 2, baseline + rng.randrange(0, 36)))
        profile.append((position, peak))
    profile.append((WIDTH, baseline + rng.randrange(-15, 35)))
    points = []
    for left, right in zip(profile, profile[1:]):
        start, peak = left
        finish, valley = right
        step = max(2, round((finish - start) / 8))
        for x in range(round(start), round(finish), step):
            t = (x - start) / (finish - start)
            y = peak + (valley - peak) * t + rng.uniform(-5, 5) * math.sin(t * math.pi)
            points.append((x, y))
    return points + [profile[-1]]


def still(shot):
    sky_top, sky_base, haze, dark, sun = PALETTES[shot]
    frame = gradient((WIDTH, HEIGHT), sky_top, sky_base).convert("RGBA")
    light = Image.new("RGBA", frame.size)
    glow = ImageDraw.Draw(light)
    glow.ellipse((sun - 69, 120, sun + 69, 258), fill=(255, 212, 143, 128))
    frame.alpha_composite(light.filter(ImageFilter.GaussianBlur(46)))
    draw = ImageDraw.Draw(frame)
    sun_size = 21 if shot == 1 else 30
    draw.ellipse((sun - sun_size, 184 - sun_size, sun + sun_size, 184 + sun_size), fill=(255, 230, 175, 255))
    for depth in range(5):
        level = 300 + 30 * depth + (14 if shot == 1 else 0)
        profile = ridge(13297 + 2312 * shot + depth, level, 120 - depth * 12, 5 + depth)
        palette = mix(haze, dark, 0.3 + 0.16 * depth)
        draw.polygon([*profile, (WIDTH, HEIGHT), (0, HEIGHT)], fill=palette)
        if depth < 3:
            detail = mix(palette, sky_base, 0.32)
            for i in range(9, len(profile) - 4, 8):
                x, y = profile[i]
                x2, y2 = profile[i + 4]
                draw.polygon(((x, y), (x2, y2), (x + 70, y + 75)), fill=detail)
    water = [(sun, 367), (sun + 39, 387), (sun - 66, 421), (sun - 26, 455),
             (sun - 162, 539), (sun + 53, 539), (sun + 39, 459), (sun + 21, 422),
             (sun + 96, 388)]
    draw.polygon(water, fill=mix(dark, sky_base, 0.48))
    if shot == 1:
        mist = Image.new("RGBA", frame.size)
        mist_draw = ImageDraw.Draw(mist)
        mist_draw.ellipse((110, 366, 855, 422), fill=(207, 218, 210, 103))
        mist_draw.ellipse((560, 420, 985, 479), fill=(207, 218, 210, 74))
        frame.alpha_composite(mist.filter(ImageFilter.GaussianBlur(15)))
    draw = ImageDraw.Draw(frame)
    foreground = ridge(57 + shot, 530, 42, 9)
    draw.polygon([*foreground, (WIDTH, HEIGHT), (0, HEIGHT)], fill=mix(dark, (12, 22, 33), 0.38))
    rng = random.Random(8477 + shot)
    for _ in range(100):
        x = rng.randrange(WIDTH)
        y = rng.randrange(504, HEIGHT + 1)
        height = rng.randrange(8, 46)
        if abs(x - (sun - 66)) < 98 and y < 525:
            continue
        tree = mix(dark, (7, 15, 19), rng.uniform(0.32, 0.67))
        draw.polygon([(x, y - height), (x - height * 0.21, y), (x + height * 0.2, y)], fill=tree)
    return frame.convert("RGB")


def text(draw, position, label, size, color):
    draw.text(position, label, font=ImageFont.load_default(size=size), fill=color)


def artwork():
    asset = gradient((1200, 180), (22, 41, 66), (22, 84, 81), horizontal=True)
    draw = ImageDraw.Draw(asset)
    draw.rectangle((0, 0, 10, 180), fill="#94efd4")
    text(draw, (42, 26), "CONTEXTUAL AD", 25, "#a4eedc")
    text(draw, (42, 60), "Explore the mountains", 55, "#ffffff")
    asset.save(DEST / "super.png", optimize=True)

    asset = gradient((1280, 720), (23, 40, 69), (20, 89, 87), horizontal=True)
    draw = ImageDraw.Draw(asset)
    draw.rectangle((0, 540, 1280, 543), fill="#94efd4")
    draw.rectangle((960, 0, 963, 540), fill="#94efd4")
    draw.ellipse((1049, 127, 1201, 279), fill="#aff1d6")
    draw.line((1038, 292, 1221, 201), fill="#65b8a9", width=6)
    draw.line((1060, 308, 1179, 249), fill="#b9f8e5", width=3)
    text(draw, (992, 38), "DEMO CREATIVE", 20, "#a4eedc")
    text(draw, (992, 378), "Find your next\ntrail", 32, "#e5faf4")
    text(draw, (32, 550), "CONTEXTUAL AD", 23, "#a4eedc")
    text(draw, (32, 585), "Explore the mountains", 47, "#ffffff")
    asset.save(DEST / "l.png", optimize=True)

    linear = gradient((WIDTH, HEIGHT), (14, 40, 53), (33, 113, 91), horizontal=True)
    draw = ImageDraw.Draw(linear)
    for x in range(498, 1040, 72):
        draw.line((x, HEIGHT, x + 286, 0), width=2, fill="#62c4a6")
    draw.ellipse((584, 108, 830, 354), fill="#b5efe0")
    draw.polygon(((512, 421), (654, 215), (724, 312), (793, 230), (913, 421)), fill="#1a6559")
    draw.rectangle((62, 165, 116, 168), fill="#bcf7d9")
    text(draw, (62, 190), "SIERRA", 82, "#f6fff9")
    text(draw, (66, 294), "TRAIL GUIDE", 27, "#b5efe0")
    return linear


def audio(path, seconds, jingle=False):
    rate = 44100
    frequencies = (261.63, 329.63, 392) if jingle else (130.81, 196, 261.63)
    sound = array("h")
    for index in range(rate * seconds):
        t = index / rate
        envelope = min(1.0, t / 1.0, (seconds - t) / 1.1)
        frame = sum(math.sin(2 * math.pi * note * t) * (0.5 + 0.5 * math.sin(t * speed) ** 2)
                    for note, speed in zip(frequencies, (2.4, 1.6, 1.2)))
        sound.append(round(frame * envelope * 585))
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(sound.tobytes())


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    HLS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as raw:
        work = Path(raw)
        shots = [still(index) for index in range(3)]
        shots[0].save(DEST / "poster.jpg", quality=88, optimize=True)
        for index, shot in enumerate(shots):
            shot.save(work / f"shot{index}.png")
        artwork().save(work / "linear.png")
        audio(work / "ambient.wav", 18)
        audio(work / "jingle.wav", 4, jingle=True)
        frames = 6 * 24
        zoom = "zoompan=z='1+on*0.00036':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2'"
        filters = [
            f"[{index}:v]scale=1920:-1,{zoom}:d={frames}:s=960x540:fps=24,setsar=1[v{index}]"
            for index in range(3)
        ]
        filters.append("[v0][v1][v2]concat=n=3:v=1:a=0[out]")
        codec = ("-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "23",
                 "-c:a", "aac", "-b:a", "80k", "-movflags", "+faststart")
        ffmpeg("-i", work / "shot0.png", "-i", work / "shot1.png", "-i", work / "shot2.png",
               "-i", work / "ambient.wav", "-filter_complex", ";".join(filters), "-map", "[out]",
               "-map", "3:a", "-g", "48", "-sc_threshold", "0", *codec, DEST / "program.mp4")
        ffmpeg("-loop", "1", "-framerate", "24", "-i", work / "linear.png", "-i", work / "jingle.wav",
               "-t", "4", "-vf", "fade=t=in:d=0.2,fade=t=out:st=3.72:d=0.28", *codec, DEST / "linear.mp4")
        ffmpeg("-i", DEST / "program.mp4", "-t", "8", "-codec", "copy", "-hls_time", "2",
               "-hls_playlist_type", "vod", "-hls_segment_filename", HLS / "segment-%d.ts", HLS / "index.m3u8")
        manifest = HLS / "index.m3u8"
        manifest.write_text(manifest.read_text().replace(
            "#EXTINF:2.000000,\nsegment-0.ts",
            "#EXT-X-PROGRAM-DATE-TIME:2026-01-01T12:00:00.000Z\n#EXTINF:2.000000,\nsegment-0.ts",
            1,
        ))


if __name__ == "__main__":
    main()
