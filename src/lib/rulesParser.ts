export interface RuleEntry {
  number: string;
  text: string;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

const RULE_LINE = /^(\d+(?:\.\d+)?[a-z]?)\.?\s+(.+)$/;

function lastIndexOfLine(lines: string[], marker: string): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === marker) return i;
  }
  return -1;
}

export function parseRules(text: string): { rules: RuleEntry[]; glossary: GlossaryEntry[] } {
  const lines = text.split(/\r?\n/);
  const glossaryStart = lastIndexOfLine(lines, 'Glossary');
  const creditsEnd = lastIndexOfLine(lines, 'Credits');

  // Rules: everything before the (real) glossary section.
  const rules: RuleEntry[] = [];
  let current: RuleEntry | null = null;
  const ruleLines = glossaryStart === -1 ? lines : lines.slice(0, glossaryStart);
  for (const line of ruleLines) {
    const match = RULE_LINE.exec(line);
    if (match) {
      current = { number: match[1], text: match[2].trim() };
      rules.push(current);
    } else if (line.trim() === '') {
      current = null;
    } else if (current) {
      current.text += '\n' + line.trim();
    }
  }

  // The table of contents repeats section headers ("702. Keyword Abilities");
  // keep one entry per rule number, preferring the later (body) occurrence.
  const byNumber = new Map<string, RuleEntry>();
  for (const rule of rules) byNumber.set(rule.number, rule);
  const dedupedRules = [...byNumber.values()];

  // Glossary: blank-separated blocks of term + definition lines, until Credits.
  const glossary: GlossaryEntry[] = [];
  if (glossaryStart !== -1) {
    const end = creditsEnd > glossaryStart ? creditsEnd : lines.length;
    let block: string[] = [];
    const flush = () => {
      if (block.length >= 2) {
        glossary.push({ term: block[0], definition: block.slice(1).join('\n') });
      } else if (block.length === 1 && glossary.length > 0) {
        glossary[glossary.length - 1].definition += '\n' + block[0];
      }
      block = [];
    };
    for (const line of lines.slice(glossaryStart + 1, end)) {
      const trimmed = line.trim();
      if (trimmed === '') flush();
      else block.push(trimmed);
    }
    flush();
  }

  return { rules: dedupedRules, glossary };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findGlossaryTerms(
  oracleText: string,
  terms: string[],
): { term: string; start: number; end: number }[] {
  const byLength = [...terms].sort((a, b) => b.length - a.length);
  const taken = new Array<boolean>(oracleText.length).fill(false);
  const found: { term: string; start: number; end: number }[] = [];

  for (const term of byLength) {
    if (!term) continue;
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(oracleText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      let overlaps = false;
      for (let i = start; i < end; i++) {
        if (taken[i]) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        found.push({ term, start, end });
        for (let i = start; i < end; i++) taken[i] = true;
      }
    }
  }

  return found.sort((a, b) => a.start - b.start);
}
