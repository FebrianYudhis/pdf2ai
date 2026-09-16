"""Run OpenDataLoader's hybrid server with optional low-memory Docling tuning.

OpenDataLoader 2.5.0 does not expose Docling's threaded-stage queue and batch
settings on its CLI. This launcher adjusts the converter before Docling lazily
initializes the PDF pipeline, so the setting survives dependency reinstalls.
It also provides in-process model lazy-unloading to relieve RAM during idle periods
without terminating the server process.
"""

from __future__ import annotations

import asyncio
import gc
import inspect
import os
import sys
import threading
import time

from docling.datamodel.base_models import InputFormat
from opendataloader_pdf import hybrid_server


_original_create_converter = hybrid_server.create_converter
_original_create_app = hybrid_server.create_app


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


def _get_idle_timeout() -> float:
    raw_value = os.environ.get("ODL_OCR_IDLE_TIMEOUT")
    if raw_value is None:
        return 180.0
    try:
        val = float(raw_value)
        return val if val > 0 else 0.0
    except ValueError:
        return 180.0


def _trim_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        elif hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
            try:
                torch.mps.empty_cache()
            except Exception:
                pass
    except Exception:
        pass

    if sys.platform == "win32":
        try:
            import ctypes
            import ctypes.wintypes

            kernel32 = ctypes.windll.kernel32
            psapi = ctypes.windll.psapi
            kernel32.GetCurrentProcess.restype = ctypes.wintypes.HANDLE
            psapi.EmptyWorkingSet.argtypes = [ctypes.wintypes.HANDLE]
            psapi.EmptyWorkingSet(kernel32.GetCurrentProcess())
        except Exception:
            pass
    elif sys.platform.startswith("linux"):
        try:
            import ctypes
            import ctypes.util

            libc_name = ctypes.util.find_library("c") or "libc.so.6"
            libc = ctypes.CDLL(libc_name)
            if hasattr(libc, "malloc_trim"):
                libc.malloc_trim(0)
        except Exception:
            pass


def _wrap_converter_memory_cleanup(converter):
    original_convert = getattr(converter, "convert", None)
    if callable(original_convert):
        def _wrapped_convert(*c_args, **c_kwargs):
            try:
                return original_convert(*c_args, **c_kwargs)
            finally:
                _trim_memory()

        converter.convert = _wrapped_convert

    original_convert_all = getattr(converter, "convert_all", None)
    if callable(original_convert_all):
        def _wrapped_convert_all(*c_args, **c_kwargs):
            try:
                for item in original_convert_all(*c_args, **c_kwargs):
                    yield item
            finally:
                _trim_memory()

        converter.convert_all = _wrapped_convert_all

    return converter


def create_converter(*args, **kwargs):
    converter = _original_create_converter(*args, **kwargs)
    converter = _wrap_converter_memory_cleanup(converter)
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


def create_app(*app_args, **app_kwargs):
    sig = inspect.signature(_original_create_app)
    bound = sig.bind(*app_args, **app_kwargs)
    bound.apply_defaults()
    params = bound.arguments

    converter_kwargs = {
        "force_full_page_ocr": params.get("force_ocr", False),
        "disable_ocr": params.get("disable_ocr", False),
        "ocr_engine": params.get("ocr_engine", "easyocr"),
        "psm": params.get("psm", None),
        "ocr_lang": params.get("ocr_lang", None),
        "enrich_formula": params.get("enrich_formula", False),
        "enrich_picture_description": params.get("enrich_picture_description", False),
        "picture_description_prompt": params.get("picture_description_prompt", None),
        "device": params.get("device", "auto"),
    }

    app = _original_create_app(*app_args, **app_kwargs)

    model_lock = threading.Lock()
    idle_timer: threading.Timer | None = None
    active_conversions = 0

    def _unload_models() -> bool:
        nonlocal idle_timer
        with model_lock:
            if idle_timer:
                idle_timer.cancel()
                idle_timer = None
            if active_conversions > 0:
                return False
            convert_lock = getattr(hybrid_server, "_convert_lock", None)
            if convert_lock is not None and hasattr(convert_lock, "locked") and convert_lock.locked():
                return False
            if hybrid_server.converter is not None:
                hybrid_server.converter = None
                _trim_memory()
                sys.stderr.write(
                    "[Hybrid Server] Bobot model Docling dilepas dari RAM (in-process idle unload). "
                    "Memori RAM berhasil dipangkas.\n"
                )
                sys.stderr.flush()
            return True

    def _ensure_models_loaded() -> None:
        with model_lock:
            if hybrid_server.converter is None:
                sys.stderr.write(
                    "[Hybrid Server] Permintaan konversi diterima. "
                    "Memuat ulang bobot model Docling ke RAM (on-demand)...\n"
                )
                sys.stderr.flush()
                t0 = time.perf_counter()
                hybrid_server.converter = hybrid_server.create_converter(**converter_kwargs)
                elapsed = time.perf_counter() - t0
                sys.stderr.write(
                    f"[Hybrid Server] Model Docling siap dalam {elapsed:.2f}s.\n"
                )
                sys.stderr.flush()

    def _cancel_idle_timer() -> None:
        nonlocal idle_timer
        with model_lock:
            if idle_timer:
                idle_timer.cancel()
                idle_timer = None

    def _schedule_idle_timer() -> None:
        nonlocal idle_timer
        timeout = _get_idle_timeout()
        if timeout <= 0:
            return
        with model_lock:
            if active_conversions > 0:
                return
            if idle_timer:
                idle_timer.cancel()
            idle_timer = threading.Timer(timeout, _unload_models)
            idle_timer.daemon = True
            idle_timer.start()

    @app.api_route("/v1/unload", methods=["GET", "POST"])
    def unload_models_endpoint():
        success = _unload_models()
        if not success:
            return {"status": "busy", "state": "busy", "message": "Conversion in progress"}
        return {"status": "ok", "state": "unloaded"}

    class LazyModelMiddleware:
        def __init__(self, inner_app):
            self.inner_app = inner_app

        async def __call__(self, scope, receive, send):
            if scope["type"] == "http":
                path = scope.get("path", "")
                if path.startswith("/v1/convert") or path.startswith("/v1/profile"):
                    nonlocal active_conversions
                    with model_lock:
                        active_conversions += 1
                        _cancel_idle_timer()
                    try:
                        if hybrid_server.converter is None:
                            await asyncio.to_thread(_ensure_models_loaded)
                        await self.inner_app(scope, receive, send)
                        return
                    finally:
                        with model_lock:
                            active_conversions = max(0, active_conversions - 1)
                        if active_conversions == 0:
                            _schedule_idle_timer()
            await self.inner_app(scope, receive, send)

    app.add_middleware(LazyModelMiddleware)
    _schedule_idle_timer()

    return app


hybrid_server.create_app = create_app


if __name__ == "__main__":
    raise SystemExit(hybrid_server.main())
