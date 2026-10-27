# Cave & Amis — sauvegarde chiffrée de la base. À lancer vous-même, chaque mois et avant chaque mise à jour importante :
#   powershell -ExecutionPolicy Bypass -File scripts\sauvegarde.ps1
# Chiffrer une ancienne sauvegarde restée en clair (vous la supprimerez ensuite vous-même) :
#   powershell -ExecutionPolicy Bypass -File scripts\sauvegarde.ps1 -Chiffrer "B:\Claude Project\sauvegardes\...\fichier.json"
#
# Ce qui est sauvegardé : toutes les tables de l'application (schéma public), les comptes (adresse e-mail, mot de passe
# haché, dates, prénom donné à l'inscription) et la liste des photos. Les photos elles-mêmes ne le sont pas.
# La base est lue par l'outil officiel de Supabase, connecté dans votre navigateur (une seule fois, dans un terminal :
# npx.cmd -y supabase@2 login) : aucun mot de passe de la base n'est demandé ici.
# Le mot de passe de chiffrement est demandé deux fois, sans s'afficher, et n'est écrit nulle part. Sans lui, la sauvegarde
# est illisible : rangez-le dans un gestionnaire de mots de passe. Les données ne sont jamais écrites en clair sur le
# disque : elles sont lues, chiffrées et vérifiées en mémoire.
# Pour relire une sauvegarde : scripts\dechiffrer-sauvegarde.ps1.
param(
  [string]$Chiffrer,
  [string]$Projet = 'ogkmucrjqomsqtjmkipd'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-chiffrement.ps1')
$Racine = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent

# ───────────── Chiffrer une ancienne sauvegarde ─────────────
if ($Chiffrer) {
  $source = (Resolve-Path -LiteralPath $Chiffrer).Path
  $cible = "$source.enc"
  if (Test-Path -LiteralPath $cible) { throw "Ce fichier chiffré existe déjà : $cible" }
  $clair = [IO.File]::ReadAllBytes($source)
  $motDePasse = Read-CaveNewPassword
  [IO.File]::WriteAllBytes($cible, (Protect-CaveBytes -Data $clair -Password $motDePasse))
  # Vérification : le fichier écrit se relit à l'identique avec ce mot de passe.
  $relu = Unprotect-CaveBytes -Blob ([IO.File]::ReadAllBytes($cible)) -Password $motDePasse
  if ((Get-CaveSha256 $relu) -ne (Get-CaveSha256 $clair)) {
    Remove-Item -LiteralPath $cible
    throw 'La vérification a échoué : le fichier chiffré a été retiré, l''original n''a pas bougé.'
  }
  Write-Host "Chiffré et vérifié : $cible" -ForegroundColor Green
  Write-Host "L'original en clair est toujours là : $source"
  Write-Host 'Une fois le mot de passe rangé en lieu sûr, supprimez vous-même l''original (puis videz la corbeille).'
  exit 0
}

# ───────────── Nouvelle sauvegarde ─────────────
# Une fonction temporaire (pg_temp) : elle disparaît avec la connexion, rien n'est créé dans la base.
$Sql = @'
create or replace function pg_temp.sauvegarde() returns jsonb language plpgsql as $f$
declare r record; tables jsonb := '{}'; j jsonb;
begin
  for r in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1 loop
    execute format('select coalesce(jsonb_agg(x), ''[]'') from public.%I x', r.table_name) into j;
    tables := tables || jsonb_build_object(r.table_name, j);
  end loop;
  return jsonb_build_object(
    'format', 'cave-sauvegarde-v1',
    'le', now(),
    'public', tables,
    'comptes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', u.id, 'email', u.email, 'encrypted_password', u.encrypted_password, 'email_confirmed_at', u.email_confirmed_at,
                  'raw_user_meta_data', u.raw_user_meta_data, 'raw_app_meta_data', u.raw_app_meta_data,
                  'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at) order by u.created_at), '[]') from auth.users u),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('nom', o.name, 'taille', o.metadata ->> 'size', 'le', o.created_at) order by o.name), '[]')
               from storage.objects o where o.bucket_id = 'photos'));
