#!/usr/bin/env python3
"""Rasterise pages of the sample PDFs so the guide can show real output.

Called by build-guide.js. Needs pypdfium2 (pip install pypdfium2 pillow).
Usage: render-pages.py <out-dir> <pdf> <page-index> <name> [<pdf> <index> <name> ...]
"""
import sys, os

try:
    import pypdfium2 as pdfium
except ImportError:
    sys.stderr.write(
        "pypdfium2 is not installed, so the guide cannot show sample PDF pages.\n"
        "Install it with:  pip install pypdfium2 pillow\n")
    sys.exit(2)

out_dir, rest = sys.argv[1], sys.argv[2:]
os.makedirs(out_dir, exist_ok=True)
docs = {}

for i in range(0, len(rest), 3):
    path, index, name = rest[i], int(rest[i + 1]), rest[i + 2]
    if path not in docs:
        docs[path] = pdfium.PdfDocument(path)
    doc = docs[path]
    page = doc[index if index >= 0 else len(doc) + index]
    page.render(scale=2.2).to_pil().save(os.path.join(out_dir, name + ".png"))
    print("  " + name + ".png")
