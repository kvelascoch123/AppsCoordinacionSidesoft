#!/usr/bin/env python3
"""Regenerate SIDESOFT signature lines 1–2 on the existing PNG; keep logo, color bar, line 3 unchanged."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path(
    "/home/openbravo/.cursor/projects/opt-docker-glpi-coordination-dashboard/assets/"
    "Outlook-yuwqda4y-19445f69-1dc2-4d59-9e18-284fa69ca76f.png"
)
OUT = Path(__file__).resolve().parent / "sidesoft-firma-kevin-velasco.png"

# Solid fill sampled from the blue contact bar (consistent across rows in text area)
NAVY = (1, 84, 162)
WHITE = (255, 255, 255)

LINE1 = "Kevin Velasco • Coordinador de atención al cliente"
LINE2 = "0962 957 575 • kvelasco@sidesoft.com.ec"

# Regions to clear (only these bands; third line / URL unchanged)
# Tweaked to fully cover original glyph bounds without touching website line (~y>=72)
RECT_L1 = (517, 27, 996, 46)
RECT_L2 = (517, 47, 996, 67)

# Left text inset from detection (original “Doris…” starts ~523)
TEXT_X = 523


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    draw = ImageDraw.Draw(im)
    draw.rectangle(RECT_L1, fill=NAVY)
    draw.rectangle(RECT_L2, fill=NAVY)

    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    # Size tuned to match ~12px cap height in 114px-tall banner
    font = ImageFont.truetype(font_path, 12)

    # Vertical placement: align with original line centers (~36 and ~56)
    draw.text((TEXT_X, 29), LINE1, font=font, fill=WHITE)
    draw.text((TEXT_X, 50), LINE2, font=font, fill=WHITE)

    im.save(OUT, "PNG", optimize=True)
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
