# Cave & Amis — relire une sauvegarde chiffrée par scripts\sauvegarde.ps1 :
#   powershell -ExecutionPolicy Bypass -File scripts\dechiffrer-sauvegarde.ps1 -Fichier "<dossier>\cave-sauvegarde.json.enc"
# Le mot de passe est demandé sans s'afficher. Un mauvais mot de passe ou un fichier abîmé sont refusés avant tout
# déchiffrement. Le fichier obtenu est EN CLAIR : supprimez-le dès que vous n'en avez plus besoin.
param(
  [Parameter(Mandatory = $true)][string]$Fichier,
  [string]$Sortie
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-chiffrement.ps1')

$source = (Resolve-Path -LiteralPath $Fichier).Path
if (-not $Sortie) { $Sortie = if ($source -match '\.enc$') { $source -replace '\.enc$', '' } else { "$source.json" } }
if (Test-Path -LiteralPath $Sortie) { throw "Ce fichier existe déjà : $Sortie (choisissez un autre nom avec -Sortie)" }
$motDePasse = Read-Host 'Mot de passe de la sauvegarde (il ne s''affiche pas)' -AsSecureString
$clair = Unprotect-CaveBytes -Blob ([IO.File]::ReadAllBytes($source)) -Password $motDePasse
[IO.File]::WriteAllBytes($Sortie, $clair)
Write-Host "Déchiffré : $Sortie" -ForegroundColor Green
Write-Host 'Attention : ce fichier est en clair. Supprimez-le dès que vous n''en avez plus besoin.' -ForegroundColor Yellow
