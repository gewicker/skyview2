#!/usr/bin/env python3
"""
SkyView FIS-B -> NEXRAD raster adapter.

Reads the block lines emitted by mutability/dump978's `extract_nexrad` on stdin and paints them
onto one georeferenced RGBA image, then writes SkyView's off-air weather contract (v1):

    $WX_DIR/nexrad.png    reflectivity, transparent where no precip, colored on a dBZ ramp
    $WX_DIR/nexrad.json   {"bounds":[north,south,east,west], "time":<epoch ms>, "kind":"regional"}

The SkyView server serves those at /api/wxradar (+ /nexrad.png) and the client draws the image over
`bounds` through the same Web-Mercator affine the map uses, preferring it over online radar while fresh
(< 10 min). Until this writes a product, /api/wxradar returns {} and the map uses online RainViewer. So
running this is safe and additive.

Pipeline (see pi-setup/install-fisb.sh):
    rtl_sdr ... | dump978 | tee >(uat2json ...) | extract_nexrad | skyview-fisb-nexrad.py --out $WX_DIR

extract_nexrad line format (one per decoded block; see its source comment):
    NEXRAD <Regional|CONUS> <hh:mm> <scale> <north> <west> <height> <width> <128 intensity digits>
  north/west/height/width are in ARCMINUTES (÷60 -> degrees). west is POSITIVE (0..360); subtract 360
  for the conventional -180..+180. Each block is a 32(lon) x 4(lat) grid of bins, west->east then
  north->south; each digit is a 0..7 intensity.
"""
import os
import sys
import time
import json
import threading
import argparse
from datetime import datetime, timezone

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("skyview-fisb-nexrad: python3-pil (Pillow) is required\n")
    sys.exit(1)

# --- Fixed render region (degrees). Must be echoed verbatim into nexrad.json so the client registers
# the image exactly. Default covers the Puget Sound display area with margin; override via --bounds. ---
DEFAULT_BOUNDS = (49.0, 45.5, -119.5, -125.0)  # north, south, east, west

# dBZ color ramp by FIS-B 3-bit intensity. 0/1 are "no/def. light precip or empty-block synthesis"
# (extract_nexrad fills empty blocks with 0 for Regional, 1 for CONUS) -> transparent so the map isn't
# washed. Precip shows from MIN_INTENSITY up. Alpha is full here; the client applies radarOpacity (~0.55)
# on top, so precip stays a translucent tint that aircraft still paint brightly over.
RAMP = {
    2: (100, 200, 100, 255),   # 20-30 dBZ  light green
    3: (0, 160, 0, 255),       # 30-40      green
    4: (255, 232, 90, 255),    # 40-45      yellow
    5: (255, 160, 0, 255),     # 45-50      orange
    6: (230, 40, 40, 255),     # 50-55      red
    7: (220, 60, 220, 255),    # 55+        magenta
}
FAINT_L1 = (140, 220, 140, 200)  # used only if --min-intensity 1


def norm_lon(deg):
    """West arcmin come in 0..360 degrees; fold to -180..+180."""
    while deg > 180.0:
        deg -= 360.0
    while deg < -180.0:
        deg += 360.0
    return deg


def product_time_ms(hh, mm, now=None):
    """extract_nexrad gives only hh:mm (UTC). Anchor to today's UTC date; if that lands in the future
    (clock just past midnight, product from before), roll back a day."""
    now = now or datetime.now(timezone.utc)
    t = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    ts = t.timestamp()
    if ts - now.timestamp() > 90 * 60:  # more than 90 min in the future -> product is from yesterday
        ts -= 86400
    return int(ts * 1000)


