"""Extract the embedded PDF text layer for Node.js quality fallback."""

from __future__ import annotations

import sys
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: extract-text-layer.py <pdf>", file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1]).resolve()
    reader = PdfReader(pdf_path)
    pages = [(page.extract_text() or "").strip() for page in reader.pages]
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write("\f".join(pages))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
