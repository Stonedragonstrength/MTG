# MTG Table Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline-first PWA for a tablet lying flat on the table that tracks life, commander damage, tokens, and counters for in-person Magic games, with full offline card search and a built-in rules/glossary reference.

**Architecture:** Pure game-logic functions (`src/lib`) with no React or storage dependencies, a data layer (`src/data`) built on Dexie/IndexedDB holding the Scryfall card database and parsed rules, a thin Zustand store (`src/state`) that wires logic to persistence, and React components (`src/components`) on top. Service worker (vite-plugin-pwa/Workbox) provides install + offline + permanent image caching.

**Tech Stack:** React 18, TypeScript, Vite, vite-plugin-pwa, Dexie, Zustand, Vitest + React Testing Library, fake-indexeddb (tests).

**Spec:** `docs/superpowers/specs/2026-10-03-mtg-companion-design.md`

## Global Constraints

- Offline after first-time setup: no network call may be required for gameplay, search, or rules lookup.
- Companion model: no feature may require entering a card to keep game state correct.
- Commander: starting life 40, commander damage threshold default **21**, threshold configurable per game.
- Standard/1v1: starting life 20.
- 2–4 players, zones rotated to face their seats.
- All persistent state in IndexedDB on-device; no server, no accounts, no analytics.
- Scryfall API etiquette: identify with a custom User-Agent where possible, ≤10 requests/sec during pre-caching.
- Game state must survive app/tab close and restore on next open.

## Review Focus

1. **Commander damage at threshold with life still positive** — player must be eliminated at 21 commander damage even at 30 life, and gaining life afterwards must not un-eliminate them. (Test pinned in Task 2.)
2. **passTurn with eliminated players** — must skip eliminated seats and must not infinite-loop when only one (or zero) players remain. (Test pinned in Task 2.)
3. **Stack split abuse** — splitting a ×8 stack by 0, 8, or 9 must be rejected; counts may never be created or destroyed by a split. Decrementing count to 0 removes the item. (Tests pinned in Task 3.)
4. **Double-faced / irregular Scryfall entries** — cards with `card_faces` (no top-level `oracle_text`/`image_uris`) and layouts like `art_series` must import without crashing and with usable name/image/text. (Tests pinned in Task 5.)
5. **Corrupted or missing persisted game** — on launch with absent, truncated, or schema-mismatched saved state, the app must offer a fresh start, never a crash loop. (Test pinned in Task 7.)

---

## File Structure

```
package.json / vite.config.ts / tsconfig.json / index.html
public/rules/comprehensive-rules.txt      # bundled WotC Comp Rules text
src/
  main.tsx  App.tsx
  lib/
    types.ts         # shared domain types (no deps)
    game.ts          # createGame, life, commander dmg, turns, elimination
    board.ts         # board items: add/count/split/counters/computed P/T
    fuzzy.ts         # fuzzy name scoring + search
    rulesParser.ts   # comp rules text -> sections + glossary; keyword finder
  data/
    db.ts            # Dexie schema (cards, profiles, kv, meta)
    scryfall.ts      # bulk import, slimCard mapping, name index, lookups
    rules.ts         # load bundled rules into db, query glossary/sections
    images.ts        # pre-cache helpers (tokens, land art pack)
  state/
    store.ts         # Zustand store: game actions + persistence + setup status
  components/
    SetupGate.tsx    # first-run download flow w/ progress
    HomeScreen.tsx   # profiles + new game
    ProfileEditor.tsx AvatarPicker.tsx
    NewGameScreen.tsx
    GameScreen.tsx   # zone layout for 2/3/4 players
    PlayerZone.tsx LifeCounter.tsx CommanderDamage.tsx
    BoardStrip.tsx CardSearch.tsx CardDetail.tsx CustomTokenForm.tsx
    CenterHub.tsx DiceRoller.tsx SettingsSheet.tsx
    RulesViewer.tsx
    LandBackground.tsx
  styles/ (global.css, zones.css, …)
tests mirror src/ under src/**/*.test.ts(x)
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/global.css`, `.gitignore`

**Interfaces:**
- Produces: a running `npm run dev` app, `npm test` (vitest) green, `npm run build` clean.

- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts` (in repo root; keep existing docs/). Then `npm i zustand dexie` and `npm i -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom fake-indexeddb vite-plugin-pwa`.
- [ ] **Step 2:** Configure `vite.config.ts` with vitest (`environment: 'jsdom'`, `setupFiles: './src/test-setup.ts'`, globals true). Create `src/test-setup.ts` importing `@testing-library/jest-dom` and `fake-indexeddb/auto`.
- [ ] **Step 3:** Replace template `App.tsx` with a placeholder `<div>MTG Companion</div>`; add a smoke test `src/App.test.tsx` asserting the text renders. Run `npx vitest run` → PASS.
- [ ] **Step 4:** `npm run build` → succeeds. Commit `chore: scaffold Vite + React + TS + Vitest project`.

### Task 2: Core game logic (life, commander damage, turns, elimination)

**Files:**
- Create: `src/lib/types.ts`, `src/lib/game.ts`
- Test: `src/lib/game.test.ts`

**Interfaces:**
- Produces (exact):

```ts
// types.ts
export type Format = 'commander' | 'standard';
export interface PlayerProfile { id: string; name: string; avatarUrl: string | null; commanderName: string | null; }
export interface GameConfig { format: Format; startingLife: number; commanderDamageThreshold: number; profiles: PlayerProfile[]; }
export interface BoardItem {
  id: string; cardId: string | null; name: string;
  imageNormal: string | null; imageArtCrop: string | null;
  typeLine: string; oracleText: string;
  basePower: number | null; baseToughness: number | null;
  count: number; counters: Record<string, number>; // key 'p1p1' = +1/+1
  color: string | null; // custom tokens only
}
export interface PlayerState { profileId: string; life: number; commanderDamage: Record<string, number>; eliminated: boolean; board: BoardItem[]; }
export interface GameState { config: GameConfig; players: PlayerState[]; activePlayerIndex: number; turnNumber: number; }

// game.ts — all pure, return new GameState
export function createGame(config: GameConfig): GameState;
export function adjustLife(s: GameState, playerIdx: number, delta: number): GameState;
export function applyCommanderDamage(s: GameState, defenderIdx: number, attackerProfileId: string, delta: number): GameState; // clamps ≥0, also adjusts life by -delta
export function passTurn(s: GameState): GameState; // skips eliminated; increments turnNumber when wrapping past seat 0
```

Elimination rule (recomputed inside adjustLife/applyCommanderDamage): `eliminated` becomes true when `life <= 0` or (commander format) any `commanderDamage[x] >= threshold`. **Once true it stays true** (sticky), even if life is later raised.

- [ ] **Step 1:** Write failing tests covering: createGame seeds life from config for each profile; adjustLife ±; life ≤0 eliminates; commander damage: applyCommanderDamage(+3) raises damage 3 and lowers life 3; damage reaching threshold (21) eliminates even at high life (Review Focus 1); negative delta clamps damage at 0 and refunds life symmetrically; sticky elimination — after elimination, adjustLife(+10) leaves eliminated=true (Review Focus 1); passTurn advances seat, skips eliminated seats, increments turnNumber on wrap, and with one survivor returns same active seat without hanging (Review Focus 2).
- [ ] **Step 2:** `npx vitest run src/lib/game.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `types.ts` + `game.ts`. passTurn: loop at most `players.length` steps to find next non-eliminated; if none found, return state with turnNumber untouched.
- [ ] **Step 4:** Tests PASS. Commit `feat: core game state logic`.

### Task 3: Board items (tokens, duplication, split, counters, computed P/T)

**Files:**
- Create: `src/lib/board.ts`
- Test: `src/lib/board.test.ts`

**Interfaces:**
- Consumes: `GameState`, `BoardItem`, `CardRecord` (defined here, used by data layer later — put in `types.ts`):

```ts
export interface CardRecord {
  id: string; name: string; nameLower: string; typeLine: string; oracleText: string;
  manaCost: string; power: string | null; toughness: string | null; colors: string[];
  imageNormal: string | null; imageArtCrop: string | null; isToken: boolean; isBasicLand: boolean;
}
```

- Produces (exact):

