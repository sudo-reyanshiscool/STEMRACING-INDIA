#!/usr/bin/env python3
"""Rebuilds sr-background.js from the official STEM Racing gradient PNGs.
Run from this folder:  python3 build_background.py
The images are embedded in the script so the backgrounds work when pages are opened straight from disk."""
import base64, os, subprocess, tempfile
SRC = os.path.expanduser("~/Documents/STEM Racing/STEM RACING BRANDING SHARE/Graphic Assets/Gradients/RGB/PNG")
SETS = [  # key, file, turn sideways (portrait files), longest side in px
    ("sr", "SR gradient@2x.png", 0, 1600),
    ("blue", "STEM Racing Gradients_Blue RGB.png", 1, 1100),
    ("cold", "STEM Racing Gradients_Cold RGB.png", 1, 1100),
    ("blue-green", "STEM Racing Gradients_Blue Green RGB.png", 1, 1100),
    ("green", "STEM Racing Gradients_Green RGB.png", 1, 1100),
    ("full-range", "STEM Racing Gradients_Full Range RGB.png", 1, 1100),
    ("hot", "STEM Racing Gradients_Hot RGB.png", 1, 1100),
    ("pink-orange", "STEM Racing Gradients_Pink Orange RGB.png", 1, 1100),
    ("orange-yellow", "STEM Racing Gradients_Orange Yellow RGB.png", 1, 1100),
]
here = os.path.dirname(os.path.abspath(__file__))
rows = []
with tempfile.TemporaryDirectory() as tmp:
    for key, name, rot, size in SETS:
        out = os.path.join(tmp, key + ".jpg")
        subprocess.run(["sips", "-Z", str(size), "-s", "format", "jpeg", "-s", "formatOptions", "88",
                        os.path.join(SRC, name), "--out", out], check=True, stdout=subprocess.DEVNULL)
        data = base64.b64encode(open(out, "rb").read()).decode()
        rows.append('  "%s": {rot: %d, src: "data:image/jpeg;base64,%s"}' % (key, rot, data))
code = open(os.path.join(here, "sr-background.src.js")).read()
open(os.path.join(here, "sr-background.js"), "w").write(code.replace("/*__SETS__*/", ",\n".join(rows)))
print("wrote sr-background.js with", len(rows), "gradients")
