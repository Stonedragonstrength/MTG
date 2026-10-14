import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { REVEAL_FRESH_MS } from '../lib/cards';
import { bestToken } from '../lib/deckTokens';
import { modesToChoose, spellPrompts, type SpellPrompt, type SpellTarget } from '../lib/spellEffects';
import type { CardRecord, Reveal } from '../lib/types';
import { useAppStore } from '../state/store';
import DiscoverSheet from './DiscoverSheet';
import LibrarySearchSheet from './LibrarySearchSheet';
import { shieldBoard } from './Sheet';
import { carryOutPrompt } from './spellActs';
import SpellTargetSheet from './SpellTargetSheet';
import { useCardRecords } from './useCardRecords';

/** How long it stays in view before it puts itself away. */
const SHOW_MS = 12_000;
/** A spell being cast is one card everybody knows the look of: shorter. */
const CAST_SHOW_MS = 7_000;
/** …unless it is still offering to do something: its player needs the time. */
const CAST_ASK_MS = 20_000;
/** Everything it offered has been done: it goes a moment later. */
const ASKED_MS = 1_000;
const TICK_MS = 1000;
/** A tap this soon after it came up was aimed at the board it now covers. */
const SETTLE_MS = 350;
/** Up to five cards across; more wrap onto further rows. */
const PER_ROW = 5;

/** Reveals this device has put away, by id. Kept in the browser session as
 * well as in memory, so a reload does not show a young one a second time.
 * Where the session cannot store (or is a new one) only that is lost: the
 * two-minute limit (see `isYoung`) still keeps old reveals from coming back. */
const SESSION_KEY = 'reveals-put-away';
const putAway = new Set<string>(rememberedInSession());

function rememberedInSession(): string[] {
  try {
    const ids: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function putReveal(id: string): void {
  putAway.add(id);
  try {
    // Only the latest reveal can ever come back, so a short tail is plenty.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...putAway].slice(-20)));
  } catch {
    // Memory alone will do.
  }
}

/** When this device first saw the latest reveal, by its own clock. A stamp
 * from a device whose clock runs ahead never looks old here, so the stamp
 * alone would bring such a reveal back on every reopening of the app. This
 * outlives the session for exactly that reason; only the latest reveal can
 * come back, so one entry is all it takes. */
const SEEN_KEY = 'reveal-first-seen';
let seen = rememberedSeen();

function rememberedSeen(): { id: string; at: number } | null {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null');
    if (typeof kept !== 'object' || kept === null) return null;
    const { id, at } = kept as { id?: unknown; at?: unknown };
    return typeof id === 'string' && typeof at === 'number' && Number.isFinite(at) ? { id, at } : null;
  } catch {
    return null;
  }
}

function firstSeen(id: string): number {
  if (seen?.id !== id) {
    seen = { id, at: Date.now() };
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {
      // Memory alone will do until the app is closed.
    }
  }
  return seen.at;
}

/** Young enough to be news: by its stamp, and by how long this device has
 * known of it (either way round, should this device's own clock be put back). */
function isYoung(reveal: Reveal): boolean {
  const now = Date.now();
  return now - reveal.t < REVEAL_FRESH_MS && Math.abs(now - firstSeen(reveal.id)) < REVEAL_FRESH_MS;
}

/** Test hook: a fresh page load — memory gone, the browser's storage still there. */
export function _reloadRevealMemory(): void {
  putAway.clear();
  for (const id of rememberedInSession()) putAway.add(id);
  seen = rememberedSeen();
}

/** The token card each "make tokens" prompt would put on the board, by the
 * prompt's key. A prompt this device has no token card for has no entry,
 * and so no button: the "+" on the board still covers it. */
function useTokenCards(prompts: SpellPrompt[]): Record<string, CardRecord> {
  const [found, setFound] = useState<Record<string, CardRecord>>({});
  const wantsKey = JSON.stringify(prompts.flatMap((p) => (p.kind === 'tokens' ? [{ key: p.key, want: p.want }] : [])));
  useEffect(() => {
    const asked: { key: string; want: Parameters<typeof bestToken>[0] }[] = JSON.parse(wantsKey);
    if (asked.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { findCardsNamed } = await import('../data/scryfall');
      const out: Record<string, CardRecord> = {};
      for (const { key, want } of asked) {
        const hit = bestToken(want, await findCardsNamed(want.name));
        if (hit) out[key] = hit;
      }
      if (!cancelled) setFound(out);
    })().catch(() => {}); // a read that fails offers no token button, nothing worse
    return () => {
      cancelled = true;
    };
  }, [wantsKey]);
  return found;
}

interface PanelProps {
  reveal: Reveal;
  who: string;
  onDone: () => void;
}

