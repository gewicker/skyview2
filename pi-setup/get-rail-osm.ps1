# Generates web/src/display/render/rail.ts from OpenStreetMap (Overpass): GPS-accurate Link
# light-rail geometry INCLUDING TUNNELS, stitched per line into one ordered terminus->terminus
# polyline with a per-vertex `tunnel` flag and station arc-length indices (RAIL_LINES). Also emits
# RAIL_SEGMENTS (above-ground spans) and RAIL_STATIONS for back-compat with the current RailLayer.
# Run on the PC (needs internet), then commit rail.ts and deploy.
#
#   powershell -ExecutionPolicy Bypass -File pi-setup\get-rail-osm.ps1
#
# NOTE (first run): eyeball the per-line vertex count + tunnel fraction it prints, and check the
# rendered line matches reality. OSM route relations can list member ways out of order / reversed;
# the reverse-and-snap walk handles that, but if a line comes out scrambled, tweak $JOIN_EPS or the
# $refRegex below. The RailLine type is imported from ./path (the shared arc-length engine).
$ErrorActionPreference = "Stop"

# bbox = south,west,north,east — Federal Way/SeaTac up to Lynnwood, west Seattle to Redmond.
$bbox = "47.2,-122.45,47.95,-121.9"

# Pull the Link route RELATIONS (ordered members stitch the disconnected ways, incl. tunnels), every
# member way's geometry, and light_rail station nodes.
$query = @"
[out:json][timeout:180];
(
  relation["route"~"^(light_rail|subway)$"]["ref"~"Line"]($bbox);
)->.rels;
.rels out body;
way(r.rels)->.ways;
.ways out geom;
(
  node["railway"="station"]["station"="light_rail"]($bbox);
  node["railway"="station"]["light_rail"="yes"]($bbox);
  node["station"="light_rail"]($bbox);
);
out body;
"@

Write-Host "Querying Overpass for Link route relations in $bbox ..."
$resp = Invoke-RestMethod -Uri "https://overpass-api.de/api/interpreter" -Method Post `
  -Headers @{ "User-Agent" = "SkyView/2 rail-gen (+https://github.com/gewicker/skyview2)" } `
  -Body @{ data = $query }

# --- index the response ----------------------------------------------------------------------- #
$waysById = @{}     # way id -> @{ geom = [ @{lat,lon}... ]; tunnel = bool }
$relations = New-Object System.Collections.ArrayList
$stationNodes = New-Object System.Collections.ArrayList

foreach ($el in $resp.elements) {
  if ($el.type -eq "way" -and $el.geometry) {
    $isTun = ($el.tags.tunnel -eq "yes") -or ($null -ne $el.tags.layer -and [int]$el.tags.layer -lt 0)
    $waysById[[string]$el.id] = @{ geom = $el.geometry; tunnel = [bool]$isTun }
  }
  elseif ($el.type -eq "relation") {
    [void]$relations.Add($el)
  }
  elseif ($el.type -eq "node") {
    $nm = if ($el.tags.name) { $el.tags.name } else { "" }
    [void]$stationNodes.Add(@{ lat = $el.lat; lon = $el.lon; name = $nm })
  }
}

$JOIN_EPS = 0.0006   # ~60 m: endpoints closer than this are treated as the same join node
$STA_SNAP = 0.0025   # ~250 m: a station node within this of the line is snapped onto it
$refRegex = '([12])\s*Line'   # capture the line digit from the relation ref/name

function Dist2($aLat, $aLon, $bLat, $bLon) { return ($aLat - $bLat) * ($aLat - $bLat) + ($aLon - $bLon) * ($aLon - $bLon) }

# Pick ONE relation per line id (the directional relation with the most member ways → most complete).
$bestRel = @{}
foreach ($r in $relations) {
  $ref = if ($r.tags.ref) { $r.tags.ref } else { $r.tags.name }
  if (-not $ref) { continue }
  $m = [regex]::Match($ref, $refRegex)
  if (-not $m.Success) { continue }
  $id = $m.Groups[1].Value
  $wayCount = ($r.members | Where-Object { $_.type -eq "way" }).Count
  if (-not $bestRel.ContainsKey($id) -or $wayCount -gt $bestRel[$id].count) {
    $bestRel[$id] = @{ rel = $r; count = $wayCount }
  }
}

