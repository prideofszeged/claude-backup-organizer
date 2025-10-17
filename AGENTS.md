# Repository Guidelines

## Project Structure & Module Organization
- Extension lives in `claude-backup-organizer/`.
- Core files: `background.js` (sync/export logic), `manifest.json` (permissions, entrypoints).
- UI pairs: `popup.html/js`, `options.html/js`, `viewer.html/js`; shared styles in `styles.css`.
- Assets: `icon128.png`. Backups download to `Downloads/claude-backup/<timestamp>/` at runtime.

## Build, Test, and Development Commands
- No build step; load unpacked in Chromium:
  1) Open `chrome://extensions` → Enable Developer Mode.
  2) Load unpacked → select `claude-backup-organizer/`.
- Quick zip for sharing (PowerShell): `Compress-Archive -Path claude-backup-organizer/* -DestinationPath build.zip`.
- Reload after edits from `chrome://extensions` (click Reload) and retest.

## Coding Style & Naming Conventions
- JavaScript (MV3) with WebExtension APIs; avoid adding dependencies.
- Indentation: 2 spaces; semicolons optional but consistent. Prefer arrow functions for small helpers.
- File naming ties view triplets by base name: `popup.*`, `options.*`, `viewer.*`.
- Runtime message types are UPPER_SNAKE_CASE (e.g., `SYNC_INCREMENTAL`, `EXPORT_INDEX_CSV`).

## Testing Guidelines
- No automated tests yet. Do manual QA:
  - Sync: `Sync` and `Full Sync` complete without errors; new JSON files appear under `Downloads/claude-backup/`.
  - Search: queries match title/tags/notes; ranking seems reasonable.
  - Metadata: editing tags/notes persists and re-renders.
  - Export: JSON/CSV and Markdown exports download and open.
- Use `chrome://extensions` → Inspect views for console errors.

## Commit & Pull Request Guidelines
- Commits: imperative mood; consider Conventional Commits scopes like `background`, `popup`, `options`, `viewer`, `styles`, `manifest`.
- PRs include:
  - Summary of changes and rationale.
  - Screenshots/GIFs for UI changes (popup/options/viewer).
  - Notes on permissions/`manifest.json` updates and manual test steps.
  - Linked issue(s), if any.

## Security & Configuration Tips
- Keep `manifest.json` permissions minimal (`downloads`, `storage`, `host_permissions` only for `https://claude.ai/*`).
- Never hardcode secrets; use `chrome.storage` for local state only.
- Be mindful of rate limits; small delays already exist in `background.js`—preserve them when changing fetch loops.
