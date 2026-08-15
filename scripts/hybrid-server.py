"""Run OpenDataLoader's hybrid server with optional low-memory Docling tuning.

OpenDataLoader 2.5.0 does not expose Docling's threaded-stage queue and batch
settings on its CLI. This launcher adjusts the converter before Docling lazily
initializes the PDF pipeline, so the setting survives dependency reinstalls.
"""

from __future__ import annotations

import os

from docling.datamodel.base_models import InputFormat
from opendataloader_pdf import hybrid_server


_original_create_converter = hybrid_server.create_converter


def _enabled(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _positive_float(name: str, default: float) -> float:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    value = float(raw_value)
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def create_converter(*args, **kwargs):
    converter = _original_create_converter(*args, **kwargs)
    if not _enabled(os.environ.get("ODL_LOW_MEMORY_MODE")):
        return converter

    options = converter.format_to_options[InputFormat.PDF].pipeline_options

    # A one-item queue creates backpressure between threaded stages. Without
    # this, the default queue of 100 can retain many rendered scan pages while
    # OCR/layout is working and eventually trigger std::bad_alloc.
    options.queue_max_size = 1
    options.ocr_batch_size = 1
    options.layout_batch_size = 1
    options.table_batch_size = 1

    # Docling defaults OCR to scale 3 (216 DPI). Scale 2 (144 DPI) materially
    # lowers peak bitmap memory while remaining suitable for ordinary text.
    options.ocr_options.scale = _positive_float("ODL_OCR_SCALE", 2.0)
    return converter


hybrid_server.create_converter = create_converter


if __name__ == "__main__":
    raise SystemExit(hybrid_server.main())
