#!/usr/bin/env python3
"""Windows screen-capture backend for the DSH screenshot plugin.

One invocation does one job and prints exactly one JSON object on stdout:

    {"ok": true, "value": {...}}
    {"ok": false, "error": {"code": "...", "message": "..."}}

The plugin owns argument validation and image routing; this script owns the
Win32/Pillow specifics. It never reads stdin and never invokes a shell.

Why screen-region capture instead of a window handle: on this machine
ImageGrab.grab(window=hwnd) and PrintWindow() both return an all-black bitmap
for Electron/Chromium windows. Cropping the on-screen rectangle produces the
real pixels, so a window capture requires the window to be visible (the plugin
optionally raises it first).
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    from PIL import Image, ImageGrab
except Exception as exc:  # pragma: no cover - exercised only on a broken runtime
    print(json.dumps({
        "ok": False,
        "error": {
            "code": "SCREENSHOT_PIL_MISSING",
            "message": f"Pillow is not importable by this Python: {exc}",
        },
    }))
    raise SystemExit(2)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

if sys.platform != "win32":
    print(json.dumps({
        "ok": False,
        "error": {
            "code": "SCREENSHOT_UNSUPPORTED_PLATFORM",
            "message": f"this capture backend is Windows-only (got {sys.platform})",
        },
    }))
    raise SystemExit(2)


class CaptureError(Exception):
    def __init__(self, code: str, message: str, **extra: object) -> None:
        super().__init__(message)
        self.code = code
        self.extra = extra


user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
try:
    dwmapi = ctypes.windll.dwmapi
except Exception:  # pragma: no cover - DWM exists on every supported Windows
    dwmapi = None

EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
DWMWA_EXTENDED_FRAME_BOUNDS = 9
DWMWA_CLOAKED = 14
SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SW_RESTORE = 9


def _configure_signatures() -> None:
    user32.EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.IsIconic.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowLongW.restype = ctypes.c_long
    user32.GetForegroundWindow.argtypes = []
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetSystemMetrics.argtypes = [ctypes.c_int]
    user32.GetSystemMetrics.restype = ctypes.c_int
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL
    user32.BringWindowToTop.argtypes = [wintypes.HWND]
    user32.BringWindowToTop.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [
        wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, ctypes.c_int, ctypes.c_uint,
    ]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    user32.AttachThreadInput.restype = wintypes.BOOL
    kernel32.GetCurrentThreadId.argtypes = []
    kernel32.GetCurrentThreadId.restype = wintypes.DWORD
    user32.SetProcessDPIAware.argtypes = []
    user32.SetProcessDPIAware.restype = wintypes.BOOL

    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD),
    ]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    if dwmapi is not None:
        dwmapi.DwmGetWindowAttribute.argtypes = [
            wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
        ]
        dwmapi.DwmGetWindowAttribute.restype = ctypes.c_long


_configure_signatures()


def enable_dpi_awareness() -> str:
    """Make Win32 rectangles and GDI pixels share one physical-pixel space."""
    try:
        set_context = user32.SetProcessDpiAwarenessContext
        set_context.argtypes = [ctypes.c_void_p]
        set_context.restype = wintypes.BOOL
        if set_context(ctypes.c_void_p(-4)):  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            return "per-monitor-v2"
    except Exception:
        pass
    try:
        shcore = ctypes.windll.shcore
        shcore.SetProcessDpiAwareness.argtypes = [ctypes.c_int]
        shcore.SetProcessDpiAwareness.restype = ctypes.c_long
        if shcore.SetProcessDpiAwareness(2) == 0:  # PROCESS_PER_MONITOR_DPI_AWARE
            return "per-monitor"
    except Exception:
        pass
    try:
        if user32.SetProcessDPIAware():
            return "system"
    except Exception:
        pass
    return "none"


def process_name(pid: int) -> str:
    if pid <= 0:
        return ""
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        buffer = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(len(buffer))
        if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return os.path.basename(buffer.value)
    finally:
        kernel32.CloseHandle(handle)
    return ""


def is_cloaked(hwnd: int) -> bool:
    if dwmapi is None:
        return False
    value = ctypes.c_int(0)
    try:
        result = dwmapi.DwmGetWindowAttribute(
            hwnd, DWMWA_CLOAKED, ctypes.byref(value), ctypes.sizeof(value),
        )
        return result == 0 and value.value != 0
    except Exception:
        return False


def window_rect(hwnd: int) -> tuple[int, int, int, int] | None:
    rect = wintypes.RECT()
    if dwmapi is not None:
        try:
            result = dwmapi.DwmGetWindowAttribute(
                hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(rect), ctypes.sizeof(rect),
            )
            if result == 0 and rect.right > rect.left and rect.bottom > rect.top:
                return (rect.left, rect.top, rect.right, rect.bottom)
        except Exception:
            pass
    if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return (rect.left, rect.top, rect.right, rect.bottom)
    return None


def rect_dict(rect: tuple[int, int, int, int]) -> dict[str, int]:
    left, top, right, bottom = rect
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def virtual_screen() -> tuple[int, int, int, int]:
    width = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
    height = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)
    if width <= 0 or height <= 0:
        return (0, 0, max(1, user32.GetSystemMetrics(0)), max(1, user32.GetSystemMetrics(1)))
    return (
        user32.GetSystemMetrics(SM_XVIRTUALSCREEN),
        user32.GetSystemMetrics(SM_YVIRTUALSCREEN),
        width,
        height,
    )


def list_windows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    foreground = user32.GetForegroundWindow()

    def callback(hwnd, _lparam):  # noqa: ANN001 - ctypes callback signature
        try:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & 0xFFFFFFFF
            if style & WS_EX_TOOLWINDOW:
                return True
            if is_cloaked(hwnd):
                return True
            rect = window_rect(hwnd)
            if rect is None:
                return True
            left, top, right, bottom = rect
            if right - left <= 0 or bottom - top <= 0:
                return True
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            pid = wintypes.DWORD(0)
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            rows.append({
                "_hwnd": int(hwnd),
                "title": buffer.value,
                "pid": int(pid.value),
                "process": process_name(int(pid.value)),
                "rect": rect_dict(rect),
                "foreground": int(hwnd) == int(foreground or 0),
                "minimized": bool(user32.IsIconic(hwnd)),
            })
        except Exception:
            # One unreadable window must not hide every other window.
            return True
        return True

    user32.EnumWindows(EnumWindowsProc(callback), 0)
    rows.sort(key=lambda row: (not bool(row["foreground"]), str(row["title"]).casefold()))
    return rows


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def is_black(image: Image.Image) -> bool:
    return all(high == 0 for _low, high in image.convert("RGB").getextrema())


def downscale(image: Image.Image, max_edge: int) -> tuple[Image.Image, int, int]:
    width, height = image.size
    if max_edge <= 0 or max(width, height) <= max_edge:
        return image, width, height
    resized = image.copy()
    resized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    return resized, width, height


def grab_rect(rect: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = rect
    return ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True)


def capture_rect(
    rect: tuple[int, int, int, int],
    out: str,
    max_edge: int,
    region: tuple[int, int, int, int] | None,
    *,
    kind: str,
    window: dict[str, object] | None,
    warnings: list[str],
    allow_activate_retry: bool = False,
    hwnd: int | None = None,
) -> dict[str, object]:
    virtual_x, virtual_y, virtual_width, virtual_height = virtual_screen()
    left, top, right, bottom = rect
    x0 = max(left, virtual_x)
    y0 = max(top, virtual_y)
    x1 = min(right, virtual_x + virtual_width)
    y1 = min(bottom, virtual_y + virtual_height)
    if x1 <= x0 or y1 <= y0:
        raise CaptureError(
            "SCREENSHOT_OFFSCREEN",
            "the target rectangle is outside the visible desktop; restore or move the window",
        )
    if (x0, y0, x1, y1) != (left, top, right, bottom):
        warnings.append("capture was clipped to the visible desktop")

    image = grab_rect((x0, y0, x1, y1))
    if is_black(image) and allow_activate_retry and hwnd is not None:
        activate_window(hwnd)
        time.sleep(0.2)
        rect = window_rect(hwnd)
        if rect is not None:
            left, top, right, bottom = rect
            x0 = max(left, virtual_x)
            y0 = max(top, virtual_y)
            x1 = min(right, virtual_x + virtual_width)
            y1 = min(bottom, virtual_y + virtual_height)
            image = grab_rect((x0, y0, x1, y1))

    if is_black(image):
        raise CaptureError(
            "SCREENSHOT_BLACK",
            "the captured area is entirely black; the window may be minimized, occluded, or protected. "
            "Bring it to the foreground, pass activate=true for a window target, or capture the full screen.",
        )

    if region is not None:
        region_x, region_y, region_width, region_height = region
        if (
            region_x < 0 or region_y < 0
            or region_x + region_width > image.width
            or region_y + region_height > image.height
        ):
            raise CaptureError(
                "SCREENSHOT_REGION_OUT_OF_BOUNDS",
                f"region {region_width}x{region_height} at ({region_x},{region_y}) exceeds "
                f"the {image.width}x{image.height} capture",
            )
        image = image.crop((region_x, region_y, region_x + region_width, region_y + region_height))
        x0 += region_x
        y0 += region_y

    source_width, source_height = image.size
    image, _width, _height = downscale(image, max_edge)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    image.save(out, format="PNG", optimize=False)

    value: dict[str, object] = {
        "path": out,
        "kind": kind,
        "width": image.width,
        "height": image.height,
        "bytes": os.path.getsize(out),
        "origin": {"x": x0, "y": y0},
        "scale": 1.0,
        "capturedAt": iso_now(),
    }
    if (source_width, source_height) != image.size:
        value["sourceWidth"] = source_width
        value["sourceHeight"] = source_height
    if window is not None:
        value["window"] = window
    if warnings:
        value["warnings"] = warnings
    return value


def capture_screen(out: str, max_edge: int, region: tuple[int, int, int, int] | None) -> dict[str, object]:
    virtual_x, virtual_y, virtual_width, virtual_height = virtual_screen()
    warnings: list[str] = []
    return capture_rect(
        (virtual_x, virtual_y, virtual_x + virtual_width, virtual_y + virtual_height),
        out,
        max_edge,
        region,
        kind="screen",
        window=None,
        warnings=warnings,
    )


def activate_window(hwnd: int) -> bool:
    """Best-effort foreground activation, including Windows' input-attach workaround."""
    if int(user32.GetForegroundWindow() or 0) == hwnd:
        return True
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
        time.sleep(0.15)
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_SHOWWINDOW = 0x0040
    user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    if int(user32.GetForegroundWindow() or 0) == hwnd:
        return True

    foreground = user32.GetForegroundWindow()
    foreground_pid = wintypes.DWORD(0)
    foreground_thread = (
        user32.GetWindowThreadProcessId(foreground, ctypes.byref(foreground_pid))
        if foreground else 0
    )
    current_thread = kernel32.GetCurrentThreadId()
    attached = False
    if foreground_thread and foreground_thread != current_thread:
        attached = bool(user32.AttachThreadInput(current_thread, foreground_thread, True))
    try:
        user32.SetForegroundWindow(hwnd)
        user32.BringWindowToTop(hwnd)
    finally:
        if attached:
            user32.AttachThreadInput(current_thread, foreground_thread, False)
    if int(user32.GetForegroundWindow() or 0) == hwnd:
        return True
    try:
        switch = user32.SwitchToThisWindow
        switch.argtypes = [wintypes.HWND, wintypes.BOOL]
        switch.restype = None
        switch(hwnd, True)
    except Exception:
        pass
    time.sleep(0.1)
    return int(user32.GetForegroundWindow() or 0) == hwnd


