# Crée une archive zip portable (chemins avec « / », compatibles Netlify, Linux, macOS).
# Usage : powershell -File scripts/zip-dir.ps1 -Source dist -Destination livraison/site.zip
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = (Resolve-Path $Source).Path.TrimEnd('\')
$dest = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $dest) { [IO.File]::Delete($dest) }
$zip = [IO.Compression.ZipFile]::Open($dest, [IO.Compression.ZipArchiveMode]::Create)
$count = 0
try {
  Get-ChildItem -LiteralPath $src -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal)
    $count++
  }
} finally {
  $zip.Dispose()
}
"$count fichiers -> $dest"
