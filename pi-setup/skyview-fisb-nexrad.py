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
import math
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

# dBZ ramp by FIS-B 3-bit intensity. COOL & calm by design (per the design review): it coheres with the
# online radar's cool "Universal Blue" ramp, so a source flip (off-air <-> online) is nearly invisible,
# and it keeps warmth reserved for only the heaviest cells so precip never becomes a saturated blob that
# fights "aircraft are the brightest thing" or wrecks night/red modes. 0/1 (empty-block synthesis:
# Regional=0, CONUS=1) stay transparent so the map isn't washed. Alpha is ramped so drizzle stays faint;
# the client then applies radarOpacity on top, keeping precip a translucent tint aircraft paint over.
# (A later pass moves palette selection client-side for true per-night-mode recolor; this cool ramp is the
# calm, mode-agnostic baseline.)
RAMP = {
    2: (46, 90, 120, 130),     # 20-30 dBZ  steel blue
    3: (40, 120, 130, 160),    # 30-40      teal
    4: (60, 160, 150, 190),    # 40-45      green-cyan
    5: (130, 175, 120, 210),   # 45-50      muted green
    6: (210, 175, 90, 235),    # 50-55      soft amber
    7: (205, 120, 110, 255),   # 55+        muted coral (warmth only for the worst cells)
}
FAINT_L1 = (70, 110, 130, 110)  # faint steel; used only if --min-intensity 1


def norm_lon(deg):
    """West arcmin come in 0..360 degrees; fold to -180..+180."""
    while deg > 180.0:
        deg -= 360.0
    while deg < -180.0:
        deg += 360.0
    return deg


def merc_y(lat_deg):
    """Web-Mercator ordinate (unitless). Painting the raster in this y makes the client's linear
    corner-affine EXACT (the map is Mercator); a plain equirectangular raster mis-registers by a few
    km mid-latitude and blows up over tall regions (CONUS)."""
    return math.log(math.tan(math.pi / 4.0 + math.radians(lat_deg) / 2.0))


def product_time_ms(hh, mm, now=None):
    """extract_nexrad gives only hh:mm (UTC), no date. Anchor hh:mm to the UTC date that puts it NEAREST
    to now — checking yesterday/today/tomorrow. Symmetric, so it's correct across the midnight boundary in
    both directions (off-air => no NTP, so the receiver clock may lead or lag the product time)."""
    now = now or datetime.now(timezone.utc)
    base = now.replace(hour=hh, minute=mm, second=0, microsecond=0).timestamp()
    now_ts = now.timestamp()
    best = min((base + off for off in (-86400, 0, 86400)), key=lambda ts: abs(ts - now_ts))
    return int(best * 1000)


class Canvas:
    def __init__(self, out_dir, bounds, px_per_deg, min_intensity, expire_s, kinds):
        self.out_dir = out_dir
        self.n, self.s, self.e, self.w = bounds
        self.min_intensity = min_intensity
        self.expire_s = expire_s
        self.kinds = kinds  # set of {"regional","conus"}
        self.w_px = max(64, int(round((self.e - self.w) * px_per_deg)))
        self.h_px = max(64, int(round((self.n - self.s) * px_per_deg)))
        self.mN = merc_y(self.n)   # Mercator y of the north/south bounds, for exact-registration paint
        self.mS = merc_y(self.s)
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
        # x linear in lon (Mercator x is linear in lon -> exact); y in Mercator so the client affine is exact.
        x = (lon - self.w) / (self.e - self.w) * self.w_px
        y = (self.mN - merc_y(lat)) / (self.mN - self.mS) * self.h_px
        return x, y

    def render_and_write(self):
        cutoff = time.time() - self.expire_s
        with self.lock:
            # drop stale blocks, then snapshot (key,val) UNDER the lock so add() can't mutate mid-iterate
            live = {k: v for k, v in self.blocks.items() if v[0] >= cutoff}
            self.blocks = live
            snapshot = list(live.items())
        if not snapshot:
            return False  # nothing fresh -> leave the contract empty (server returns {}, map uses online)

        img = Image.new("RGBA", (self.w_px, self.h_px), (0, 0, 0, 0))
        px = img.load()
        latest = 0
        painted = 0
        for _key, (_recv, pms, _bins) in snapshot:
            latest = max(latest, pms)
        for key, (_recv, _pms, bins) in snapshot:
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
                        painted += 1

        if not painted:
            # Only empty/sub-threshold blocks (coverage but no precip). Don't publish a fully-transparent
            # product — that would mark the whole region "fresh off-air" and suppress the online radar
            # while showing nothing. Leave the contract as-is so the map falls back to online radar.
            return False
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
            # Guard per-line: a parse/add exception must never break the stdin drain — if this loop dies,
            # the upstream pipe backpressures and the whole pipeline stalls.
            try:
                rec = parse_line(line.strip())
                if rec:
                    canvas.add(*rec)
            except Exception as e:
                sys.stderr.write("skyview-fisb-nexrad: line error: %s\n" % e)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()


if __name__ == "__main__":
    main()