end $f$;
select pg_temp.sauvegarde() as sauvegarde;
'@

Write-Host '1. Connexion à Supabase' -ForegroundColor Cyan
if ((Invoke-CaveSupabase @('projects', 'list')).Code -ne 0) { throw 'Connexion Supabase absente : lancez d''abord, dans un terminal :  npx.cmd -y supabase@2 login' }

Write-Host '2. Lecture de la base (rien n''est écrit sur le disque)' -ForegroundColor Cyan
# L'outil lit la référence du projet dans supabase\.temp\project-ref (--linked ignore --project-ref) : un dossier
# temporaire, retiré aussitôt, ne contient que cette référence et la requête, jamais les données.
$Lien = Join-Path ([IO.Path]::GetTempPath()) ('cave-sauvegarde-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Force (Join-Path $Lien 'supabase\.temp') | Out-Null
  $sansBom = New-Object Text.UTF8Encoding $false
  [IO.File]::WriteAllText((Join-Path $Lien 'supabase\.temp\project-ref'), $Projet, $sansBom)
  [IO.File]::WriteAllText((Join-Path $Lien 'sauvegarde.sql'), $Sql, $sansBom)
  $lecture = Invoke-CaveSupabase @('db', 'query', '--linked', '--workdir', $Lien, '--output-format', 'json', '--file', (Join-Path $Lien 'sauvegarde.sql'))
} finally {
  Remove-Item -LiteralPath $Lien -Recurse -Force -ErrorAction SilentlyContinue
}
if ($lecture.Code -ne 0) { throw ('La lecture de la base a échoué : rien n''a été sauvegardé. ' + $lecture.Messages) }
$brut = $lecture.Texte
$donnees = Find-CaveBackup $brut
if (-not $donnees) { throw 'Réponse inattendue de Supabase : rien n''a été sauvegardé.' }

Write-Host '3. Chiffrement' -ForegroundColor Cyan
$octets = [Text.Encoding]::UTF8.GetBytes($brut)
$motDePasse = Read-CaveNewPassword
$Dossier = Join-Path $Racine ("sauvegardes\" + (Get-Date -Format 'yyyy-MM-dd_HHmm'))
New-Item -ItemType Directory -Force $Dossier | Out-Null
$Fichier = Join-Path $Dossier 'cave-sauvegarde.json.enc'
[IO.File]::WriteAllBytes($Fichier, (Protect-CaveBytes -Data $octets -Password $motDePasse))

Write-Host '4. Vérification : le fichier se relit à l''identique' -ForegroundColor Cyan
$relu = Unprotect-CaveBytes -Blob ([IO.File]::ReadAllBytes($Fichier)) -Password $motDePasse
if ((Get-CaveSha256 $relu) -ne (Get-CaveSha256 $octets)) { throw "La vérification a échoué : ne comptez pas sur $Fichier." }
@(
  'Cave & Amis : sauvegarde chiffrée de la base.'
  "Faite le $(Get-Date -Format 'dd/MM/yyyy à HH:mm'), projet $Projet, format cave-sauvegarde-v1."
  'Pour la relire : powershell -ExecutionPolicy Bypass -File scripts\dechiffrer-sauvegarde.ps1 -Fichier "<ce dossier>\cave-sauvegarde.json.enc"'
  'Le mot de passe n''est écrit nulle part : sans lui, la sauvegarde est illisible.'
) | Out-File -Encoding utf8 (Join-Path $Dossier 'LISEZMOI.txt')

$lignes = 0
foreach ($t in $donnees.public.PSObject.Properties) { $lignes += @($t.Value).Count }
Write-Host ''
Write-Host "Sauvegarde chiffrée et vérifiée : $Fichier" -ForegroundColor Green
Write-Host ("{0} tables, {1} lignes ; {2} comptes ; {3} photos listées (fichiers non copiés)." -f @($donnees.public.PSObject.Properties).Count, $lignes, @($donnees.comptes).Count, @($donnees.photos).Count)
