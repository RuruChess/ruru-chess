# Ruru Chess

Free, open-source chess database, analysis, and study workspace for Windows 10/11.

**Website:** https://ruruchess.com  
**Latest Release:** https://github.com/RuruChess/ruru-chess/releases/latest

Ruru Chess opens **PGN**, **ChessBase (`.cbh`, `.cbv`)**, and **Scid (`.si4`)** databases directly on your computer — even inside `.7z` or `.zip` archives — and brings Stockfish analysis, PDF chess book conversion, opponent preparation, live shared study, friends & study teams, Watch Live tournaments, tactics, and lessons into one fast standalone Windows app.

## Download & Install

- **Installer (`Ruru-Chess-Setup.exe`)** — standalone Windows installer (bundles Node.js and Electron, no admin rights required). During setup you choose whether to download Stockfish on first launch. No game database is bundled.
- **Portable (`Ruru-Chess-Portable.zip`)** — unzip anywhere and run `Ruru.exe`.
- **Checksums (`SHA256SUMS.txt`)** — SHA-256 verification hashes for every release file.

## Features

- **Databases & Search:** Open `.pgn`, `.cbh` (with comments, variations, symbols, arrows), `.cbv`, and `.si4` without modifying original files. Fast SQLite indexes for millions of games; search by player, Elo, ECO, year, exact position, pawn structure, material balance, or piece maneuvers; duplicate detection and database cleanup.
- **Analysis & Engines:** Multi-line UCI engine analysis (Stockfish, Lc0, Maia), second engine, threat display, evaluation bar, board arrows, full-game blunder check with accuracy & ACPL graph, opening reference tree, novelty finder, and optional 7-piece Syzygy endgame tablebases.
- **PDF Book → Database:** Convert digital PDF chess books (and experimental OCR for scanned pages) into structured, playable databases with variations, commentary, and exercise training mode — 100% locally on your PC.
- **Shared Analysis & Video:** Analyze games live with a link on `play.ruruchess.com` — guests join from their browser with no account and see moves, variations, arrows, comments, and your engine in real time. Includes end-to-end encrypted WebRTC voice/camera, chat, and an embedded YouTube/Twitch/Kick video panel inside Ruru (“For everyone” or “Only for me”).
- **Friends & Study Teams:** Optional account (no email or password, 16+) for a permanent friends list and study teams with roles, live presence, chat, direct PGN file sharing with one-click import, and one-click invites to play or analyze together.
- **Opponent Preparation:** Combine local FIDE/OTB databases with public Lichess and Chess.com profiles into one opponent dossier with White/Black scores, Elo chart, and an interactive opening repertoire tree.
- **Watch Live & Play a Friend:** Follow live chess tournaments with real clocks, open any live game for Stockfish analysis or one-click Shared analysis, or challenge a friend by link in any browser.
- **Training & Bots:** Adaptive Glicko-2 tactics trainer with spaced repetition, timed runs, streaks, cycles, and daily puzzle; 50 interactive strategy lessons; 36 endgame lessons & engine drills; and 10 human-like bots (plus optional Maia networks).
- **Languages & Themes:** English and Greek UI, figurine / English / Greek notation, light & dark themes, multi-window or tabbed layout.

## Run from Source

Requires **Node.js 24+** (https://nodejs.org).

```bash
npm install
npm run build
npm start
```

Or double-click `Ruru.cmd` on Windows.

- Local server listens only on `http://127.0.0.1:4747`.
- Development mode with hot reload: `npm run dev` (`http://127.0.0.1:5317`).
- Run tests: `npm test` (`npm run typecheck`, `npm run smoke`, `npm run e2e`).

## Packaging & Website

- **Release package:** `node scripts/make-release.mjs` builds `Ruru-Chess-Setup.exe`, `Ruru-Chess-Portable.zip`, and `SHA256SUMS.txt` into `release/ruru`.
- **Static website:** `node scripts/build-site.mjs --check` builds the English (`/`) and Greek (`/el/`) site into `site/dist`.

## Data Storage

- Databases are stored locally in `Documents\Ruru\*.kbdb` (SQLite) alongside position/opening indexes (`*.pos`, `*.tree`).
- Settings and catalog metadata live in a hidden subfolder inside your databases folder.
- Your original PGN / ChessBase / Scid files are never modified; use **Export PGN** anytime.

## Privacy, Terms & Licenses

- **Privacy Policy:** [PRIVACY.md](PRIVACY.md) (English & Greek)
- **Terms of Use:** [TERMS.md](TERMS.md) (English & Greek)
- **Third-Party Credits & Notices:** [CREDITS.md](CREDITS.md) · [licenses/NOTICES.txt](licenses/NOTICES.txt)

Ruru Chess is licensed under **[GPL-3.0-or-later](LICENSE)**, with components under **[AGPL-3.0](licenses/AGPL-3.0.txt)** from Lichess, provided with no warranty. Ruru Chess is not affiliated with ChessBase GmbH, Lichess, Chess.com, FIDE, YouTube, Twitch, Kick, Stockfish, GitHub, or any other mentioned service; all trademarks belong to their respective owners.
