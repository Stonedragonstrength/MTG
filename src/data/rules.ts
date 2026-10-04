import { parseRules, type GlossaryEntry, type RuleEntry } from '../lib/rulesParser';
import { kvGet, kvSet } from './db';

export async function ensureRulesLoaded(): Promise<void> {
  if (await kvGet('rulesLoadedAt')) return;
  const resp = await fetch('/rules/comprehensive-rules.txt');
  if (!resp.ok) throw new Error(`Rules fetch failed: ${resp.status}`);
  const { rules, glossary } = parseRules(await resp.text());
  await kvSet('rules', rules);
  await kvSet('glossary', glossary);
  await kvSet('rulesLoadedAt', Date.now());
}

export async function getGlossary(): Promise<GlossaryEntry[]> {
  return (await kvGet<GlossaryEntry[]>('glossary')) ?? [];
}

export async function searchRules(q: string): Promise<RuleEntry[]> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const rules = (await kvGet<RuleEntry[]>('rules')) ?? [];
  return rules
    .filter((r) => r.number.startsWith(needle) || r.text.toLowerCase().includes(needle))
    .slice(0, 50);
}