def find_window(title: str) -> tuple[dict[str, object], list[str]]:
    windows = list_windows()
    needle = title.casefold()
    exact = [row for row in windows if str(row["title"]).casefold() == needle]
    matches = exact or [row for row in windows if needle in str(row["title"]).casefold()]
    if not matches:
        titles = ", ".join(f'"{row["title"]}"' for row in windows[:8]) or "(none)"
        raise CaptureError(
            "SCREENSHOT_WINDOW_NOT_FOUND",
            f'no visible window title matches "{title}"; visible titles: {titles}',
        )
    warnings: list[str] = []
    if len(matches) > 1:
        warnings.append(f'{len(matches)} windows matched "{title}"; captured the first foreground match')
        matches.sort(key=lambda row: (not bool(row["foreground"]), str(row["title"]).casefold()))
    return matches[0], warnings


def capture_window(
    title: str,
    out: str,
    max_edge: int,
    region: tuple[int, int, int, int] | None,
    activate: bool,
) -> dict[str, object]:
    window, warnings = find_window(title)
    minimized = bool(window["minimized"])
    if minimized and not activate:
        raise CaptureError(
            "SCREENSHOT_WINDOW_MINIMIZED",
            f'window "{window["title"]}" is minimized; pass activate=true or restore it',
        )

    target_hwnd = int(window["_hwnd"])
    needle = str(window["title"])
    if not target_hwnd:
        raise CaptureError("SCREENSHOT_WINDOW_GONE", f'window "{needle}" disappeared before capture')

    if activate:
        if not activate_window(target_hwnd):
            warnings.append("the window did not become foreground; the capture may include overlapping windows")
        time.sleep(0.15)

    rect = window_rect(target_hwnd)
    if rect is None:
        raise CaptureError("SCREENSHOT_WINDOW_GONE", f'window "{needle}" has no readable rectangle')
    left, top, right, bottom = rect
    if right - left <= 0 or bottom - top <= 0:
        raise CaptureError("SCREENSHOT_WINDOW_MINIMIZED", f'window "{needle}" has no visible area')

    foreground = int(user32.GetForegroundWindow() or 0) == target_hwnd
    if not foreground:
        warnings.append("the window is not foreground; the capture may include overlapping windows; pass activate=true")
    info = {
        "title": window["title"],
        "pid": window["pid"],
        "process": window["process"],
        "rect": rect_dict(rect),
        "foreground": foreground,
        "minimized": bool(user32.IsIconic(target_hwnd)),
    }
    return capture_rect(
        rect,
        out,
        max_edge,
        region,
        kind="window",
        window=info,
        warnings=warnings,
        allow_activate_retry=activate,
        hwnd=target_hwnd,
    )


