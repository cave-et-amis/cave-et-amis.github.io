# Mise en production de l'intégration Cave & Amis <-> Nous (docs/MISE-EN-SERVICE-NOUS.md).
# À lancer par vous-même, depuis le dossier Cave :  powershell -ExecutionPolicy Bypass -File scripts\mise-en-service-nous.ps1
#
# Le script s'arrête avant chaque étape et attend « o » pour continuer ; toute erreur arrête tout.
# Il ne lit ni n'affiche aucun mot de passe : la connexion Supabase se fait dans votre navigateur (supabase login).
# Le secret partagé est tiré au hasard ici, envoyé aux deux projets, puis effacé ; il n'est jamais affiché.
# Prérequis : les branches main de Cave et de Cocon contiennent l'intégration (déjà fait), les sites sont construits.

param([switch]$Oui)  # -Oui : enchaîne les étapes sans demander confirmation (toute erreur arrête quand même tout).
$ErrorActionPreference = 'Stop'
$Cave = Split-Path $PSScriptRoot -Parent
$Cocon = Join-Path (Split-Path $Cave -Parent) 'Cocon'
$CaveRef = 'ogkmucrjqomsqtjmkipd'
$NousRef = 'wfxzfiabnmeimjyjrmrv'
$Stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$Backup = Join-Path (Split-Path (Split-Path $Cave -Parent) -Parent) "sauvegardes\$Stamp"

function Step($title) {
  Write-Host ''
  Write-Host "=== $title ===" -ForegroundColor Cyan
  if ($Oui) { return }
  $answer = Read-Host 'Continuer ? (o pour oui, autre touche pour arrêter)'
  if ($answer -ne 'o') { Write-Host 'Arrêt demandé : rien de plus n''est fait.' -ForegroundColor Yellow; exit 1 }
}
function Sb { npx -y supabase@2 @args; if ($LASTEXITCODE -ne 0) { throw "Échec : supabase $($args -join ' ')" } }
function GitDo { git.exe @args; if ($LASTEXITCODE -ne 0) { throw "Échec : git $($args -join ' ')" } }

# Sauvegarde sans Docker ni pg_dump : toutes les tables du schéma public, en JSON, par l'API de gestion Supabase.
# La fonction est temporaire (pg_temp) : elle disparaît avec la connexion, rien n'est créé dans la base.
$DumpSql = @'
create or replace function pg_temp.sauvegarde() returns jsonb language plpgsql as $f$ declare r record; res jsonb := '{}'; j jsonb; begin for r in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1 loop execute format('select coalesce(jsonb_agg(x), ''[]'') from public.%I x', r.table_name) into j; res := res || jsonb_build_object(r.table_name, j); end loop; return res; end $f$; select pg_temp.sauvegarde() as sauvegarde;
'@
function Backup($ref, $file) {
  npx -y supabase@2 db query --linked --project-ref $ref --output-format json $DumpSql | Out-File -Encoding utf8 $file
  if ($LASTEXITCODE -ne 0) { throw "Échec de la sauvegarde du projet $ref" }
  if ((Get-Item $file).Length -lt 1000) { throw "Sauvegarde suspecte (trop petite) : $file" }
}

if (-not (Test-Path (Join-Path $Cocon 'supabase\functions\cave-sync\index.ts'))) { throw "Dépôt Cocon introuvable ou incomplet : $Cocon" }
if ((git -C $Cave branch --show-current) -ne 'main' -or (git -C $Cocon branch --show-current) -ne 'main') { throw 'Les deux dépôts doivent être sur main.' }
if (git -C $Cave status --porcelain) { throw 'Le dépôt Cave a des modifications non commitées.' }
if (git -C $Cocon status --porcelain) { throw 'Le dépôt Cocon a des modifications non commitées.' }
if (-not (Test-Path (Join-Path $Cave 'dist\index.html'))) { throw 'Site Cave non construit : npm run build' }
if (-not (Test-Path (Join-Path $Cocon 'livraison\nous-site-en-ligne.zip'))) { throw 'Site Nous non construit : npm run package:site (dans Cocon)' }

Step '1. Vérification de la connexion à Supabase'
# La connexion se fait au préalable, dans un terminal interactif :  npx.cmd -y supabase@2 login
npx -y supabase@2 projects list *> $null
if ($LASTEXITCODE -ne 0) { throw 'Connexion Supabase absente : lancez d''abord, dans un terminal :  npx.cmd -y supabase@2 login' }
Write-Host 'Connexion Supabase : OK'
# Le code déployé contient la phase E : sa migration 20261025000008_vie_de_groupe doit déjà être en base (sinon arrêt).
npx -y supabase@2 db query --linked --project-ref $CaveRef "select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'group_id') then 1 else 1 / 0 end as phase_e" *> $null
if ($LASTEXITCODE -ne 0) { throw 'La migration 20261025000008_vie_de_groupe (phase E) n''est pas encore appliquée sur Cave & Amis : attendre qu''elle le soit.' }
Write-Host 'Phase E (vie de groupe) présente en base : OK'

