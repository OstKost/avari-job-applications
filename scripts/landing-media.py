"""Export optimized landing previews from real Playwright demo captures.

Refresh captures with the workspace design E2E test, then run:
  python3 scripts/landing-media.py
Requires Pillow. The previews preserve screenshot pixels without adding copy.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "apps/web/public/landing"
SOURCES = {
    "journal": "table-grouped",
    "calendar": "calendar-dark",
    "dashboard": "dashboard-dark",
    "journal-mobile": "table-mobile",
    "calendar-mobile": "calendar-mobile",
    "dashboard-mobile": "dashboard-mobile",
}


def main():
    # Check all inputs before replacing any existing artifact.
    paths = {name: ROOT / f"test-results/design-{source}.png"
             for name, source in SOURCES.items()}
    for source in paths.values():
        if not source.is_file():
            raise SystemExit(f"Missing demo capture: {source}. Run workspace design E2E first.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, source in paths.items():
        with Image.open(source) as original:
            image = original.convert("RGB")
            height = 844 if name.endswith("-mobile") else 1000
            image = image.crop((0, 0, image.width, min(image.height, height)))
            image.save(OUTPUT / f"{name}.webp", "WEBP", quality=86, method=6)


if __name__ == "__main__":
    main()
