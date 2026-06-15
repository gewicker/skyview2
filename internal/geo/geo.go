// Package geo holds server-side great-circle helpers (range filtering, distance to
// the spotlight target, notable proximity). The canonical Web Mercator *projection*
// for rendering lives in the frontend (web/src/display/render/mercator.ts), where
// drawing happens — tiles are native Mercator, so traffic and basemap register
// exactly. Keep the two in agreement on the earth radius (6378137 m).
package geo

import "math"

const (
	earthRadiusM = 6378137.0
	mPerMile     = 1609.34
	deg          = math.Pi / 180
)

// DistanceM returns the great-circle distance in metres between two lat/lon points.
func DistanceM(lat1, lon1, lat2, lon2 float64) float64 {
	p1 := lat1 * deg
	p2 := lat2 * deg
	dp := (lat2 - lat1) * deg
	dl := (lon2 - lon1) * deg
	a := math.Sin(dp/2)*math.Sin(dp/2) +
		math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(a)))
}

// DistanceMiles is DistanceM in statute miles.
func DistanceMiles(lat1, lon1, lat2, lon2 float64) float64 {
	return DistanceM(lat1, lon1, lat2, lon2) / mPerMile
}

// BearingDeg returns the initial great-circle bearing (0..360, 0 = north) from
// point 1 to point 2.
func BearingDeg(lat1, lon1, lat2, lon2 float64) float64 {
	p1 := lat1 * deg
	p2 := lat2 * deg
	dl := (lon2 - lon1) * deg
	y := math.Sin(dl) * math.Cos(p2)
	x := math.Cos(p1)*math.Sin(p2) - math.Sin(p1)*math.Cos(p2)*math.Cos(dl)
	b := math.Atan2(y, x) / deg
	if b < 0 {
		b += 360
	}
	return b
}