Step "2. Sauvegarde des deux bases dans $Backup"
New-Item -ItemType Directory -Force $Backup | Out-Null
Backup $CaveRef (Join-Path $Backup 'cave-donnees.json')
Backup $NousRef (Join-Path $Backup 'nous-donnees.json')
Get-ChildItem $Backup | Format-Table Name, Length
Write-Host 'Le schéma est celui des migrations des dépôts (inchangé jusqu''ici).'

Step '3. Migrations (ajouts seulement, aucune donnée existante modifiée)'
Sb db query --linked --project-ref $CaveRef -f (Join-Path $Cave 'supabase\migrations\20261025000007_integration_nous.sql')
Sb db query --linked --project-ref $NousRef -f (Join-Path $Cocon 'supabase\migrations\20261025000001_integration_cave.sql')

Step '4. Secret partagé et adresses (secrets des fonctions des deux projets)'
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$envCave = Join-Path $env:TEMP "cave-secrets-$Stamp.env"
$envNous = Join-Path $env:TEMP "nous-secrets-$Stamp.env"
try {
  Set-Content -Encoding ascii $envCave @(
    "ECOSYSTEM_SECRET=$secret",
    "NOUS_FUNCTION_URL=https://$NousRef.supabase.co/functions/v1/cave-sync",
    'NOUS_APP_URL=https://cocon-famille.netlify.app/',
    'CAVE_APP_URL=https://cave-et-amis.github.io/'
  )
  Set-Content -Encoding ascii $envNous @(
    "ECOSYSTEM_SECRET=$secret",
    "CAVE_FUNCTION_URL=https://$CaveRef.supabase.co/functions/v1/cave-api",
    'CAVE_APP_URL=https://cave-et-amis.github.io/',
    'NOUS_APP_URL=https://cocon-famille.netlify.app/'
  )
  Sb secrets set --project-ref $CaveRef --env-file $envCave
  Sb secrets set --project-ref $NousRef --env-file $envNous
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $envCave, $envNous
  $secret = $null
}

Step '5. Déploiement des fonctions cave-api (Cave) et cave-sync (Nous)'
Sb functions deploy cave-api --project-ref $CaveRef --no-verify-jwt --use-api --workdir $Cave
Sb functions deploy cave-sync --project-ref $NousRef --no-verify-jwt --use-api --workdir $Cocon

Step '6. Activation : tâches planifiées (envoi chaque minute)'
Sb db query --linked --project-ref $CaveRef -f (Join-Path $Cave 'supabase\sql\integration-nous-cron.sql')
Sb db query --linked --project-ref $NousRef -f (Join-Path $Cocon 'supabase\sql\integration-cave-cron.sql')

Step '7. Site Cave & Amis : publication sur gh-pages et envoi de main'
$sha = (git -C $Cave rev-parse --short HEAD)
$pages = Join-Path $env:TEMP "cave-gh-pages-$Stamp"
GitDo -C $Cave fetch origin gh-pages
GitDo -C $Cave worktree add --detach $pages origin/gh-pages
try {
  Get-ChildItem $pages -Force | Where-Object { $_.Name -notin @('.git', '.nojekyll') } | Remove-Item -Recurse -Force
  Copy-Item -Recurse -Force (Join-Path $Cave 'dist\*') $pages
  GitDo -C $pages add -A
  GitDo -C $pages commit -m "Site Cave & Amis (export de $sha)"
  GitDo -C $pages push origin HEAD:gh-pages
} finally {
  git -C $Cave worktree remove --force $pages
}
GitDo -C $Cave push origin main

Step '8. Site Nous : déposez le zip sur Netlify (le dossier et la page s''ouvrent)'
Start-Process explorer.exe "/select,`"$(Join-Path $Cocon 'livraison\nous-site-en-ligne.zip')`""
Start-Process 'https://app.netlify.com/projects/cocon-famille/deploys'
if ($Oui) { Write-Host 'À FAIRE : glissez nous-site-en-ligne.zip dans la zone « drag and drop » de Netlify (page ouverte).' -ForegroundColor Yellow }
else { Read-Host 'Glissez nous-site-en-ligne.zip dans la zone « drag and drop », attendez « Published », puis appuyez sur Entrée' }

Write-Host ''
Write-Host 'Mise en service terminée. Vérification : docs/MISE-EN-SERVICE-NOUS.md, étape 6.' -ForegroundColor Green
Write-Host "Sauvegardes : $Backup"
Write-Host 'Envoi du dépôt Cocon sur GitHub (facultatif) : git -C ..\Cocon push origin main'