```ts
export function createBoardItem(card: CardRecord): BoardItem;            // count 1, counters {}
export function createCustomToken(name: string, power: number | null, toughness: number | null, color: string): BoardItem;
export function addItem(s: GameState, playerIdx: number, item: BoardItem): GameState;
export function changeCount(s: GameState, playerIdx: number, itemId: string, delta: number): GameState; // floor 0 => item removed
export function splitItem(s: GameState, playerIdx: number, itemId: string, moveCount: number): GameState; // new item id, counters NOT copied
export function setCounter(s: GameState, playerIdx: number, itemId: string, counterName: string, value: number): GameState; // value<=0 deletes key
export function removeItem(s: GameState, playerIdx: number, itemId: string): GameState;
export function computedPT(item: BoardItem): { power: number; toughness: number } | null; // null when no base P/T; base + p1p1 each side
```

- [ ] **Step 1:** Failing tests: createBoardItem maps CardRecord fields, parses power "2" → 2, "*" → null; changeCount +1/+1 on a Treasure yields count 3; changeCount −3 on count 3 removes item (Review Focus 3); splitItem(×8, move 3) → two items 5 and 3, total conserved, counters stay on original only; splitItem rejects moveCount ≤0 or ≥count by returning state unchanged (Review Focus 3); setCounter p1p1=2 on a 1/1 → computedPT 3/3; named counter ('oil') does not affect P/T; setCounter to 0 removes the key; computedPT null for a Clue (no P/T).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit `feat: board item logic`.

### Task 4: Fuzzy card-name search

**Files:**
- Create: `src/lib/fuzzy.ts`
- Test: `src/lib/fuzzy.test.ts`

**Interfaces:**
- Produces:

```ts
export function normalize(s: string): string; // lowercase, strip diacritics (Jötun→jotun), strip non-alphanumerics to spaces
export function fuzzyScore(query: string, target: string): number; // 0 = no match; exact > prefix > word-start > subsequence
export function searchNames(query: string, names: { id: string; name: string }[], limit?: number): { id: string; name: string }[]; // limit default 20, empty query => []
```

- [ ] **Step 1:** Failing tests: "sol r" matches "Sol Ring" above "Solemn Simulacrum"; "teferi protection" finds "Teferi's Protection" (apostrophe stripped); "lim dul" matches "Lim-Dûl the Necromancer" (diacritics+hyphen); empty/whitespace query returns []; limit respected; exact name ranks first.
- [ ] **Step 2:** FAIL. **Step 3:** Implement: normalize both sides; score = 1000 exact, 800 prefix, 600 all query words are word-prefixes in order, 300 subsequence, minus small length penalty. **Step 4:** PASS. Commit `feat: fuzzy card name search`.

### Task 5: Dexie schema + Scryfall bulk import

**Files:**
- Create: `src/data/db.ts`, `src/data/scryfall.ts`
- Test: `src/data/scryfall.test.ts`

**Interfaces:**
- Produces:

```ts
// db.ts
export class AppDb extends Dexie {
  cards!: Table<CardRecord, string>;          // pk id, index nameLower
  profiles!: Table<PlayerProfile, string>;
  kv!: Table<{ key: string; value: unknown }, string>;   // game state, settings, setup flags
}
export function getDb(): AppDb; // singleton

// scryfall.ts
export function slimCard(raw: Record<string, unknown>): CardRecord | null; // null = skip (art_series, memorabilia, no name)
export async function importBulkData(onProgress: (pct: number, msg: string) => void): Promise<number>; // fetches bulk index → oracle_cards URI → maps+chunk-puts; stores kv 'cardsImportedAt'; returns count
export async function getCardById(id: string): Promise<CardRecord | undefined>;
export async function loadNameIndex(): Promise<{ id: string; name: string }[]>; // id+name only, for in-memory search
```

- Mapping rules for `slimCard`: skip layouts `art_series`, `token`? **No** — tokens are wanted (`isToken = layout === 'token' || type_line includes 'Token'`); skip `art_series` and entries without `name`. For cards with `card_faces` and no top-level `oracle_text`, join faces' oracle_texts with `\n//\n` and take `image_uris` from face 0 when top-level missing (Review Focus 4). `isBasicLand = type_line startsWith 'Basic Land'`. Image fields from `image_uris.normal` / `image_uris.art_crop` else null.

