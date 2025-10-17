#+ Claude Backup Organizer

Chromium extension to back up Claude conversations, search them, tag/annotate, preview as Markdown, and export JSON/CSV/Markdown.

## Features
- Incremental/full sync with polite rate limiting and Stop.
- Searchable local index with tags/notes; Markdown viewer.
- Exports: index (JSON/CSV) and per‑conversation Markdown.
- Persistent cache via IndexedDB; in‑UI status and debug log.

## Install (Load Unpacked)
1) Open `chrome://extensions` and enable Developer Mode.
2) Load unpacked → select the repo root (contains `manifest.json`).
3) Pin the extension and open the popup.

## Usage
- Test to verify access → Sync. Use Stop to abort.
- Open Library to edit tags/notes and export JSON/CSV.
- View to preview Markdown; Export MD to save a file.

## Development
- No build step. Edit files in `claude-backup-organizer/` and click Reload in `chrome://extensions`.
- Quick zip: `Compress-Archive -Path claude-backup-organizer/* -DestinationPath build.zip`.

## Permissions
- `downloads`, `storage`, and host access to `https://claude.ai/*`.

## Layout
- `manifest.json` (root) – points to subfolder files.
- `claude-backup-organizer/manifest.json` – MV3 manifest if loading subfolder.
- `background.js` – sync, caching, exports; service worker.
- `popup.html/js`, `options.html/js`, `viewer.html/js`; shared `styles.css`.

See `AGENTS.md` for contributor guidance and project conventions.