def capture_active(out: str, max_edge: int, region: tuple[int, int, int, int] | None) -> dict[str, object]:
    hwnd = int(user32.GetForegroundWindow() or 0)
    if not hwnd:
        raise CaptureError("SCREENSHOT_NO_FOREGROUND", "no foreground window is available")
    rect = window_rect(hwnd)
    if rect is None:
        raise CaptureError("SCREENSHOT_NO_FOREGROUND", "the foreground window has no readable rectangle")
    windows = list_windows()
    match = next((row for row in windows if row["_hwnd"] == hwnd), None)
    warnings: list[str] = []
    info = None
    if match is not None:
        info = {
            "title": match["title"],
            "pid": match["pid"],
            "process": match["process"],
            "rect": rect_dict(rect),
            "foreground": True,
            "minimized": bool(match["minimized"]),
        }
    else:
        warnings.append("the foreground window is not in the visible-window list")
    return capture_rect(
        rect,
        out,
        max_edge,
        region,
        kind="active",
        window=info,
        warnings=warnings,
        allow_activate_retry=False,
        hwnd=hwnd,
    )


def crop_file(source: str, out: str, region: tuple[int, int, int, int]) -> dict[str, object]:
    x, y, width, height = region
    with Image.open(source) as image:
        image.load()
        if x < 0 or y < 0 or x + width > image.width or y + height > image.height:
            raise CaptureError(
                "SCREENSHOT_REGION_OUT_OF_BOUNDS",
                f"region {width}x{height} at ({x},{y}) exceeds the {image.width}x{image.height} image",
            )
        cropped = image.crop((x, y, x + width, y + height))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        cropped.save(out, format="PNG", optimize=False)
        return {"path": out, "width": cropped.width, "height": cropped.height, "bytes": os.path.getsize(out)}


