import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIB = join(import.meta.dirname, '..', 'scripts', 'lib-chiffrement.ps1');

/** Exécute un script PowerShell (Windows seulement : les sauvegardes se font sur le PC du responsable). */
function powershell(script: string) {
  // Comme pour les scripts du projet (« -ExecutionPolicy Bypass »), pour ce seul processus.
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 120_000 });
}

describe.skipIf(process.platform !== 'win32')('sauvegardes chiffrées (scripts/lib-chiffrement.ps1)', () => {
  it('se relisent à l’identique ; mauvais mot de passe, fichier modifié ou étranger refusés', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-sauvegarde-'));
    try {
      const out = powershell(`
        $ErrorActionPreference = 'Stop'
        . '${LIB}'
        $pw = ConvertTo-SecureString 'mot-de-passe-de-test-12' -AsPlainText -Force
        $bad = ConvertTo-SecureString 'autre-mot-de-passe-34' -AsPlainText -Force
        $data = New-Object byte[] 200000
        (New-Object Random 42).NextBytes($data)
        $file = Join-Path '${dir}' 'test.enc'
        [IO.File]::WriteAllBytes($file, (Protect-CaveBytes -Data $data -Password $pw))
        $blob = [IO.File]::ReadAllBytes($file)
        $text = [Text.Encoding]::ASCII.GetString($blob, 0, 8)
        'entete ' + $text
        'taille ' + ($blob.Length -gt $data.Length)
        $back = Unprotect-CaveBytes -Blob $blob -Password $pw
        'identique ' + ((Get-CaveSha256 $back) -eq (Get-CaveSha256 $data))
        try { Unprotect-CaveBytes -Blob $blob -Password $bad | Out-Null; 'mauvais accepte' } catch { 'mauvais refuse : ' + $_.Exception.Message }
        $blob[100] = $blob[100] -bxor 1
        try { Unprotect-CaveBytes -Blob $blob -Password $pw | Out-Null; 'modifie accepte' } catch { 'modifie refuse' }
        try { Unprotect-CaveBytes -Blob ([Text.Encoding]::UTF8.GetBytes('{"pas":"chiffre"}' + (' ' * 100))) -Password $pw | Out-Null; 'etranger accepte' } catch { 'etranger refuse' }
        # Deux chiffrements du même contenu ne se ressemblent pas (sel et vecteur aléatoires).
        $a = Protect-CaveBytes -Data $data -Password $pw
        'different ' + ((Get-CaveSha256 $a) -ne (Get-CaveSha256 ([IO.File]::ReadAllBytes($file))))
      `);
      expect(out).toContain('entete CAVEENC1');
      expect(out).toContain('taille True');
      expect(out).toContain('identique True');
      expect(out).toMatch(/mauvais refuse : Mot de passe incorrect/);
      expect(out).toContain('modifie refuse');
      expect(out).toContain('etranger refuse');
      expect(out).toContain('different True');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('trouve le contenu dans la réponse de Supabase, quelle que soit sa forme ; rien sinon', () => {
    const out = powershell(`
      $ErrorActionPreference = 'Stop'
      . '${LIB}'
      $inner = '{"format":"cave-sauvegarde-v1","public":{"wines":[{"id":1}]}}'
      $formes = @(
        ('[{"sauvegarde":' + $inner + '}]'),
        ('{"rows":[{"sauvegarde":' + $inner + '}]}'),
        ('[{"sauvegarde":' + ($inner | ConvertTo-Json) + '}]')
      )
      foreach ($f in $formes) { $s = Find-CaveBackup ($f | ConvertFrom-Json); 'trouve ' + ($null -ne $s -and $s.public.wines.Count -eq 1) }
      'erreur ' + ($null -eq (Find-CaveBackup ('{"message":"permission denied"}' | ConvertFrom-Json)))
      'vide ' + ($null -eq (Find-CaveBackup ('[]' | ConvertFrom-Json)))
    `);
    expect(out.match(/trouve True/g)).toHaveLength(3);
    expect(out).toContain('erreur True');
    expect(out).toContain('vide True');
  }, 60_000);

  it('les scripts de sauvegarde et de lecture ne contiennent aucune erreur de syntaxe', () => {
    const scripts = ['sauvegarde.ps1', 'dechiffrer-sauvegarde.ps1', 'lib-chiffrement.ps1'].map((f) => join(import.meta.dirname, '..', 'scripts', f));
    const out = powershell(
      scripts
        .map((s) => `$e = $null; [void][Management.Automation.Language.Parser]::ParseFile('${s}', [ref]$null, [ref]$e); 'erreurs ' + $e.Count`)
        .join('\n'),
    );
    expect(out.match(/erreurs 0/g)).toHaveLength(3);
  }, 60_000);
});