$railLines = New-Object System.Collections.ArrayList
$allSegs = New-Object System.Collections.ArrayList   # back-compat RAIL_SEGMENTS (above-ground spans)
$allStations = New-Object System.Collections.ArrayList # back-compat RAIL_STATIONS

foreach ($id in ($bestRel.Keys | Sort-Object)) {
  $rel = $bestRel[$id].rel
  # GREEDY nearest-endpoint chaining. Relation member ORDER is unreliable (members can be out of
  # order, reversed, or include stray crossover/siding/opposite-direction ways), and trusting it
  # produced straight chords across the map. Instead: start at the north terminus and repeatedly
  # attach the unused way whose endpoint is NEAREST the growing tail, but only within GAP_MAX — a
  # way that doesn't actually connect is left out rather than chorded in.
  $pool = New-Object System.Collections.ArrayList
  foreach ($mw in ($rel.members | Where-Object { $_.type -eq "way" })) {
    $w = $waysById[[string]$mw.ref]
    if (-not $w) { continue }
    $g = @($w.geom)
    if ($g.Count -lt 2) { continue }
    [void]$pool.Add(@{ pts = $g; tunnel = $w.tunnel; used = $false })
  }
  if ($pool.Count -eq 0) { Write-Host "WARN: line $id has no member ways"; continue }

  # Start from the northernmost endpoint (Lynnwood is the north terminus of both lines).
  $startI = 0; $startRev = $false; $maxLat = -999.0
  for ($i = 0; $i -lt $pool.Count; $i++) {
    $g = $pool[$i].pts
    if ($g[0].lat -gt $maxLat) { $maxLat = $g[0].lat; $startI = $i; $startRev = $false }
    if ($g[$g.Count - 1].lat -gt $maxLat) { $maxLat = $g[$g.Count - 1].lat; $startI = $i; $startRev = $true }
  }
  $path = New-Object System.Collections.ArrayList
  $sg = @($pool[$startI].pts); if ($startRev) { [array]::Reverse($sg) }
  foreach ($pt in $sg) { [void]$path.Add(@{ lat = $pt.lat; lon = $pt.lon; tunnel = $pool[$startI].tunnel }) }
  $pool[$startI].used = $true

  $GAP_MAX = 0.0018  # ~150-200 m: max join gap to accept; a km-long chord is rejected
  while ($true) {
    $tail = $path[$path.Count - 1]
    $bestI = -1; $bestD = [double]::MaxValue; $bestRev = $false
    for ($i = 0; $i -lt $pool.Count; $i++) {
      if ($pool[$i].used) { continue }
      $g = $pool[$i].pts
      $df = Dist2 $tail.lat $tail.lon $g[0].lat $g[0].lon
      $dl = Dist2 $tail.lat $tail.lon $g[$g.Count - 1].lat $g[$g.Count - 1].lon
      if ($df -lt $bestD) { $bestD = $df; $bestI = $i; $bestRev = $false }
      if ($dl -lt $bestD) { $bestD = $dl; $bestI = $i; $bestRev = $true }
    }
    if ($bestI -lt 0 -or $bestD -gt ($GAP_MAX * $GAP_MAX)) { break }
    $w = $pool[$bestI]; $g = @($w.pts); if ($bestRev) { [array]::Reverse($g) }
    $startIdx = 0
    if ((Dist2 $tail.lat $tail.lon $g[0].lat $g[0].lon) -lt ($JOIN_EPS * $JOIN_EPS)) { $startIdx = 1 }
    for ($k = $startIdx; $k -lt $g.Count; $k++) { [void]$path.Add(@{ lat = $g[$k].lat; lon = $g[$k].lon; tunnel = $w.tunnel }) }
    $w.used = $true
  }
  $dropped = ($pool | Where-Object { -not $_.used }).Count
  if ($path.Count -lt 2) { Write-Host "WARN: line $id produced no path"; continue }

  # Snap stations onto this line -> ascending stationIdx (dedupe nearby indices).
  $stationIdx = New-Object System.Collections.ArrayList
  $idxNames = @{}
  foreach ($sn in $stationNodes) {
    $best = -1; $bestD = ($STA_SNAP * $STA_SNAP)
    for ($i = 0; $i -lt $path.Count; $i++) {
      $d = Dist2 $sn.lat $sn.lon $path[$i].lat $path[$i].lon
      if ($d -lt $bestD) { $bestD = $d; $best = $i }
    }
    if ($best -ge 0 -and -not $stationIdx.Contains($best)) {
      [void]$stationIdx.Add($best); $idxNames[$best] = $sn.name
    }
  }
  $stationIdx = @($stationIdx | Sort-Object)

  # --- emit RailLine ---
  $vtx = ($path | ForEach-Object { "{lat:$([math]::Round($_.lat,6)),lon:$([math]::Round($_.lon,6)),tunnel:$($_.tunnel.ToString().ToLower())}" }) -join ","
  $idxStr = ($stationIdx -join ",")
  $name = "$id Line"
  [void]$railLines.Add("{id:""$id"",name:""$name"",path:[$vtx],stationIdx:[$idxStr]}")

  # --- back-compat: above-ground spans -> RAIL_SEGMENTS ---
  $run = New-Object System.Collections.ArrayList
  foreach ($v in $path) {
    if ($v.tunnel) {
      if ($run.Count -ge 2) { [void]$allSegs.Add("[" + (($run) -join ",") + "]") }
      $run = New-Object System.Collections.ArrayList
    } else {
      [void]$run.Add("[$([math]::Round($v.lat,6)),$([math]::Round($v.lon,6))]")
    }
  }
  if ($run.Count -ge 2) { [void]$allSegs.Add("[" + (($run) -join ",") + "]") }

  # --- back-compat: RAIL_STATIONS from stationIdx ---
  foreach ($ix in $stationIdx) {
    $nm = if ($idxNames[$ix]) { $idxNames[$ix] } else { "" }
    $nm = $nm -replace '\\','\\' -replace '"','\"'
    [void]$allStations.Add("{""name"":""$nm"",""lat"":$([math]::Round($path[$ix].lat,6)),""lon"":$([math]::Round($path[$ix].lon,6))}")
  }

  $tunFrac = [math]::Round((($path | Where-Object { $_.tunnel }).Count) / $path.Count, 2)
  Write-Host ("  line {0}: {1} vertices, tunnel fraction {2}, {3} stations, {4} member ways dropped (unconnected)" -f $id, $path.Count, $tunFrac, $stationIdx.Count, $dropped)
}

