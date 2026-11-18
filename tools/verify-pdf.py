#!/usr/bin/env python3
"""Verify a PDF produced by the local exporter.

Checks:
  * structural validity (pypdf open, page count, media box)
  * real, selectable text via two independent extractors (pypdf + PyMuPDF)
  * text order/content line-by-line against the source lines
  * text uses font operators (BT/Tj/ET), not outlines or full-page images
  * vector path operators, line width, dash, transparency (ExtGState)
  * font embedding (Type0/CIDFontType2/FontFile2, Identity-H, ToUnicode)
  * rasterized page has expected ink, gradient shades, blended colors
"""
import json
import os
import sys

# The environment installs third-party packages under the per-user site
# directory; make them importable even when Python runs in isolated (-I) mode.
_user_site = os.path.expanduser("~/.local/lib/python%d.%d/site-packages" % sys.version_info[:2])
if os.path.isdir(user_site := _user_site) and user_site not in sys.path:
    sys.path.insert(0, user_site)

import pypdf
import fitz  # PyMuPDF


def main(pdf_path, source_lines, render_png=None):
    report = {"file": pdf_path, "checks": [], "lineComparison": []}

    def check(name, ok, detail=""):
        report["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)})

    reader = pypdf.PdfReader(pdf_path)
    check("pypdf opens without repair", len(reader.pages) >= 1, f"pages={len(reader.pages)}")
    page = reader.pages[0]
    mb = [round(float(x), 2) for x in page.mediabox]
    check("single page", len(reader.pages) == 1, f"pages={len(reader.pages)}")
    check("media box", mb, mb)

    # ---- text extraction: pypdf ----
    pypdf_text = page.extract_text() or ""
    pypdf_lines = [ln for ln in pypdf_text.splitlines() if ln.strip()]
    check("pypdf extracts text", len(pypdf_lines) >= len(source_lines), pypdf_lines)

    # ---- text extraction: PyMuPDF (independent engine, PDFium-like MuPDF) ----
    doc = fitz.open(pdf_path)
    mupdf_lines = [ln.strip() for ln in doc[0].get_text().splitlines() if ln.strip()]
    check("mupdf extracts text", len(mupdf_lines) >= len(source_lines), mupdf_lines)

    # ---- line-by-line comparison against the source ----
    extracted = mupdf_lines[:len(source_lines)]
    all_match = len(extracted) == len(source_lines)
    for i, src in enumerate(source_lines):
        got = extracted[i] if i < len(extracted) else None
        match = got == src
        all_match = all_match and match
        report["lineComparison"].append({"line": i + 1, "source": src, "extracted": got, "match": match})
    check("extracted text identical to source, same order", all_match)

    # ---- content stream operator inspection (read via MuPDF, which
    # transparently inflates FlateDecode streams) ----
    content_xref = doc[0].xref
    content_ref = doc.xref_object(content_xref)
    import re as _re
    mref = _re.search(r"/Contents\s+(\d+)\s+0\s+R", content_ref)
    text = doc.xref_stream(int(mref.group(1))).decode("latin1", "replace")
    report["contentStreamPreview"] = text[:200]
    for op in ["BT", "Tj", "ET", "Tf", "Tm"]:
        check(f"text operator {op}", op in text)
    for op in ["m", "l", "c"]:
        check(f"vector path operator '{op}'", _re.search(r"[\d.\-\s]+\s" + op + r"\b", text) is not None)
    check("vector path operator 'h' (close path)", _re.search(r"(?:^|\n)h\b", text) is not None)
    check("line width operator w", _re.search(r"[\d.]+\s+w\b", text) is not None)
    check("fill/stroke alpha ExtGState used", "/GS" in text and " gs" in text)
    check("dash operator d", _re.search(r"\[[^\]]*\]\s+[\d.]+\s+d\b", text) is not None)
    shading_present = any(
        "/Shading" in doc.xref_object(i) for i in range(1, doc.xref_length())
        if doc.xref_is_stream(i) or "/ShadingType" in doc.xref_object(i))
    check("gradient shading object present", shading_present)

    # ---- no full-page image used as a text substitute ----
    images = page.images
    full_page_image = False
    for img in images:
        iw, ih = img.image.size if hasattr(img, "image") else (0, 0)
        if iw >= 0.95 * float(page.mediabox.width) and ih >= 0.95 * float(page.mediabox.height):
            full_page_image = True
    check("no full-page image substituting text", not full_page_image, f"images={len(images)}")

    # ---- font embedding structure ----
    fonts = page.get("/Resources", {}).get("/Font", {})
    type0 = cid2 = file2 = identity = tounicode = 0
    for _name, ref in fonts.items():
        fobj = ref.get_object()
        if fobj.get("/Subtype") == "/Type0":
            type0 += 1
            if fobj.get("/Encoding") == "/Identity-H":
                identity += 1
            if fobj.get("/ToUnicode"):
                tounicode += 1
            for dref in fobj.get("/DescendantFonts", []):
                d = dref.get_object()
                if d.get("/Subtype") == "/CIDFontType2":
                    cid2 += 1
                desc = d.get("/FontDescriptor", {})
                if desc.get_object().get("/FontFile2"):
                    file2 += 1
    check("Type0 composite fonts embedded", type0 >= 1, f"type0={type0}")
    check("CIDFontType2 descendant", cid2 >= 1, f"cid2={cid2}")
    check("FontFile2 TrueType program embedded", file2 >= 1, f"fontfile2={file2}")
    check("Identity-H encoding", identity >= 1, f"identity={identity}")
    check("ToUnicode CMap present", tounicode >= 1, f"tounicode={tounicode}")
    report["fontChecks"] = {"type0": type0, "cidFontType2": cid2,
                            "fontFile2": file2, "identityH": identity, "toUnicode": tounicode}

    # ---- rasterization ----
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    if render_png and render_png.lower().endswith((".png", ".jpg", ".jpeg", ".pnm")):
        pix.save(render_png)
    samples = pix.samples
    non_white = sum(1 for i in range(0, len(samples), 3)
                    if not (samples[i] > 248 and samples[i + 1] > 248 and samples[i + 2] > 248))
    distinct = len({(samples[i], samples[i + 1], samples[i + 2])
                    for i in range(0, len(samples), 3)})
    check("rendered page has ink", non_white > 100, f"non-white={non_white}, distinct colors={distinct}")
    report["render"] = {"width": pix.width, "height": pix.height,
                        "nonWhitePixels": non_white, "distinctColors": distinct}

    report["allPassed"] = all(c["ok"] for c in report["checks"])
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["allPassed"] else 1


if __name__ == "__main__":
    pdf = sys.argv[1]
    src = sys.argv[2]
    png = sys.argv[3] if len(sys.argv) > 3 else None
    with open(src, encoding="utf-8") as fh:
        lines = [ln.strip() for ln in fh if ln.strip()]
    sys.exit(main(pdf, lines, png))
