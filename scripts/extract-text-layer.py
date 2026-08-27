"""Extract embedded PDF text layer or count pages for Node.js fallback."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pypdf import PdfReader


def parse_page_indices(pages_arg: str | None, total_pages: int) -> list[int]:
    """Parse 1-based page range string (e.g. '1,3,5-7') to 0-based page indices."""
    if not pages_arg or not pages_arg.strip():
        return list(range(total_pages))

    indices: set[int] = set()
    parts = [p.strip() for p in pages_arg.split(",") if p.strip()]

    for part in parts:
        if "-" in part:
            segments = part.split("-", 1)
            try:
                start = int(segments[0].strip())
                end = int(segments[1].strip())
            except ValueError:
                continue
            if start > end:
                start, end = end, start
            for page_num in range(start, end + 1):
                if 1 <= page_num <= total_pages:
                    indices.add(page_num - 1)
        else:
            try:
                page_num = int(part)
                if 1 <= page_num <= total_pages:
                    indices.add(page_num - 1)
            except ValueError:
                continue

    return sorted(indices)


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF text extractor and page counter.")
    parser.add_argument("pdf", type=str, help="Path to PDF file")
    parser.add_argument("--count", action="store_true", help="Print total page count and exit")
    parser.add_argument("-p", "--pages", type=str, default=None, help="Page range to extract (e.g. 1,3,5-7)")

    args = parser.parse_args()
    pdf_path = Path(args.pdf).resolve()

    if not pdf_path.is_file():
        print(f"File not found: {pdf_path}", file=sys.stderr)
        return 1

    reader = PdfReader(pdf_path)
    total_pages = len(reader.pages)

    if args.count:
        sys.stdout.write(str(total_pages))
        return 0

    page_indices = parse_page_indices(args.pages, total_pages)
    extracted = [(reader.pages[idx].extract_text() or "").strip() for idx in page_indices]

    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write("\f".join(extracted))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

