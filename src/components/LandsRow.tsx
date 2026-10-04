import { useState } from 'react';
import { findBasicLand } from '../data/scryfall';
import { createBoardItem } from '../lib/board';
import { isOneShotSource, landSummary, MANA_COLORS, type ManaColor } from '../lib/mana';
import type { BoardItem } from '../lib/types';
import { useAppStore } from '../state/store';
import CardDetail from './CardDetail';
import CardSearch from './CardSearch';
import { useLongPress } from './useLongPress';

const BASICS: { name: string; color: ManaColor }[] = [
  { name: 'Plains', color: 'W' },
  { name: 'Island', color: 'U' },
  { name: 'Swamp', color: 'B' },
  { name: 'Mountain', color: 'R' },
  { name: 'Forest', color: 'G' },
];

const COLOR_NAMES: Record<ManaColor, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

/** Tap = use one mana source (one-shots get spent); hold = card details. */
function LandStack({
  item,
  onTap,
  onDetail,
}: {
  item: BoardItem;
  onTap: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onTap, onDetail);
  const tapped = item.tapped ?? 0;
  const oneShot = isOneShotSource(item);
  const label =
    `${item.name}` + (tapped > 0 ? `, ${tapped} of ${item.count} tapped` : '');
  return (
    <button
      className={[
        'land-stack',
        tapped >= item.count ? 'land-stack--tapped' : tapped > 0 ? 'land-stack--partial' : '',
        oneShot ? 'land-stack--oneshot' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={oneShot ? 'Tap to spend one' : 'Tap to use one · hold for details'}
      {...press}
    >
      {item.imageNormal ? (
        <img src={item.imageNormal} alt="" loading="lazy" />
      ) : (
        <span className="land-stack-name">{item.name}</span>
      )}
      <span className="count-badge">×{item.count}</span>
      {tapped > 0 && <span className="tapped-badge">{tapped}⤵</span>}
    </button>
  );
}

interface Props {
  playerIdx: number;
}

export default function LandsRow({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  const addItem = useAppStore((s) => s.addItem);
  const changeCount = useAppStore((s) => s.changeCount);
  const tapItem = useAppStore((s) => s.tapItem);
  const untapAll = useAppStore((s) => s.untapAll);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  if (!game) return null;
  const lands = game.players[playerIdx].board.filter((it) => it.zone === 'lands');
  const summary = landSummary(lands);
  const anyTapped = lands.some((it) => (it.tapped ?? 0) > 0);

  async function quickAdd(name: string) {
    const existing = lands.find((it) => it.name === name);
    if (existing) {
      changeCount(playerIdx, existing.id, 1);
      return;
    }
    const card = await findBasicLand(name);
    if (card) addItem(playerIdx, createBoardItem(card, 'lands'));
  }

  return (
    <div className="lands-row">
      <div className="mana-summary">
        <span className="lands-total">{summary.total} lands</span>
        {MANA_COLORS.filter((c) => summary.colors[c] > 0).map((c) => (
          <span
            key={c}
            className={`mana-pip mana-${c}`}
            aria-label={`${summary.colors[c]} ${COLOR_NAMES[c]} sources`}
          >
            {summary.colors[c]}
          </span>
        ))}
        {summary.any > 0 && (
          <span className="mana-pip mana-any" aria-label={`${summary.any} any-color sources`}>
            {summary.any}
          </span>
        )}
        {anyTapped && (
          <button className="untap-btn" aria-label="untap all" onClick={() => untapAll(playerIdx)}>
            ⟳ untap
          </button>
        )}
      </div>

      <div className="lands-stacks">
        {lands.map((item) => (
          <LandStack
            key={item.id}
            item={item}
            onTap={() =>
              isOneShotSource(item)
                ? changeCount(playerIdx, item.id, -1)
                : tapItem(playerIdx, item.id, 1)
            }
            onDetail={() => setDetailId(item.id)}
          />
        ))}
        <span className="basic-adds">
          {BASICS.map((b) => (
            <button
              key={b.name}
              className={`basic-add swatch-${b.color}`}
              aria-label={`add ${b.name}`}
              onClick={() => void quickAdd(b.name)}
            >
              +
            </button>
          ))}
          <button
            className="basic-add land-search"
            aria-label="add a land"
            onClick={() => setSearchOpen(true)}
          >
            🔍
          </button>
        </span>
      </div>

      {searchOpen && (
        <CardSearch playerIdx={playerIdx} zone="lands" onClose={() => setSearchOpen(false)} />
      )}
      {detailId && (
        <CardDetail playerIdx={playerIdx} itemId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