def shrink_file(source: str, out: str, max_edge: int) -> dict[str, object]:
    with Image.open(source) as image:
        image.load()
        width, height = image.size
        resized, _source_width, _source_height = downscale(image, max_edge)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        resized.save(out, format="PNG", optimize=False)
        return {
            "path": out,
            "width": resized.width,
            "height": resized.height,
            "bytes": os.path.getsize(out),
            "sourceWidth": width,
            "sourceHeight": height,
        }


def parse_region(text: str | None) -> tuple[int, int, int, int] | None:
    if text is None or text.strip() == "":
        return None
    try:
        parts = [int(part.strip()) for part in text.split(",")]
    except ValueError as exc:
        raise CaptureError("SCREENSHOT_REGION_INVALID", f"region must be x,y,width,height: {text}") from exc
    if len(parts) != 4:
        raise CaptureError("SCREENSHOT_REGION_INVALID", f"region must be x,y,width,height: {text}")
    x, y, width, height = parts
    if width <= 0 or height <= 0:
        raise CaptureError("SCREENSHOT_REGION_INVALID", "region width and height must be positive")
    return (x, y, width, height)


def emit(payload: dict[str, object], result_path: str | None) -> None:
    """Write the result where the host can read it without a stdout pipe.

    DSH's Windows sandbox can deny piped stdio, so the plugin passes --result
    and reads the JSON from a file. Manual invocations still get stdout.
    """
    text = json.dumps(payload, ensure_ascii=False)
    if result_path:
        try:
            parent = os.path.dirname(result_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(result_path, "w", encoding="utf-8") as handle:
                handle.write(text)
            return
        except Exception:
            pass
    print(text)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DSH screenshot capture backend")
    parser.add_argument("--result", help="write the JSON result to this file instead of stdout")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="list visible top-level windows")

    for command in ("active", "screen"):
        sub = subparsers.add_parser(command)
        sub.add_argument("--out", required=True)
        sub.add_argument("--max-edge", type=int, default=2560)
        sub.add_argument("--region")

    window = subparsers.add_parser("window")
    window.add_argument("--title", required=True)
    window.add_argument("--out", required=True)
    window.add_argument("--max-edge", type=int, default=2560)
    window.add_argument("--region")
    window.add_argument("--activate", action="store_true")

    crop = subparsers.add_parser("crop")
    crop.add_argument("--in", dest="source", required=True)
    crop.add_argument("--out", required=True)
    crop.add_argument("--region", required=True)

    shrink = subparsers.add_parser("shrink")
    shrink.add_argument("--in", dest="source", required=True)
    shrink.add_argument("--out", required=True)
    shrink.add_argument("--max-edge", type=int, default=1600)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    result_path = args.result
    enable_dpi_awareness()
    try:
        if args.command == "list":
            value: dict[str, object] = {
                "windows": [
                    {key: item for key, item in row.items() if not key.startswith("_")}
                    for row in list_windows()
                ],
            }
        elif args.command == "screen":
            value = capture_screen(args.out, args.max_edge, parse_region(args.region))
        elif args.command == "active":
            value = capture_active(args.out, args.max_edge, parse_region(args.region))
        elif args.command == "window":
            value = capture_window(args.title, args.out, args.max_edge, parse_region(args.region), args.activate)
        elif args.command == "crop":
            value = crop_file(args.source, args.out, parse_region(args.region) or (0, 0, 1, 1))
        elif args.command == "shrink":
            value = shrink_file(args.source, args.out, args.max_edge)
        else:  # pragma: no cover - argparse enforces the command set
            raise CaptureError("SCREENSHOT_UNKNOWN_COMMAND", f"unknown command {args.command}")
    except CaptureError as exc:
        emit({"ok": False, "error": {"code": exc.code, "message": str(exc), **exc.extra}}, result_path)
        return 1
    except Exception as exc:  # pragma: no cover - defensive boundary
        emit({
            "ok": False,
            "error": {
                "code": "SCREENSHOT_FAILED",
                "message": f"{type(exc).__name__}: {exc}",
            },
        }, result_path)
        return 1
    emit({"ok": True, "value": value}, result_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