$linesJson = "[" + ($railLines -join ",") + "]"
$segJson = "[" + ($allSegs -join ",") + "]"
$staJson = "[" + ($allStations -join ",") + "]"

$header = @"
// Link light rail geometry + stations, GPS-accurate from OpenStreetMap (Overpass). Now TUNNEL-AWARE:
// each line is stitched into ONE ordered terminus->terminus polyline with a per-vertex `tunnel` flag
// and station arc-length indices (RAIL_LINES), so the client can track trains by arc-length through
// tunnels where GPS drops. RAIL_SEGMENTS (above-ground spans) + RAIL_STATIONS are kept for the
// current RailLayer. Regenerate with pi-setup/get-rail-osm.ps1.
import type { RailLine } from "./path";

export interface RailStation {
  name: string;
  lat: number;
  lon: number;
}

// Ordered, tunnel-aware, line-keyed polylines (terminus->terminus). The arc-length engine in
// path.ts reasons over these.
export const RAIL_LINES: RailLine[] = $linesJson;

// One polyline per ABOVE-GROUND span (derived from RAIL_LINES), [lat, lon] points — back-compat.
export const RAIL_SEGMENTS: [number, number][][] = $segJson;

export const RAIL_STATIONS: RailStation[] = $staJson;
"@

$dest = Join-Path $PSScriptRoot "..\web\src\display\render\rail.ts"
$header | Set-Content -Encoding UTF8 $dest
Write-Host ("Wrote {0}: {1} lines, {2} above-ground segments, {3} stations." -f $dest, $railLines.Count, $allSegs.Count, $allStations.Count)
