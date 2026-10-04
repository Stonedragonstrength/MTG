# MTG Table Companion — Design Spec

**Date:** 2026-10-03
**Status:** Approved (conversationally, section by section)

## Purpose

A companion app for in-person games of Magic: The Gathering, used by one
playgroup. A tablet lies flat in the middle of the table and tracks the
things that are painful to track physically: life totals, commander damage,
tokens, counters, and "what is that card again?" The paper cards on the
table remain the source of truth — entering cards into the app is always
optional (companion model, NOT a full board mirror).

Formats: Commander (40 life, commander damage) and 1v1/standard (20 life).
Platform: Progressive Web App — installed from the browser to the tablet
home screen, fully offline after first-time setup. Phones later get the
same app (single-player view); multi-device sync is a possible future,
not in scope now.

## Core decisions

- **Companion model:** tracking cards is optional; tokens/counters/life are
  the app's job, lands and mana rocks stay in cardboard.
- **Offline-first:** Scryfall bulk card data (~150MB) and the WotC
  Comprehensive Rules (~3MB) download during first-time setup. Card images
  load lazily and are cached permanently; real token images and a ~50-art
  basic-land pack are pre-cached at setup.
- **No server, no accounts:** all state lives on the device. Game state
  persists across accidental app closes.
- **Commander damage:** tracked per enemy commander, separate from life
  (the "two life sources"). Threshold defaults to 21, configurable.
  Commander damage also deducts from life.

## Screen layout

Setup: pick format, pick players (from saved profiles). Screen splits into
zones rotated to face each seat:

- 2 players: top/bottom halves facing opposite ways
- 3 players: two zones on top edge, one on bottom
- 4 players: four quadrants

Each zone: avatar + name, big life total (tap upper half +1 / lower half
−1, long-press ±5, flash on change), commander damage strip (one bubble
per enemy commander; at threshold the zone gets a darkened "defeated"
treatment), and a board strip of card thumbnails with a **+** button.

Center hub (readable by all): turn indicator (tap to pass turn), turn
counter, dice roll / first-player randomizer, Rules button, menu
(new game, settings).

## Card search & tokens

- Search-as-you-type with fuzzy matching over the full offline database.
- **+** opens search with a common-tokens quick row and recently-used row.
- Board items carry a **count badge** (×8 Treasures is one thumbnail with
  +/− on it), with the option to split a stack into separate entries.
- Expanded card view: full art, readable rules text, duplicate, remove,
  counter management. Keywords in rules text are **tappable**, opening the
  glossary definition in place.
- Counters: +1/+1 and arbitrary named counters. Thumbnails display
  **computed** power/toughness (base + counters).
- Custom token creator: name, P/T, color, for house-rule inventions.

## Rules & glossary

Rules button in hub opens: glossary term lookup (instant), full
Comprehensive Rules text search and browse by section. Rules and card
database each offer a one-tap update when a newer version exists and
wifi is available.

## Backgrounds, avatars, game-feel

- Backdrop cycles through downloaded basic-land art, crossfading on turn
  passes, dimmed under the zones. Setting: all five types / one type / off.
- Avatars: pick from the art pack or use any card's art via search.
  Player profiles (name, avatar, remembered commander) persist on device.
- Life changes glow red/green; defeated zones darken rather than vanish;
  active player's zone border pulses on turn change.

## Technical

- **Stack:** React + TypeScript + Vite. IndexedDB (card DB, rules,
  profiles, game state). Service worker for offline + install. Cache API
  for images.
- **Data sources:** Scryfall bulk data "oracle cards" + image CDN (free,
  no key, respect rate limits during pre-cache); WotC Comprehensive Rules
  TXT. Parse glossary from the rules file.
- **Testing:** unit tests on game logic (life/commander damage/elimination,
  counter math, stack split/merge, search ranking) and rules/glossary
  parsing; responsive layout checks at tablet + phone sizes.

## Out of scope (for now)

Multi-device sync, full board mirror, combat simulator, collection/deck
tracking, accounts/cloud anything.