function RevealPanel({ reveal, who, onDone }: PanelProps) {
  const records = useCardRecords(reveal.cards);
  const cast = reveal.from === 'cast';

  // What the spell does, as buttons under it (lib/spellEffects.ts). Only
  // where its caster can reach them: on the shared tablet, or on the
  // caster's own device at an online table.
  const mySeat = useAppStore((s) => s.online?.mySeat);
  const asks = cast && (mySeat == null || mySeat === reveal.seat);
  const spell = records[reveal.cards[0].cardId];
  const read = asks ? spellPrompts(spell, { x: reveal.x }) : [];
  const tokenCards = useTokenCards(read);
  const prompts = read.filter((p) => p.kind !== 'tokens' || tokenCards[p.key]);
  const [used, setUsed] = useState<{ id: string; keys: string[] }>({ id: reveal.id, keys: [] });
  const usedKeys = used.id === reveal.id ? used.keys : [];
  // A modal spell ("Choose one —"): once its caster has taken as many of
  // its options as it allows, the others are not happening — their buttons
  // go quiet, and nothing is left to wait for.
  const allowed = modesToChoose(spell);
  const taken = new Set(prompts.flatMap((p) => (p.mode !== undefined && usedKeys.includes(p.key) ? [p.mode] : [])));
  const passedOver = (p: SpellPrompt) =>
    allowed !== null && p.mode !== undefined && taken.size >= allowed && !taken.has(p.mode);
  const asking = prompts.some((p) => !usedKeys.includes(p.key) && !passedOver(p));
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const [aiming, setAiming] = useState<{ id: string; prompt: SpellPrompt } | null>(null);
  // The spell sends its caster through their library: that list is open.
  const [searching, setSearching] = useState<{ id: string; prompt: SpellPrompt } | null>(null);
  // …or turns cards over for a discover: that sheet is open.
  const [discovering, setDiscovering] = useState<{ id: string; prompt: SpellPrompt } | null>(null);

  // The tap that puts it away is often the first half of a double tap, and a
  // finger may be on its way when it times out: either way the board it was
  // covering sits out the next moment, as it does behind a closing sheet.
  useEffect(() => shieldBoard, []);

  // Every change at the table redraws this; only a NEW reveal restarts its clock.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    // Sheets lie over it (it sits under every backdrop), so its twelve
    // seconds only run while it can be seen: a player who reveals from a
    // look still gets to see it land once the look is done.
    const covered = () => document.querySelector('.modal-backdrop') !== null;
    let inView = 0;
    let wasCovered = covered();
    const timer = window.setInterval(() => {
      if (!isYoung(reveal)) {
        doneRef.current(); // went stale while it waited
        return;
      }
      const isCovered = covered();
      // A second counts only if nothing lay over it at either end of it, so
      // what a closing sheet uncovers stays up twelve seconds or a little
      // more, never less.
      if (!isCovered && !wasCovered) inView += TICK_MS;
      wasCovered = isCovered;
      const cast = reveal.from === 'cast';
      if (inView >= (!cast ? SHOW_MS : askingRef.current ? CAST_ASK_MS : CAST_SHOW_MS)) doneRef.current();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [reveal.id, reveal.t, reveal.from]);

  // Every button it offered has been pressed (or, of a modal spell, the
  // option its caster chose): nothing is left to wait for.
  const asked = prompts.length > 0 && !asking;
  useEffect(() => {
    if (!asked) return;
    const timer = window.setTimeout(() => doneRef.current(), ASKED_MS);
    return () => window.clearTimeout(timer);
  }, [asked, reveal.id]);

  // It comes up unannounced in the middle of the table, quite possibly under
  // a finger on its way to a card. A tap in its first moment (and a new
  // reveal starts a new one) is swallowed: it must not put away what nobody
  // has had the time to see.
  const up = useRef({ id: '', since: 0 });
  if (up.current.id !== reveal.id) up.current = { id: reveal.id, since: performance.now() };
  const tapped = () => {
    if (performance.now() - up.current.since >= SETTLE_MS) onDone();
  };

  const n = reveal.cards.length;
  const sizing = {
    '--reveal-cols': Math.min(n, PER_ROW),
    '--reveal-rows': Math.ceil(n / PER_ROW),
    // One card is shown big; a fan of them shares the room.
    '--reveal-max': n === 1 ? '280px' : n === 2 ? '220px' : '170px',
  } as CSSProperties;

  // A spell on its way to the graveyard: the same banner, lit in the
  // spell's own color. One color wears it, two or more wear gold, none
  // (an artifact spell, a card this device cannot read) wears steel.
  const colors = cast ? (records[reveal.cards[0].cardId]?.colors ?? []) : [];
  const spellColor = colors.length === 1 ? colors[0] : colors.length > 1 ? 'M' : 'C';

  /** Carries out one prompt (with its target, when it asked for one) and
   * marks its button done. Each is one move at the table: one Undo. */
  const carryOut = (prompt: SpellPrompt, target?: SpellTarget) => {
    if (!carryOutPrompt(reveal.seat, reveal.cards[0].name, prompt, tokenCards[prompt.key], target)) return;
    setUsed({ id: reveal.id, keys: [...usedKeys, prompt.key] });
  };
  const pressed = (e: MouseEvent, prompt: SpellPrompt) => {
    e.stopPropagation(); // the banner's own tap puts it away: a button's must not
    if (performance.now() - up.current.since < SETTLE_MS) return; // aimed at the board it now covers
    if (prompt.kind === 'search') setSearching({ id: reveal.id, prompt });
    else if (prompt.kind === 'discover') setDiscovering({ id: reveal.id, prompt });
    else if (prompt.pick) setAiming({ id: reveal.id, prompt });
    else carryOut(prompt);
  };

  const banner = (
    <div
      className={
        cast
          ? `reveal-banner reveal-banner--cast spell-${spellColor}${prompts.length > 0 ? ' reveal-banner--asks' : ''}`
          : 'reveal-banner'
      }
      role="status"
      title="Tap to put away"
      onClick={tapped}
    >
      <p className="reveal-title">
        <strong>{who}</strong> {cast ? 'casts' : 'reveals'}
      </p>
      <p className="reveal-from">
        {cast
          ? reveal.cards.map((c) => c.name).join(', ')
          : reveal.from === 'hand'
            ? 'from their hand'
            : 'from the top of their library'}
      </p>
      <ul className="reveal-cards" style={sizing}>
        {reveal.cards.map((c, i) => {
          const art = records[c.cardId]?.imageNormal;
          return (
            // Two copies of one card are two cards: the place in the list is the key.
            <li key={i} className="reveal-card">
              {/* The name sits under the art: it shows while there is no image. */}
              <span className="reveal-name">{c.name}</span>
              {art && <img src={art} alt="" />}
            </li>
          );
        })}
      </ul>
      {prompts.length > 0 && (
        // A near miss between two buttons is not a tap on the banner.
        <div className="spell-prompts" role="group" aria-label="what it does" onClick={(e) => e.stopPropagation()}>
          {prompts.map((prompt) => {
            const done = usedKeys.includes(prompt.key);
            const off = !done && passedOver(prompt);
            return (
              <button
                key={prompt.key}
                className={done ? 'spell-prompt spell-prompt--done' : off ? 'spell-prompt spell-prompt--off' : 'spell-prompt'}
                disabled={done || off}
                onClick={(e) => pressed(e, prompt)}
              >
                {done ? `✓ ${prompt.label.replace(/…$/, '')}` : prompt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // The list is a sheet of its own, beside the banner and not inside it: a
  // tap in a sheet travels up through whatever drew it, and would put the
  // banner away. It goes with the banner when the cast does.
  return (
    <>
      {banner}
      {aiming && aiming.id === reveal.id && (
        <SpellTargetSheet
          caster={reveal.seat}
          spell={reveal.cards[0]?.name ?? 'Spell'}
          revealId={reveal.id}
          prompt={aiming.prompt}
          onPick={(target) => {
            carryOut(aiming.prompt, target);
            setAiming(null);
          }}
          onClose={() => setAiming(null)}
        />
      )}
      {searching && searching.id === reveal.id && searching.prompt.kind === 'search' && (
        <LibrarySearchSheet
          playerIdx={reveal.seat}
          ask={searching.prompt.ask}
          source={reveal.cards[0].name}
          onClose={(searched) => {
            // Carried out, its button is done; closed unsearched, it still waits.
            if (searched) setUsed({ id: reveal.id, keys: [...usedKeys, searching.prompt.key] });
            setSearching(null);
          }}
        />
      )}
      {discovering && discovering.id === reveal.id && discovering.prompt.kind === 'discover' && (
        <DiscoverSheet
          playerIdx={reveal.seat}
          n={discovering.prompt.n}
          source={reveal.cards[0].name}
          onClose={(did) => {
            // Answered, its button is done; closed unanswered, it still waits.
            if (did) setUsed({ id: reveal.id, keys: [...usedKeys, discovering.prompt.key] });
            setDiscovering(null);
          }}
        />
      )}
    </>
  );
}

/** Cards a player is showing the whole table, centred on every device at it
 * (the revealing one too) until tapped away or twelve seconds have passed.
 * Not a sheet: it claims no back press and lies under every sheet. */
export default function RevealBanner() {
  // Only the reveal and its player's name: the rest of the game changing is no reason to redraw.
  const reveal = useAppStore((s) => s.game?.reveal);
  const who = useAppStore((s) =>
    s.game?.reveal ? s.game.config.profiles[s.game.reveal.seat]?.name : undefined,
  );
  const [, redraw] = useState(0);
  if (!reveal) return null;
  // By this device's clock, read at render: a reveal first seen long after it
  // was made (a reload, a saved game picked up, a table rejoined) never shows.
  const fresh = !putAway.has(reveal.id) && isYoung(reveal);
  if (!fresh) return null;
  return (
    <RevealPanel
      reveal={reveal}
      who={who ?? '?'}
      onDone={() => {
        putReveal(reveal.id);
        redraw((n) => n + 1);
      }}
    />
  );
}
