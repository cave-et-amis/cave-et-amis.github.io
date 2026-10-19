# Prépare le site de production prêt à déposer sur Netlify : livraison/cave-et-amis-site.zip
# Usage : npm run package:site
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path -LiteralPath config.production.js)) { throw 'config.production.js manquant : voir docs/INSTALLATION.md (étape « Site »).' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Compilation ou contrôle de l''export en échec' }
New-Item -ItemType Directory -Force livraison | Out-Null
& "$PSScriptRoot/zip-dir.ps1" -Source dist -Destination livraison/cave-et-amis-site.zip
'À déposer sur Netlify : page « Deploys » du site (zone glisser-déposer).'