class Canvas:
    def __init__(self, out_dir, bounds, px_per_deg, min_intensity, expire_s, kinds):
        self.out_dir = out_dir
        self.n, self.s, self.e, self.w = bounds
        self.min_intensity = min_intensity
        self.expire_s = expire_s
        self.kinds = kinds  # set of {"regional","conus"}
        self.w_px = max(64, int(round((self.e - self.w) * px_per_deg)))
        self.h_px = max(64, int(round((self.n - self.s) * px_per_deg)))
        self.lock = threading.Lock()
        # block key (north,west,height,width,kind) -> (recv_ts, product_ms, [128 ints])
        self.blocks = {}

    def add(self, kind, hh, mm, north_am, west_am, height_am, width_am, bins):
        if kind not in self.kinds:
            return
        key = (north_am, west_am, height_am, width_am, kind)
        with self.lock:
            self.blocks[key] = (time.time(), product_time_ms(hh, mm), bins)

    def _lonlat_to_px(self, lon, lat):
        x = (lon - self.w) / (self.e - self.w) * self.w_px
        y = (self.n - lat) / (self.n - self.s) * self.h_px
        return x, y

    def render_and_write(self):
        cutoff = time.time() - self.expire_s
        with self.lock:
            # drop stale blocks
            live = {k: v for k, v in self.blocks.items() if v[0] >= cutoff}
            self.blocks = live
            items = list(live.values())
        if not items:
            return False  # nothing fresh -> leave the contract empty (server returns {}, map uses online)

        img = Image.new("RGBA", (self.w_px, self.h_px), (0, 0, 0, 0))
        px = img.load()
        latest = 0
        for _recv, pms, bins in items:
            latest = max(latest, pms)
        for key, (_recv, _pms, bins) in list(live.items()):
            north_am, west_am, height_am, width_am, _kind = key
            north = north_am / 60.0
            west = norm_lon(west_am / 60.0)
            bin_h = (height_am / 4.0) / 60.0   # 4 latitude rows
            bin_w = (width_am / 32.0) / 60.0   # 32 longitude cols
            for i, val in enumerate(bins):
                if val < self.min_intensity:
                    continue
                color = RAMP.get(val) if val >= 2 else FAINT_L1
                if color is None:
                    continue
                row = i // 32          # 0 = north
                col = i % 32           # 0 = west
                lat_top = north - row * bin_h
                lat_bot = lat_top - bin_h
                lon_left = west + col * bin_w
                lon_right = lon_left + bin_w
                x0, y0 = self._lonlat_to_px(lon_left, lat_top)
                x1, y1 = self._lonlat_to_px(lon_right, lat_bot)
                xa, xb = sorted((int(x0), int(x1)))
                ya, yb = sorted((int(y0), int(y1)))
                xa = max(0, xa); ya = max(0, ya)
                xb = min(self.w_px - 1, xb); yb = min(self.h_px - 1, yb)
                if xb < 0 or yb < 0 or xa > self.w_px - 1 or ya > self.h_px - 1:
                    continue
                for yy in range(ya, yb + 1):
                    for xx in range(xa, xb + 1):
                        px[xx, yy] = color

        self._write_atomic(img, latest)
        return True

    def _write_atomic(self, img, product_ms):
        os.makedirs(self.out_dir, exist_ok=True)
        png_tmp = os.path.join(self.out_dir, "nexrad.png.tmp")
        json_tmp = os.path.join(self.out_dir, "nexrad.json.tmp")
        img.save(png_tmp, "PNG")
        meta = {
            "bounds": [self.n, self.s, self.e, self.w],
            "time": product_ms,
            "kind": "regional" if "regional" in self.kinds else "conus",
        }
        with open(json_tmp, "w") as f:
            json.dump(meta, f)
        os.replace(png_tmp, os.path.join(self.out_dir, "nexrad.png"))
        os.replace(json_tmp, os.path.join(self.out_dir, "nexrad.json"))


def parse_line(line):
    """Return (kind, hh, mm, north_am, west_am, height_am, width_am, [ints]) or None."""
    p = line.split()
    if len(p) != 9 or p[0] != "NEXRAD":
        return None
    kind = "regional" if p[1].lower().startswith("reg") else "conus"
    try:
        hh, mm = p[2].split(":")
        hh, mm = int(hh), int(mm)
        north_am = float(p[4]); west_am = float(p[5])
        height_am = float(p[6]); width_am = float(p[7])
        digits = p[8]
        if len(digits) != 128 or not digits.isdigit():
            return None
        bins = [int(c) for c in digits]
    except (ValueError, IndexError):
        return None
    return (kind, hh, mm, north_am, west_am, height_am, width_am, bins)


def main():
    ap = argparse.ArgumentParser(description="FIS-B extract_nexrad -> SkyView nexrad.png/json")
    ap.add_argument("--out", default=os.environ.get("WX_DIR", "/run/dump978/wx"),
                    help="output dir (must match the server's WXRADAR_DIR)")
    ap.add_argument("--bounds", default=os.environ.get("WX_BOUNDS", ""),
                    help='"north,south,east,west" degrees; default Puget Sound region')
    ap.add_argument("--px-per-deg", type=float, default=float(os.environ.get("WX_PX_PER_DEG", "120")))
    ap.add_argument("--min-intensity", type=int, default=int(os.environ.get("WX_MIN_INTENSITY", "2")),
                    help="lowest dBZ level to paint (1 shows light rain; 2 avoids empty-block wash)")
    ap.add_argument("--expire", type=int, default=int(os.environ.get("WX_EXPIRE_S", "900")),
                    help="drop blocks not refreshed within N seconds")
    ap.add_argument("--flush", type=float, default=float(os.environ.get("WX_FLUSH_S", "30")),
                    help="re-render + write cadence, seconds")
    ap.add_argument("--kinds", default=os.environ.get("WX_KINDS", "regional"),
                    help='comma list of products to render: regional,conus (default regional only)')
    args = ap.parse_args()

    if args.bounds.strip():
        b = tuple(float(x) for x in args.bounds.split(","))
        if len(b) != 4:
            sys.stderr.write("--bounds must be north,south,east,west\n"); sys.exit(2)
        bounds = b
    else:
        bounds = DEFAULT_BOUNDS
    kinds = {k.strip().lower() for k in args.kinds.split(",") if k.strip()}

    canvas = Canvas(args.out, bounds, args.px_per_deg, args.min_intensity, args.expire, kinds)

    # Periodic writer: extract_nexrad output is bursty, so render on a timer rather than per-line.
    stop = threading.Event()

    def writer():
        while not stop.wait(args.flush):
            try:
                canvas.render_and_write()
            except Exception as e:  # never let a render error kill the feed
                sys.stderr.write("skyview-fisb-nexrad: render error: %s\n" % e)

    threading.Thread(target=writer, daemon=True).start()

    sys.stderr.write("skyview-fisb-nexrad: reading extract_nexrad on stdin -> %s (bounds=%s kinds=%s)\n"
                     % (args.out, bounds, sorted(kinds)))
    try:
        for line in sys.stdin:
            rec = parse_line(line.strip())
            if rec:
                canvas.add(*rec)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()


if __name__ == "__main__":
    main()
