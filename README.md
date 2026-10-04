# MTG Companion

A table companion app for in-person Magic: The Gathering games. A tablet lies
flat in the middle of the table and tracks the stuff that's painful to track
physically — life totals, commander damage, tokens, counters, and "what does
that card do again?" — while your paper cards stay the real game.

## Features

- **Commander & 1v1** — 40 or 20 starting life; per-commander damage tracking
  with a configurable elimination threshold (default 21); 2–4 players in
  zones rotated to face each seat.
- **Full offline card search** — the entire Scryfall card database lives on
  the device; search-as-you-type with fuzzy matching.
- **Token machine** — search any card or token, duplicate stacks with a tap
  (`×8` with +/−), split stacks, add +1/+1 or any named counter. Thumbnails
  show *computed* power/toughness.
- **Custom tokens** — name, P/T, color, for house-rule inventions.
- **Rules & glossary built in** — the Comprehensive Rules, searchable, plus
  tappable keywords in any card's rules text.
- **Land art backgrounds** — the backdrop drifts through real basic-land art
  as turns pass.
- **Player profiles** — names and card-art avatars your group sets up once.
- Games survive the app closing; everything is stored on-device; no accounts.

## First-time setup

1. Open the app in the tablet's browser **while on wifi**.
2. Tap **Download card database** (~150MB, one time). This also loads the
   rules and pre-caches token and land artwork.
3. Add your players (name + avatar).
4. **Install to home screen** so it runs fullscreen:
   - **Safari (iPad):** Share button → *Add to Home Screen*.
   - **Chrome (Android tablet):** ⋮ menu → *Add to Home screen* / *Install app*.

Card images download the first time you view each card and are cached
forever after, so the app gets more offline-capable the more you play.

## Development

```bash
npm install
npm run dev       # dev server
npm test          # vitest suite
npm run build     # typecheck + production build (includes PWA service worker)
npm run preview   # serve the production build
```

### Refreshing data

- **Cards:** in-game ⚙️ Settings → *Re-download card data* (when new sets drop).
- **Rules:** replace `public/rules/comprehensive-rules.txt` with the latest
  TXT from <https://magic.wizards.com/en/rules> and rebuild.

## Credits

- Card data and imagery from [Scryfall](https://scryfall.com). This app is
  not produced or endorsed by Scryfall.
- Magic: The Gathering and the Comprehensive Rules are © Wizards of the
  Coast. This is unofficial Fan Content permitted under the WotC Fan Content
  Policy; not approved or endorsed by Wizards.
