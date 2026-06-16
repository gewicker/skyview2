<#
.SYNOPSIS
  Flash a Raspberry Pi OS image to an SD card on Windows, for a fresh SkyView 2 Pi.

.DESCRIPTION
  Safe wrapper around a raw disk write. It only ever targets REMOVABLE (USB/SD) disks,
  never a fixed/system disk, and makes you confirm the exact target before writing.
  Accepts a raw .img, or a compressed .img.xz / .img.gz / .zip (decompressed first via
  tar/7-Zip/Expand-Archive if available).

  After flashing, boot the Pi once with networking, then run install-on-pi.sh (or push
  a build with skyview-push.sh) to install the SkyView 2 service + kiosk.

.PARAMETER Image
  Path to the OS image (.img, .img.xz, .img.gz, or .zip containing a single .img).

.PARAMETER Drive
  Optional physical drive number (e.g. 2). If omitted, you'll pick from a list.

.EXAMPLE
  # Run from an elevated PowerShell:
  .\flash_skyview.ps1 -Image .\2025-05-13-raspios-bookworm-arm64-lite.img.xz

.NOTES
  Requires Administrator. Writing to the wrong disk destroys data — read the prompts.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Image,
  [int]$Drive = -1
)

$ErrorActionPreference = "Stop"

function Require-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script from an elevated (Administrator) PowerShell."
  }
}

function Resolve-Image([string]$path) {
  if (-not (Test-Path $path)) { throw "Image not found: $path" }
  $item = Get-Item $path
  $ext = $item.Extension.ToLower()
  if ($ext -eq ".img") { return $item.FullName }

  $out = Join-Path $env:TEMP ("skyview_" + [IO.Path]::GetFileNameWithoutExtension($item.Name))
  if ($out -notmatch "\.img$") { $out += ".img" }
  Write-Host "Decompressing $($item.Name) -> $out ..." -ForegroundColor Cyan

  if ($ext -eq ".zip") {
    $tmp = Join-Path $env:TEMP ("skyview_unzip_" + [Guid]::NewGuid().ToString("N"))
    Expand-Archive -Path $item.FullName -DestinationPath $tmp -Force
    $img = Get-ChildItem $tmp -Recurse -Filter *.img | Select-Object -First 1
    if (-not $img) { throw "No .img found inside the zip." }
    Copy-Item $img.FullName $out -Force
    return $out
  }

  $sevenZip = (Get-Command 7z.exe -ErrorAction SilentlyContinue) ?? (Get-Command "$env:ProgramFiles\7-Zip\7z.exe" -ErrorAction SilentlyContinue)
  if ($sevenZip) {
    & $sevenZip.Source e -y "-o$([IO.Path]::GetDirectoryName($out))" $item.FullName "-so" > $out 2>$null
    if ((Get-Item $out).Length -gt 0) { return $out }
  }
  if ($ext -eq ".gz" -and (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    # tar.exe (libarchive) can inflate a raw gzip to stdout.
    & tar.exe -xOf $item.FullName > $out
    if ((Get-Item $out).Length -gt 0) { return $out }
  }
  throw "Could not decompress $ext. Install 7-Zip, or decompress to a .img first."
}

function Select-RemovableDisk([int]$pref) {
  $disks = Get-Disk | Where-Object { $_.BusType -in @("USB", "SD") -and -not $_.IsSystem -and -not $_.IsBoot }
  if (-not $disks) { throw "No removable USB/SD disk found. Insert the card and retry." }
  Write-Host ""
  Write-Host "Removable disks:" -ForegroundColor Yellow
  foreach ($d in $disks) {
    "{0}  {1,-22} {2,8:N1} GB  [{3}]" -f $d.Number, $d.FriendlyName, ($d.Size / 1GB), $d.BusType | Write-Host
  }
  if ($pref -ge 0) {
    $sel = $disks | Where-Object { $_.Number -eq $pref }
    if (-not $sel) { throw "Drive $pref is not a removable disk." }
    return $sel
  }
  $num = Read-Host "`nEnter the disk NUMBER to flash"
  $sel = $disks | Where-Object { $_.Number -eq [int]$num }
  if (-not $sel) { throw "Disk $num is not in the removable list." }
  return $sel
}

function Write-Raw([string]$imgPath, $disk) {
  $confirm = Read-Host "`nThis ERASES disk $($disk.Number) ($($disk.FriendlyName), $([math]::Round($disk.Size/1GB,1)) GB). Type ERASE to proceed"
  if ($confirm -ne "ERASE") { Write-Host "Aborted."; return }

  Write-Host "Clearing partitions..." -ForegroundColor Cyan
  Clear-Disk -Number $disk.Number -RemoveData -RemoveOEM -Confirm:$false
  $disk | Get-Disk | Set-Disk -IsOffline $true

  $devPath = "\\.\PhysicalDrive$($disk.Number)"
  $src = [IO.File]::OpenRead($imgPath)
  $dst = New-Object IO.FileStream($devPath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
  try {
    $buf = New-Object byte[] (4MB)
    $total = $src.Length; $done = 0; $sw = [Diagnostics.Stopwatch]::StartNew()
    while (($n = $src.Read($buf, 0, $buf.Length)) -gt 0) {
      $dst.Write($buf, 0, $n); $done += $n
      if ($sw.ElapsedMilliseconds -gt 500) {
        Write-Progress -Activity "Flashing SkyView image" -Status ("{0:N0} / {1:N0} MB" -f ($done/1MB), ($total/1MB)) -PercentComplete (100 * $done / $total)
        $sw.Restart()
      }
    }
    $dst.Flush()
  } finally {
    $src.Dispose(); $dst.Dispose()
    Get-Disk -Number $disk.Number | Set-Disk -IsOffline $false
  }
  Write-Progress -Activity "Flashing SkyView image" -Completed
  Write-Host "`nDone. Eject the card, boot the Pi, then run install-on-pi.sh." -ForegroundColor Green
}

Require-Admin
$img = Resolve-Image $Image
$disk = Select-RemovableDisk $Drive
Write-Raw $img $disk
