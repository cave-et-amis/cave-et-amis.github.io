import { describe, expect, it } from 'vitest';
import { passwordProblem } from '../src/domain/password.ts';

describe('règle des mots de passe (audit, S6)', () => {
  it('8 caractères au minimum, au moins une lettre et un chiffre ; même règle que le réglage Supabase « Letters and digits »', () => {
    expect(passwordProblem('court1')).toMatch(/8 caractères/);
    expect(passwordProblem('motdepasse')).toMatch(/lettre .* chiffre/);
    expect(passwordProblem('12345678')).toMatch(/lettre .* chiffre/);
    expect(passwordProblem('éèàùéèàù1')).toMatch(/sans accent/);
    expect(passwordProblem('motdepasse-e2e-2026')).toBeNull();
    expect(passwordProblem('Cave2026')).toBeNull();
  });
});
