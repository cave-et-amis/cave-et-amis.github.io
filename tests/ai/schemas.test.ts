import { describe, expect, it } from 'vitest';
import { LABEL_SCHEMA } from '../../server/api/label.ts';
import { REPORT_TOOL } from '../../server/api/price.ts';
import { CHAT_TOOLS } from '../../server/api/tools.ts';

/**
 * Limites de l'API Anthropic pour les schémas stricts (sortie JSON et outils « strict »), cumulées sur toute la requête :
 * 20 outils stricts, 24 paramètres facultatifs, 16 paramètres à type union (anyOf ou liste de types).
 * Le faux Anthropic des tests ne les applique pas : sans ce contrôle, le vrai service répond 400.
 */
type Schema = { type?: unknown; anyOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema };

function count(schema: Schema): { unions: number; optional: number } {
  let unions = 0;
  let optional = 0;
  for (const [name, p] of Object.entries(schema.properties ?? {})) {
    if (p.anyOf || Array.isArray(p.type)) unions += 1;
    if (!(schema.required ?? []).includes(name)) optional += 1;
    for (const nested of [p, p.items, ...(p.anyOf ?? [])]) {
      if (nested?.properties) {
        const c = count(nested);
        unions += c.unions;
        optional += c.optional;
      }
    }
  }
  return { unions, optional };
}

function requestLimits(schemas: Schema[]) {
  return schemas.map(count).reduce((a, b) => ({ unions: a.unions + b.unions, optional: a.optional + b.optional }), { unions: 0, optional: 0 });
}

describe('schémas envoyés à Claude', () => {
  it('lecture d’étiquette : sortie JSON sous les limites', () => {
    const c = requestLimits([LABEL_SCHEMA as Schema]);
    expect(c.unions).toBeLessThanOrEqual(16);
    expect(c.optional).toBeLessThanOrEqual(24);
  });

  it('prix de marché : outil strict sous les limites', () => {
    expect(REPORT_TOOL.strict).toBe(true);
    const c = requestLimits([REPORT_TOOL.input_schema as Schema]);
    expect(c.unions).toBeLessThanOrEqual(16);
    expect(c.optional).toBeLessThanOrEqual(24);
  });

  it('conversation : outils stricts sous les limites', () => {
    const strict = CHAT_TOOLS.filter((t) => 'strict' in t && t.strict);
    expect(strict.length).toBeLessThanOrEqual(20);
    const c = requestLimits(strict.map((t) => (t as { input_schema: Schema }).input_schema));
    expect(c.unions).toBeLessThanOrEqual(16);
    expect(c.optional).toBeLessThanOrEqual(24);
  });
});
