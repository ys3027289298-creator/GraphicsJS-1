#!/usr/bin/env python3
"""Pixel-level comparison of an independent SVG rasterization against the
MuPDF rasterization of the generated PDF.

Two independent renderers will never be bit-identical (different anti-aliasing
and text hinting), so this measures geometric fidelity instead of exact
equality: ink-mask IoU, centroid displacement, bounding-box agreement and the
presence of the expected blended/gradient colors.
"""
import json
import os
import sys

_user_site = os.path.expanduser("~/.local/lib/python%d.%d/site-packages" % sys.version_info[:2])
if os.path.isdir(_user_site) and _user_site not in sys.path:
    sys.path.insert(0, _user_site)

from PIL import Image


def ink_mask(im):
    im = im.convert("RGB")
    px = im.load()
    w, h = im.size
    mask = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if not (r > 248 and g > 248 and b > 248):
                mask[y * w + x] = 1
    return mask, (w, h)


def main(svg_png, pdf_png, out_json):
    a = Image.open(svg_png)
    b = Image.open(pdf_png)
    # Normalize to a common size (the SVG render is the reference).
    if a.size != b.size:
        b = b.resize(a.size, Image.LANCZOS)
    ma, (w, h) = ink_mask(a)
    mb, _ = ink_mask(b)
    inter = sum(1 for i in range(len(ma)) if ma[i] and mb[i])
    union = sum(1 for i in range(len(ma)) if ma[i] or mb[i])
    iou = inter / union if union else 0.0

    def centroid(mask):
        sx = sy = n = 0
        for idx, v in enumerate(mask):
            if v:
                sx += idx % w
                sy += idx // w
                n += 1
        return (sx / n, sy / n) if n else (0, 0)

    ca, cb = centroid(ma), centroid(mb)
    centroid_disp = ((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2) ** 0.5

    def bbox(mask):
        xs = [i % w for i, v in enumerate(mask) if v]
        ys = [i // w for i, v in enumerate(mask) if v]
        return (min(xs), min(ys), max(xs), max(ys)) if xs else None

    ba, bb = bbox(ma), bbox(mb)

    # Distinct colors as a proxy for gradient interpolation and alpha blending.
    def colors(im):
        return set(im.convert("RGB").getdata())
    ca_n, cb_n = len(colors(a)), len(colors(b))

    report = {
        "commonSize": [w, h],
        "inkIoU": round(iou, 4),
        "centroidDisplacementPx": round(centroid_disp, 3),
        "svgBBox": ba,
        "pdfBBox": bb,
        "svgDistinctColors": ca_n,
        "pdfDistinctColors": cb_n,
        "interpretation": {
            "iou": "fraction of inked pixels shared between the two independent renderers (1=perfect overlap)",
            "centroid": "distance between ink centroids in pixels (0=perfect alignment)"
        }
    }
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