- [ ] **Step 1:** Failing tests with inline fixture JSON: a normal creature maps all fields; a transform DFC (card_faces, no top-level image/text) maps joined text + face-0 images (Review Focus 4); an `art_series` entry → null; a token gets isToken; a Forest gets isBasicLand; importBulkData with a mocked `fetch` (two-step: bulk index then 3-card payload) writes 3 rows to fake-indexeddb and reports progress ending at 100.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (chunked `bulkPut` of 2000; fetch with `Accept: application/json`). **Step 4:** PASS. Commit `feat: card database import`.

### Task 6: Rules & glossary (parser + data access)

**Files:**
- Create: `src/lib/rulesParser.ts`, `src/data/rules.ts`, `public/rules/comprehensive-rules.txt`
- Test: `src/lib/rulesParser.test.ts`

**Interfaces:**
- Produces:

```ts
// rulesParser.ts
export interface RuleEntry { number: string; text: string; }          // e.g. '702.19b'
export interface GlossaryEntry { term: string; definition: string; }
export function parseRules(text: string): { rules: RuleEntry[]; glossary: GlossaryEntry[] };
export function findGlossaryTerms(oracleText: string, terms: string[]): { term: string; start: number; end: number }[]; // longest-match-first, case-insensitive, word boundaries, non-overlapping

// data/rules.ts
export async function ensureRulesLoaded(): Promise<void>; // fetch('/rules/comprehensive-rules.txt') → parse → kv 'rules' + 'glossary' (idempotent)
export async function getGlossary(): Promise<GlossaryEntry[]>;
export async function searchRules(q: string): Promise<RuleEntry[]>;   // substring match on number or text, cap 50
```

- Comp Rules format: rules lines look like `702.19b Reach means …` (number, space, text; continuation lines indented/following until next number). Glossary: after a line that is exactly `Glossary`, entries are `Term` line followed by definition line(s), separated by blank lines, until the `Credits` line.

- [ ] **Step 1:** Download the current Comprehensive Rules TXT from the link on https://magic.wizards.com/en/rules (e.g. `MagicCompRules YYYYMMDD.txt`) into `public/rules/comprehensive-rules.txt` via curl. If the CDN refuses, grab via browser manually — file is ~3MB, committed to the repo.
- [ ] **Step 2:** Failing parser tests using a ~30-line inline fixture mimicking the format: parses `702.19b` with a multi-line body; parses two glossary entries incl. a multi-line definition; stops glossary at Credits; findGlossaryTerms finds "Flying" and "First Strike" in "Flying, first strike" with correct offsets, prefers "First Strike" over "First" (longest match), respects word boundaries ("Warding" does not match "Ward").
- [ ] **Step 3:** FAIL → implement → PASS. Also run parseRules once against the real bundled file in a test asserting >2000 rules and >500 glossary entries parsed (sanity, catches format drift).
- [ ] **Step 4:** Commit `feat: comprehensive rules parsing and glossary`.

### Task 7: App store + persistence

