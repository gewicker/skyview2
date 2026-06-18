# Generates web/src/display/render/rail.ts from OpenStreetMap (Overpass): GPS-accurate Link
# light-rail track (ABOVE-GROUND only — tunnel ways excluded) + station coordinates. Run on the
# PC (it needs internet), then commit rail.ts and deploy. Mirrors the highways generator.
#
#   powershell -ExecutionPolicy Bypass -File pi-setup\get-rail-osm.ps1
#
$ErrorActionPreference = "Stop"

# bbox = south,west,north,east — Federal Way/SeaTac up to Lynnwood, west Seattle to Redmond.
$bbox = "47.2,-122.45,47.95,-121.9"
$query = @"
[out:json][timeout:120];
(
  way["railway"="light_rail"]($bbox);
  node["railway"="station"]["station"="light_rail"]($bbox);
  node["railway"="station"]["light_rail"="yes"]($bbox);
  node["station"="light_rail"]($bbox);
);
out geom;
"@

Write-Host "Querying Overpass for Link light rail in $bbox ..."
$resp = Invoke-RestMethod -Uri "https://overpass-api.de/api/interpreter" -Method Post `
  -Headers @{ "User-Agent" = "SkyView/2 rail-gen (+https://github.com/gewicker/skyview2)" } `
  -Body @{ data = $query }

$segs = New-Object System.Collections.ArrayList
$stations = New-Object System.Collections.ArrayList
$seen = @{}

foreach ($el in $resp.elements) {
  if ($el.type -eq "way" -and $el.geometry) {
    if ($el.tags.tunnel -eq "yes") { continue }   # above-ground only
    $pts = New-Object System.Collections.ArrayList
    foreach ($g in $el.geometry) {
      [void]$pts.Add("[$([math]::Round($g.lat,6)),$([math]::Round($g.lon,6))]")
    }
    if ($pts.Count -ge 2) { [void]$segs.Add("[" + ($pts -join ",") + "]") }
  }
  elseif ($el.type -eq "node") {
    $key = "$([math]::Round($el.lat,5)),$([math]::Round($el.lon,5))"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $name = if ($el.tags.name) { $el.tags.name } else { "" }
    $name = $name -replace '\\','\\' -replace '"','\"'
    [void]$stations.Add("{""name"":""$name"",""lat"":$([math]::Round($el.lat,6)),""lon"":$([math]::Round($el.lon,6))}")
  }
}

$segJson = "[" + ($segs -join ",") + "]"
$staJson = "[" + ($stations -join ",") + "]"

$header = @"
// Link light rail geometry + stations, GPS-accurate from OpenStreetMap (Overpass) — ABOVE-GROUND
// track only (tunnel ways excluded). Same idea as highways.ts: real coordinates so the line and
// stations register on the map by construction. Regenerate with pi-setup/get-rail-osm.ps1.

export interface RailStation {
  name: string;
  lat: number;
  lon: number;
}

// One polyline per above-ground OSM light_rail way (no stitching), [lat, lon] points.
export const RAIL_SEGMENTS: [number, number][][] = $segJson;

export const RAIL_STATIONS: RailStation[] = $staJson;
"@

$dest = Join-Path $PSScriptRoot "..\web\src\display\render\rail.ts"
$header | Set-Content -Encoding UTF8 $dest
Write-Host ("Wrote {0}: {1} above-ground segments, {2} stations." -f $dest, $segs.Count, $stations.Count)
