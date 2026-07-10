"""Unit tests for skyview-fisb-nexrad.py — the FIS-B -> NEXRAD raster adapter.

Run on the Pi/PC:  python3 -m pytest pi-setup/test_skyview_fisb_nexrad.py
Covers the highest-risk pure logic: extract_nexrad line parsing, the block/bin geometry (arcmin->deg,
west 0-360 fold, Mercator-y pixel mapping), and the hh:mm -> epoch reconstruction across midnight.
"""
import os
import importlib.util
from datetime import datetime, timezone

import pytest

# Load the hyphenated script as a module.
_PATH = os.path.join(os.path.dirname(__file__), "skyview-fisb-nexrad.py")
_spec = importlib.util.spec_from_file_location("skyview_fisb_nexrad", _PATH)
nx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nx)


def _line(kind="Regional", hhmm="16:20", scale=0, n=2852, w=14280, h=4, wd=48, digits=None):
    digits = digits if digits is not None else "0" * 128
    return f"NEXRAD {kind} {hhmm} {scale} {n} {w} {h} {wd} {digits}"


# ---- parse_line -------------------------------------------------------------------------------

def test_parse_line_valid():
    d = "0" * 40 + "4" * 24 + "5" * 16 + "0" * 48
    rec = nx.parse_line(_line(digits=d))
    assert rec is not None
    kind, hh, mm, north, west, height, width, bins = rec
    assert kind == "regional"
    assert (hh, mm) == (16, 20)
    assert (north, west, height, width) == (2852.0, 14280.0, 4.0, 48.0)
    assert len(bins) == 128 and bins[40] == 4 and bins[64] == 5


def test_parse_line_conus():
    assert nx.parse_line(_line(kind="CONUS"))[0] == "conus"


@pytest.mark.parametrize("bad", [
    "not a nexrad line",
    "NEXRAD Regional 16:20 0 2852 14280 4 48 " + "0" * 127,   # 127 digits
    "NEXRAD Regional 16:20 0 2852 14280 4 48 " + "0" * 129,   # 129 digits
    "NEXRAD Regional 16:20 0 2852 14280 4 48 " + "0" * 127 + "x",  # non-digit
    "NEXRAD Regional 16:20 0 2852 14280 4",                    # too few fields
])
def test_parse_line_rejects_bad(bad):
    assert nx.parse_line(bad) is None


# ---- geometry ---------------------------------------------------------------------------------

def test_norm_lon_fold():
    assert nx.norm_lon(14280 / 60.0) == pytest.approx(-122.0)   # west arcmin -> -122
    assert nx.norm_lon(30.0) == pytest.approx(30.0)


def test_merc_y_monotonic_and_values():
    # Mercator ordinate increases with latitude; matches known values.
    assert nx.merc_y(49.0) > nx.merc_y(45.5)
    assert nx.merc_y(49.0) == pytest.approx(0.98386, abs=1e-3)
    assert nx.merc_y(45.5) == pytest.approx(0.89385, abs=1e-3)


def test_bin_paints_expected_pixels(tmp_path):
    # A Regional SF0 block near Seattle with a precip patch should paint pixels inside the block's
    # lon/lat box (x ~ 360-456 for -122..-121.2, y in the northern-Seattle band), and nowhere else.
    canvas = nx.Canvas(str(tmp_path), nx.DEFAULT_BOUNDS, 120.0, 2, 900, {"regional"})
    d = "0" * 40 + "4" * 24 + "5" * 16 + "0" * 48
    canvas.add(*nx.parse_line(_line(digits=d))[0:8])
    assert canvas.render_and_write() is True
    assert os.path.exists(tmp_path / "nexrad.png")
    assert os.path.exists(tmp_path / "nexrad.json")
    from PIL import Image
    im = Image.open(tmp_path / "nexrad.png").convert("RGBA")
    xs, ys = [], []
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            if im.getpixel((x, y))[3] > 0:
                xs.append(x); ys.append(y)
    assert xs, "expected painted pixels"
    assert 355 <= min(xs) <= 365 and 450 <= max(xs) <= 460   # lon -122..-121.2 band
    assert 170 <= min(ys) <= 200                              # northern-Seattle latitude band


def test_below_min_intensity_not_painted(tmp_path):
    canvas = nx.Canvas(str(tmp_path), nx.DEFAULT_BOUNDS, 120.0, 2, 900, {"regional"})
    canvas.add(*nx.parse_line(_line(digits="1" * 128))[0:8])   # all level 1 < min_intensity 2
    assert canvas.render_and_write() is False                  # nothing to draw -> no product


def test_kind_filter(tmp_path):
    canvas = nx.Canvas(str(tmp_path), nx.DEFAULT_BOUNDS, 120.0, 2, 900, {"regional"})
    canvas.add(*nx.parse_line(_line(kind="CONUS", digits="4" * 128))[0:8])  # conus dropped
    assert canvas.render_and_write() is False


# ---- product_time_ms (nearest of yesterday/today/tomorrow) ------------------------------------

def test_product_time_normal():
    now = datetime(2026, 7, 9, 16, 30, tzinfo=timezone.utc)
    age_min = (now.timestamp() * 1000 - nx.product_time_ms(16, 20, now)) / 60000
    assert age_min == pytest.approx(10.0, abs=0.1)


def test_product_time_post_midnight_rolls_back():
    now = datetime(2026, 7, 9, 0, 5, tzinfo=timezone.utc)   # product 23:58 seen at 00:05
    age_min = (now.timestamp() * 1000 - nx.product_time_ms(23, 58, now)) / 60000
    assert age_min == pytest.approx(7.0, abs=0.1)


def test_product_time_pre_midnight_rolls_forward():
    now = datetime(2026, 7, 9, 23, 58, tzinfo=timezone.utc)  # product 00:02 (clock lags) -> tomorrow
    lead_min = (nx.product_time_ms(0, 2, now) - now.timestamp() * 1000) / 60000
    assert lead_min == pytest.approx(4.0, abs=0.1)