**Files:**
- Create: `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**
- Produces (Zustand):

```ts
interface AppStore {
  setupDone: boolean;           // kv 'cardsImportedAt' exists
  game: GameState | null;
  profiles: PlayerProfile[];
  init(): Promise<void>;        // loads setupDone, profiles, saved game from kv 'activeGame'
  startGame(config: GameConfig): void;
  endGame(): void;
  // thin wrappers delegating to lib fns then persist(): adjustLife, applyCommanderDamage, passTurn,
  // addItem, changeCount, splitItem, setCounter, removeItem  (same arg shapes as lib, minus state)
  saveProfile(p: PlayerProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
}
export const useAppStore: UseBoundStore<StoreApi<AppStore>>;
```

- Persistence: every mutating action writes `game` to kv `'activeGame'` (fire-and-forget). `init()` wraps the kv read in try/catch + shape check (`players` array present, `config.startingLife` number); on any failure it clears the key and leaves `game = null` (Review Focus 5).

- [ ] **Step 1:** Failing tests (fake-indexeddb): startGame→adjustLife→ new store instance → init() restores the same life total; init() with garbage stored at 'activeGame' (`{"players": "nope"}`) yields game=null and does not throw (Review Focus 5); endGame clears kv; saveProfile round-trips.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: app store with persistence`.

### Task 8: Setup flow — first-run download, profiles, new game

**Files:**
- Create: `src/components/SetupGate.tsx`, `src/components/HomeScreen.tsx`, `src/components/ProfileEditor.tsx`, `src/components/AvatarPicker.tsx`, `src/components/NewGameScreen.tsx`; wire into `App.tsx`
- Test: `src/components/SetupGate.test.tsx`, `src/components/NewGameScreen.test.tsx`

**Interfaces:**
- Consumes: `useAppStore`, `importBulkData`, `ensureRulesLoaded`, `searchNames`/`loadNameIndex`, `getCardById`.
- Produces: `App.tsx` routing: `!setupDone → SetupGate`, `setupDone && !game → HomeScreen`, `game → GameScreen`.

Component behavior:
- **SetupGate:** explains the one-time ~150MB download, button "Download card database"; drives `importBulkData` + `ensureRulesLoaded` with a progress bar; on completion sets setupDone. Errors show a retry button with the message.
- **HomeScreen:** profile cards (add/edit via ProfileEditor), big "New Game" button.
- **ProfileEditor:** name input, avatar (AvatarPicker = card search → uses `imageArtCrop`), optional commander name (same search), save → `saveProfile`.
- **NewGameScreen:** format toggle (Commander 40 / Standard 20), commander-damage threshold number input (default 21, visible only for Commander), select 2–4 profiles in seat order, Start → `startGame(config)`.

- [ ] **Step 1:** Failing tests: SetupGate renders download button and, with mocked import resolving, flips to done state; NewGameScreen with 2 profiles selected and format commander calls `startGame` with startingLife 40, threshold 21; selecting Standard yields 20; Start disabled with <2 profiles.
- [ ] **Step 2:** FAIL → implement components (plain CSS in `styles/`) → PASS. Manual check in `npm run dev`. Commit `feat: setup, profiles, new game flow`.

### Task 9: Game screen — zones, life, commander damage

**Files:**
- Create: `src/components/GameScreen.tsx`, `PlayerZone.tsx`, `LifeCounter.tsx`, `CommanderDamage.tsx`, `src/styles/zones.css`
- Test: `src/components/GameScreen.test.tsx`, `LifeCounter.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` state + actions.
- Produces: `GameScreen` renders `.zone--N.seat--K` grid classes; seat rotation via CSS (`transform: rotate(180deg)` for far-side seats; 3-player: seats 0,1 top rotated, seat 2 bottom upright; 2-player: seat 0 top rotated; 4-player: quadrants, top two rotated).

Component behavior:
- **LifeCounter:** big number; top-half button `+1`, bottom-half `−1`; long-press (500ms pointer hold) steps ±5; brief CSS class `flash-up`/`flash-down` on change (green/red glow per spec).
- **CommanderDamage** (commander format only): one bubble per *other* player showing their commander damage dealt to this zone's player; tap bubble +1 (delegates to `applyCommanderDamage`), long-press −1.
- **PlayerZone:** avatar+name header, LifeCounter, CommanderDamage strip, BoardStrip placeholder slot (Task 10). `eliminated` → `.zone--dead` class (darkened overlay, per-spec defeated treatment).
- Active player's zone gets `.zone--active` (pulsing border).

- [ ] **Step 1:** Failing tests: GameScreen with a 4-player commander game renders 4 zones with seat classes and 3 commander-damage bubbles per zone; tapping LifeCounter top half calls adjustLife(+1); eliminated player's zone has `zone--dead`; standard-format game renders no CommanderDamage strip.
- [ ] **Step 2:** FAIL → implement → PASS. Manual check at tablet viewport (1280×800) in dev. Commit `feat: game screen with zones, life, commander damage`.

### Task 10: Board strip, card search, card detail, custom tokens

**Files:**
- Create: `src/components/BoardStrip.tsx`, `CardSearch.tsx`, `CardDetail.tsx`, `CustomTokenForm.tsx`
- Test: `src/components/BoardStrip.test.tsx`, `CardSearch.test.tsx`, `CardDetail.test.tsx`

**Interfaces:**
- Consumes: store board actions, `loadNameIndex` + `searchNames`, `getCardById`, `createBoardItem`/`createCustomToken`, `computedPT`, `findGlossaryTerms` + `getGlossary`.

Component behavior:
- **BoardStrip:** horizontal scroll row of item thumbnails; each shows image (or color placeholder for custom), count badge `×N` with inline +/− (wired to changeCount), computed P/T label when present; `+` tile opens CardSearch; tap thumbnail opens CardDetail.
- **CardSearch:** modal with text input; result list from searchNames over the name index (loaded once, cached module-level); quick rows above input: COMMON_TOKENS (hardcoded: Treasure, Clue, Food, Soldier, Zombie, Goblin, Spirit, Thopter, Elemental, Angel, Beast, Saproling) and recently-used (kv `'recentCards'`, cap 12); footer link "Custom token…" → CustomTokenForm. Picking a result → getCardById → createBoardItem → addItem for that zone's player → closes.
- **CardDetail:** full `imageNormal`, name, type line, oracle text where each glossary term found by findGlossaryTerms is a tappable `<button class="term">` opening a definition popover; counter editor (p1p1 stepper labeled "+1/+1", plus "add named counter" with free-text name and stepper); count stepper; "Split stack…" (numeric input, calls splitItem); Remove button.
- **CustomTokenForm:** name, power, toughness (blank allowed → null), 6 color swatches (W/U/B/R/G/C); creates via createCustomToken.

- [ ] **Step 1:** Failing tests: BoardStrip shows ×8 badge and computed 3/3 for a buffed 1/1 with p1p1:2; CardSearch typing "treas" (mocked index) lists "Treasure" and selecting it dispatches addItem; CardDetail renders oracle text with "Flying" as a button when glossary contains Flying, and tapping it shows the definition text; split via UI calls splitItem with entered count.
- [ ] **Step 2:** FAIL → implement → PASS. Manual dev check: add tokens, duplicate, split, counters. Commit `feat: board strip, card search, card detail, custom tokens`.

### Task 11: Center hub, dice, settings, rules viewer

**Files:**
- Create: `src/components/CenterHub.tsx`, `DiceRoller.tsx`, `SettingsSheet.tsx`, `RulesViewer.tsx`
- Test: `src/components/CenterHub.test.tsx`, `RulesViewer.test.tsx`

**Interfaces:**
- Consumes: store (`passTurn`, `endGame`, `game.turnNumber`, active player), `getGlossary`, `searchRules`.
- Produces: settings persisted at kv `'settings'`: `{ backgroundMode: 'all' | 'plains' | 'island' | 'swamp' | 'mountain' | 'forest' | 'off' }`.

Component behavior:
- **CenterHub:** circular hub centered on screen; shows turn number + active player name; "Pass turn" button → passTurn; icons for dice, rules, settings, menu (menu: End game w/ confirm).
- **DiceRoller:** d6/d20/coin + "Who goes first?" (random seat, shows profile name).
- **SettingsSheet:** background mode select; commander damage threshold display (read-only mid-game); "re-download card data" button calling importBulkData.
- **RulesViewer:** full-screen sheet, two tabs. Glossary tab: search box filtering terms (prefix+substring), tap term → definition. Rules tab: search box → searchRules results list (number + text).

- [ ] **Step 1:** Failing tests: CenterHub pass-turn button advances store turn; RulesViewer glossary search "death" (mocked getGlossary with Deathtouch) shows the term and its definition on tap; rules search renders results from mocked searchRules.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: center hub, dice, settings, rules viewer`.

### Task 12: Land backgrounds + image pre-caching + polish

**Files:**
- Create: `src/components/LandBackground.tsx`, `src/data/images.ts`
- Modify: `GameScreen.tsx` (mount background), `SetupGate.tsx` (pre-cache step)
- Test: `src/data/images.test.ts`, `src/components/LandBackground.test.tsx`

**Interfaces:**
- Produces:

```ts
// images.ts
export async function pickLandArtPack(): Promise<string[]>; // from cards table: isBasicLand with imageArtCrop, 10 per type, returns art_crop URLs; persists kv 'landArtPack'
export async function precacheUrls(urls: string[], onProgress?: (done: number, total: number) => void): Promise<void>; // caches.open('img-precache') + sequential add, ignores individual failures, ≤10/sec
export async function precacheCommonTokens(): Promise<void>; // imageNormal of first match per COMMON_TOKENS name
```

- **LandBackground:** fixed full-screen div behind zones; listens to `game.turnNumber` + settings.backgroundMode; on turn change crossfades (two stacked divs, opacity transition 2s) to the next art URL — cycling through land types in WUBRG order when mode 'all', within one type otherwise; heavy dim (`filter: brightness(0.35)`) so zones stay readable; mode 'off' renders plain dark background.
- **SetupGate addition:** after import, run pickLandArtPack + precacheUrls + precacheCommonTokens as a "Preparing artwork…" phase (failures non-fatal — log and continue, art loads lazily later).
- **Polish pass (CSS only):** life flash animations, zone--active pulse, zone--dead darkened cracked overlay, phone-width (~390px) single-zone sanity.

- [ ] **Step 1:** Failing tests: pickLandArtPack with seeded fake db returns ≤10 per type and only art_crop URLs; LandBackground with mode 'off' renders no image; turnNumber bump swaps the visible art URL (mock pack in kv).
- [ ] **Step 2:** FAIL → implement → PASS. Manual dev check of crossfade. Commit `feat: land backgrounds and image pre-caching`.

### Task 13: PWA — manifest, offline, image runtime caching

**Files:**
- Modify: `vite.config.ts` (VitePWA plugin), `index.html`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png` (generate simple life-counter glyph via script or imagemagick)

**Interfaces:**
- Produces: installable PWA; Workbox `runtimeCaching`: `cards.scryfall.io` + `c*.scryfall.com` images → CacheFirst, no max entries/expiry; app shell precached; `registerType: 'autoUpdate'`; manifest name "MTG Companion", `display: 'standalone'`, `orientation: 'any'`, dark `background_color`.

- [ ] **Step 1:** Add VitePWA config; `npm run build` then `npx vite preview`; verify in browser devtools: manifest valid, SW registered, reload offline (devtools offline) still renders app shell.
- [ ] **Step 2:** Run full test suite + build. Commit `feat: PWA install and offline support`.

### Task 14: Final verification + README

**Files:**
- Create: `README.md`

- [ ] **Step 1:** `npx vitest run` (all green) + `npm run build` (clean) + manual end-to-end in preview: setup download (real Scryfall — needs network once), create 2 profiles, start a 4-player commander game (duplicate profiles allowed for testing), life/commander damage/tokens/split/counters/rules lookup/turn pass background change.
- [ ] **Step 2:** README: what it is, first-run setup (needs wifi once, ~150MB), how to install to tablet home screen (Safari/Chrome steps), how to run dev/build, how to refresh card data, where data lives (all on-device), credits (Scryfall, WotC fan-content policy note).
- [ ] **Step 3:** Commit `docs: README`. Final whole-branch review per executing-plans skill.

---

## Self-review notes

- Spec coverage checked: layout/zones (T9), life+flash (T9), commander damage w/ threshold config (T2/T8/T9), board strip+count badge+split (T3/T10), search+fuzzy+offline DB (T4/T5/T10), custom tokens (T3/T10), tappable keywords (T6/T10), rules+glossary viewer (T6/T11), backgrounds+modes (T12), avatars via card art + profiles (T8), dice/first-player (T11), turn tracking (T2/T11), resume after close (T7), PWA offline/install (T13), data refresh (T11 settings), game-feel polish (T9/T12).
- Deferred consciously (spec "out of scope" or later): multi-device sync, rules auto-update check (rules ship with app updates instead — bundled asset avoids WotC CDN CORS), per-profile "remembered commander" quick-add is captured as profile field (T8) with quick re-add via search.
- Type/signature consistency pass done (lib signatures repeated verbatim in consuming tasks).
