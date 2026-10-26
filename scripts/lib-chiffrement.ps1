# Chiffrement des sauvegardes de Cave & Amis (utilisé par sauvegarde.ps1 et dechiffrer-sauvegarde.ps1).
#
# AES-256 (mode CBC) puis HMAC-SHA256 sur l'ensemble (chiffrer puis authentifier : un fichier modifié ou un mauvais mot de
# passe sont refusés avant tout déchiffrement). Les deux clés viennent du mot de passe par PBKDF2-SHA256 (600 000 tours,
# sel aléatoire de 16 octets). Format du fichier, « CAVEENC1 » :
#   « CAVEENC1 » (8 octets) | nombre de tours (4 octets, petit-boutiste) | sel (16) | vecteur d'initialisation (16)
#   | données chiffrées | HMAC (32 octets)
# Uniquement des fonctions de .NET fournies avec Windows : rien à installer.

$script:CaveMagic = [Text.Encoding]::ASCII.GetBytes('CAVEENC1')
$script:CaveIterations = 600000

function Get-CaveKeys {
  param([Security.SecureString]$Password, [byte[]]$Salt, [int]$Iterations)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  try {
    $secret = [Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  try {
    $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes -ArgumentList @($secret, $Salt, $Iterations, [Security.Cryptography.HashAlgorithmName]::SHA256)
    try { return , $kdf.GetBytes(64) } finally { $kdf.Dispose() }
  } finally {
    [Array]::Clear($secret, 0, $secret.Length)
  }
}

function Get-CaveSlice {
  param([byte[]]$Bytes, [int]$Offset, [int]$Count)
  $out = New-Object byte[] $Count
  [Buffer]::BlockCopy($Bytes, $Offset, $out, 0, $Count)
  return , $out
}

function Protect-CaveBytes {
  param([byte[]]$Data, [Security.SecureString]$Password)
  $salt = New-Object byte[] 16
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($salt) } finally { $rng.Dispose() }
  $keys = Get-CaveKeys -Password $Password -Salt $salt -Iterations $script:CaveIterations
  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $aes.KeySize = 256
    $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = (Get-CaveSlice $keys 0 32)
    $aes.GenerateIV()
    $encryptor = $aes.CreateEncryptor()
    try { $cipher = $encryptor.TransformFinalBlock($Data, 0, $Data.Length) } finally { $encryptor.Dispose() }
    $stream = New-Object IO.MemoryStream
    $stream.Write($script:CaveMagic, 0, 8)
    $stream.Write([BitConverter]::GetBytes([int]$script:CaveIterations), 0, 4)
    $stream.Write($salt, 0, 16)
    $stream.Write($aes.IV, 0, 16)
    $stream.Write($cipher, 0, $cipher.Length)
    $body = $stream.ToArray()
  } finally {
    $aes.Dispose()
  }
  $hmac = New-Object Security.Cryptography.HMACSHA256 -ArgumentList @(, (Get-CaveSlice $keys 32 32))
  try { $tag = $hmac.ComputeHash($body) } finally { $hmac.Dispose() }
  [Array]::Clear($keys, 0, $keys.Length)
  $out = New-Object byte[] ($body.Length + 32)
  [Buffer]::BlockCopy($body, 0, $out, 0, $body.Length)
  [Buffer]::BlockCopy($tag, 0, $out, $body.Length, 32)
  return , $out
}

function Unprotect-CaveBytes {
  param([byte[]]$Blob, [Security.SecureString]$Password)
  $header = 8 + 4 + 16 + 16
  if ($Blob.Length -lt ($header + 16 + 32)) { throw 'Ce fichier n''est pas une sauvegarde chiffrée de Cave & Amis (trop court).' }
  for ($i = 0; $i -lt 8; $i++) {
    if ($Blob[$i] -ne $script:CaveMagic[$i]) { throw 'Ce fichier n''est pas une sauvegarde chiffrée de Cave & Amis.' }
  }
  $iterations = [BitConverter]::ToInt32($Blob, 8)
  if ($iterations -lt 100000 -or $iterations -gt 10000000) { throw 'En-tête de sauvegarde invalide.' }
  $salt = Get-CaveSlice $Blob 12 16
  $iv = Get-CaveSlice $Blob 28 16
  $bodyLength = $Blob.Length - 32
  $body = Get-CaveSlice $Blob 0 $bodyLength
  $tag = Get-CaveSlice $Blob $bodyLength 32
  $keys = Get-CaveKeys -Password $Password -Salt $salt -Iterations $iterations
  $hmac = New-Object Security.Cryptography.HMACSHA256 -ArgumentList @(, (Get-CaveSlice $keys 32 32))
  try { $expected = $hmac.ComputeHash($body) } finally { $hmac.Dispose() }
  # Comparaison à temps constant.
  $diff = 0
  for ($i = 0; $i -lt 32; $i++) { $diff = $diff -bor ($expected[$i] -bxor $tag[$i]) }
  if ($diff -ne 0) {
    [Array]::Clear($keys, 0, $keys.Length)
    throw 'Mot de passe incorrect, ou fichier abîmé : rien n''a été déchiffré.'
  }
  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $aes.KeySize = 256
    $aes.Mode = [Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = (Get-CaveSlice $keys 0 32)
    $aes.IV = $iv
    $decryptor = $aes.CreateDecryptor()
    try { $plain = $decryptor.TransformFinalBlock($body, $header, $bodyLength - $header) } finally { $decryptor.Dispose() }
  } finally {
    $aes.Dispose()
    [Array]::Clear($keys, 0, $keys.Length)
  }
  return , $plain
}

function Get-CaveSha256 {
  param([byte[]]$Bytes)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

# Contenu d'une sauvegarde dans la réponse de l'outil Supabase (« db query ») : une liste de lignes, un objet qui la
# contient, ou un texte JSON dans une colonne. Renvoie l'objet au format cave-sauvegarde-v1, sinon $null.
function Find-CaveBackup($valeur) {
  if ($null -eq $valeur) { return $null }
  if ($valeur -is [array]) {
    foreach ($v in $valeur) { $s = Find-CaveBackup $v; if ($null -ne $s) { return $s } }
    return $null
  }
  if ($valeur -is [string]) {
    if ($valeur.TrimStart().StartsWith('{') -or $valeur.TrimStart().StartsWith('[')) {
      try { return Find-CaveBackup ($valeur | ConvertFrom-Json) } catch { return $null }
    }
    return $null
  }
  if ($valeur -is [ValueType]) { return $null }
  if ($valeur.PSObject.Properties['format'] -and $valeur.format -eq 'cave-sauvegarde-v1') { return $valeur }
  foreach ($p in $valeur.PSObject.Properties) {
    $s = Find-CaveBackup $p.Value
    if ($null -ne $s) { return $s }
  }
  return $null
}

# Nouveau mot de passe, demandé deux fois sans s'afficher : 12 caractères au moins.
function Read-CaveNewPassword {
  while ($true) {
    $first = Read-Host 'Mot de passe de chiffrement (12 caractères au moins, il ne s''affiche pas)' -AsSecureString
    $second = Read-Host 'Le même mot de passe, une seconde fois' -AsSecureString
    $a = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
    try {
      $same = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($a) -ceq [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
      $long = $first.Length -ge 12
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a)
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
    }
    if (-not $same) { Write-Host 'Les deux saisies sont différentes : recommencez.' -ForegroundColor Yellow; continue }
    if (-not $long) { Write-Host 'Trop court : 12 caractères au moins.' -ForegroundColor Yellow; continue }
    return $first
  }
}
