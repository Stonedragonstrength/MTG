import { useEffect, useRef, useState, type MouseEvent } from 'react';
import CounterSheet from './CounterSheet';
import DiscoverSheet from './DiscoverSheet';
import LibrarySearchSheet from './LibrarySearchSheet';
import { shieldBoard } from './Sheet';
import SpellTargetSheet from './SpellTargetSheet';
import { useTriggers, type ShownAct, type ShownTrigger } from './useTriggers';

/** How long a trigger with nothing (left) to press stays in view. */
const QUIET_MS = 8_000;
/** One that still offers something: its player needs the time. */
const ASK_MS = 20_000;
const TICK_MS = 1000;
/** A tap this soon after one came up was aimed at the board it now covers. */
const SETTLE_MS = 350;

function TriggerPanel({ shown }: { shown: ShownTrigger[] }) {
  // The act a list is open for: its target, or a library search.
  const [aiming, setAiming] = useState<{ key: string; actKey: string } | null>(null);
  const [searching, setSearching] = useState<{ key: string; actKey: string } | null>(null);
  const [discovering, setDiscovering] = useState<{ key: string; actKey: string } | null>(null);
  const [countering, setCountering] = useState<{ key: string; actKey: string } | null>(null);

  // A finger may be on its way when it goes: the board it covered sits out
  // the next moment, as it does behind a closing sheet.
  useEffect(() => shieldBoard, []);

  // Each row leaves by itself: after a few seconds in view when it has
  // nothing left to press, after a good while when it still has. Sheets lie
  // over the banner, so only the seconds it can be seen are counted.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const ages = useRef(new Map<string, number>());
  useEffect(() => {
    const covered = () => document.querySelector('.modal-backdrop') !== null;
    let wasCovered = covered();
    const timer = window.setInterval(() => {
      const isCovered = covered();
      const inView = !isCovered && !wasCovered;
      wasCovered = isCovered;
      if (!inView) return;
      const over: string[] = [];
      for (const t of shownRef.current) {
        const age = (ages.current.get(t.key) ?? 0) + TICK_MS;
        ages.current.set(t.key, age);
        if (age >= (t.acts.some((a) => !a.done) ? ASK_MS : QUIET_MS)) over.push(t.key);
      }
      if (over.length > 0) useTriggers.getState().putAway(over);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // It comes up unannounced, quite possibly under a finger on its way to a
  // card: a tap in the first moment after a row arrives does nothing.
  const up = useRef({ key: '', since: 0 });
  const newest = shown[shown.length - 1].key;
  if (up.current.key !== newest) up.current = { key: newest, since: performance.now() };
  const settled = () => performance.now() - up.current.since >= SETTLE_MS;

  const pressed = (e: MouseEvent, t: ShownTrigger, act: ShownAct) => {
    e.stopPropagation(); // the banner's own tap puts it away: a button's must not
    if (!settled()) return;
    if (act.kind === 'prompt' && act.prompt.kind === 'search') setSearching({ key: t.key, actKey: act.key });
    else if (act.kind === 'prompt' && act.prompt.kind === 'discover') setDiscovering({ key: t.key, actKey: act.key });
    else if (act.kind === 'prompt' && act.prompt.kind === 'counter') setCountering({ key: t.key, actKey: act.key });
    else if (act.kind === 'prompt' && act.prompt.pick) setAiming({ key: t.key, actKey: act.key });
    else useTriggers.getState().carryOut(t.key, act.key);
  };

  /** The row and the act a list is open for, while both are still there. */
  const opened = (at: { key: string; actKey: string } | null) => {
    const trigger = at ? shown.find((t) => t.key === at.key) : undefined;
    const act = trigger?.acts.find((a) => a.key === at?.actKey);
    return trigger && act?.kind === 'prompt' ? { trigger, act, prompt: act.prompt } : null;
  };
  const aimed = opened(aiming);
  const searched = opened(searching);
  const discovered = opened(discovering);
  const countered = opened(countering);

  return (
    <>
      <div
        className="trigger-banner"
        role="status"
        aria-label="triggered"
        title="Tap to put away"
        onClick={() => {
          if (settled()) useTriggers.getState().putAway();
        }}
      >
        {shown.map((t) => (
          <div className="trigger-row" key={t.key}>
            {t.source.art ? (
              <img className="trigger-art" src={t.source.art} alt="" />
            ) : (
              <span className="trigger-art trigger-art--empty" />
            )}
            <div className="trigger-body">
              <p className="trigger-title">
                <strong>{t.source.name}</strong>
                <span className="trigger-who">{t.who}</span>
              </p>
              <p className="trigger-because">{t.because}</p>
              <p className="trigger-text">{t.text}</p>
              {t.acts.length > 0 && (
                // A near miss between two buttons is not a tap on the banner.
                <div className="trigger-acts" role="group" aria-label={`what ${t.source.name} does`} onClick={(e) => e.stopPropagation()}>
                  {t.acts.map((act) => (
                    <button
                      key={act.key}
                      className={act.done ? 'spell-prompt spell-prompt--done' : 'spell-prompt'}
                      disabled={act.done}
                      onClick={(e) => pressed(e, t, act)}
                    >
                      {act.done ? `✓ ${act.label.replace(/…$/, '')}` : act.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {aimed && (
        <SpellTargetSheet
          caster={aimed.trigger.seat}
          spell={aimed.trigger.source.name}
          prompt={aimed.prompt}
          onPick={(target) => {
            useTriggers.getState().carryOut(aimed.trigger.key, aimed.act.key, target);
            setAiming(null);
          }}
          onClose={() => setAiming(null)}
        />
      )}
      {searched && searched.prompt.kind === 'search' && (
        <LibrarySearchSheet
          playerIdx={searched.trigger.seat}
          ask={searched.prompt.ask}
          source={searched.trigger.source.name}
          onClose={(did) => {
            // Carried out, its button is done; closed unsearched, it still waits.
            if (did) useTriggers.getState().markDone(searched.trigger.key, searched.act.key);
            setSearching(null);
          }}
        />
      )}
      {discovered && discovered.prompt.kind === 'discover' && (
        <DiscoverSheet
          playerIdx={discovered.trigger.seat}
          n={discovered.prompt.n}
          source={discovered.trigger.source.name}
          onClose={(did) => {
            // Answered, its button is done; closed unanswered, it still waits.
            if (did) useTriggers.getState().markDone(discovered.trigger.key, discovered.act.key);
            setDiscovering(null);
          }}
        />
      )}
      {countered && countered.prompt.kind === 'counter' && (
        <CounterSheet
          caster={countered.trigger.seat}
          source={countered.trigger.source.name}
          sourceIid={countered.trigger.source.iid}
          prompt={countered.prompt}
          onDone={() => {
            useTriggers.getState().markDone(countered.trigger.key, countered.act.key);
            setCountering(null);
          }}
          onClose={() => setCountering(null)}
        />
      )}
    </>
  );
}

/** Cards that have just triggered by themselves, at the top of the screen:
 * which card, what set it off, and what it does — done already where that
 * needed no choice ("✓ Return it to hand"), a button where it does. A tap
 * on it puts it away. Not a sheet: it claims no back press and lies under
 * every sheet, like the banner of a spell being cast. */
export default function TriggerBanner() {
  const shown = useTriggers((s) => s.shown);
  if (shown.length === 0) return null;
  return <TriggerPanel shown={shown} />;
}
