// Lazy aircraft-photo loader: ask /api/photo/:hex once per hex, load the returned
// thumbnail, and hand back the <img> when ready (null until then / if none). The
// image is drawn to the canvas but never read back, so cross-origin is fine.
const photos = new Map<string, HTMLImageElement | null>(); // null = resolved, no image (yet)
const pending = new Set<string>();
const PHOTO_CAP = 120; // bound the cache so a 24/7 kiosk doesn't slowly leak one entry per hex seen

export function getPhoto(hex: string, reg?: string): HTMLImageElement | null {
  const have = photos.get(hex);
  if (have) return have;
  if (photos.has(hex) || pending.has(hex)) return null;
  if (photos.size >= PHOTO_CAP) { // FIFO-evict the oldest (a long-gone aircraft); re-fetched if seen again
    const oldest = photos.keys().next().value;
    if (oldest !== undefined) photos.delete(oldest);
  }
  pending.add(hex);
  fetch(`/api/photo/${hex}${reg ? `?reg=${encodeURIComponent(reg)}` : ""}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { url?: string } | null) => {
      if (d && d.url) {
        photos.set(hex, null); // resolved; image still loading
        const img = new Image();
        img.onload = () => photos.set(hex, img);
        img.onerror = () => photos.set(hex, null);
        img.src = d.url;
      } else {
        photos.set(hex, null);
      }
    })
    .catch(() => photos.set(hex, null))
    .finally(() => pending.delete(hex));
  return null;
}
