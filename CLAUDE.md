# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Extension Development
- **No build step required** - Edit files directly in `claude-backup-organizer/` and reload
- **Load unpacked**: Open `chrome://extensions` → Enable Developer Mode → Load unpacked → select `claude-backup-organizer/`
- **Reload after changes**: Click "Reload" in `chrome://extensions` after editing files
- **Quick zip build**: `Compress-Archive -Path claude-backup-organizer/* -DestinationPath build.zip` (PowerShell)

### Testing
- **Manual QA only** - No automated test framework
- **Sync testing**: Verify `Sync` and `Full Sync` complete without errors; check `Downloads/claude-backup/` for new JSON files
- **Search testing**: Verify queries match title/tags/notes with reasonable ranking
- **Metadata testing**: Verify editing tags/notes persists and re-renders correctly
- **Export testing**: Verify JSON/CSV and Markdown exports download and open properly
- **Debug console**: Use `chrome://extensions` → Inspect views for console errors

## Architecture Overview

### Core Extension Structure
- **Main extension directory**: `claude-backup-organizer/` contains all extension files
- **Service worker**: `background.js` handles sync logic, caching, and export operations
- **UI components**: Three main interfaces with paired HTML/JS files:
  - `popup.html/js` - Main interface for sync operations
  - `options.html/js` - Library view for searching/editing conversations
  - `viewer.html/js` - Markdown preview for individual conversations
- **Shared styles**: `styles.css` used across all UI components

### Key Technical Components
- **Rate limiting**: Configurable delays in `background.js` with jitter to be polite to Claude.ai API
- **Caching system**: Dual-layer caching with in-memory LRU cache (200 items) and IndexedDB persistence
- **Sync control**: AbortController-based cancellation support for stopping sync operations
- **Message passing**: Runtime messages use UPPER_SNAKE_CASE types (e.g., `SYNC_INCREMENTAL`, `EXPORT_INDEX_CSV`)
- **Data storage**: Conversations cached in IndexedDB; backups download to `Downloads/claude-backup/<timestamp>/`

### Permissions & Security
- **Minimal permissions**: Only `downloads`, `storage`, and `https://claude.ai/*` host access
- **No hardcoded secrets**: Uses `chrome.storage` for local state only
- **Rate limit compliance**: Built-in delays preserve Claude.ai API courtesy

## Code Style & Conventions

### JavaScript Style
- **ES6+ with WebExtension APIs** - No external dependencies
- **Indentation**: 2 spaces; semicolons optional but consistent
- **Functions**: Prefer arrow functions for small helpers
- **Async/await**: Used throughout for API calls and storage operations

### File Naming
- **UI triplets**: Related files share base name (`popup.*`, `options.*`, `viewer.*`)
- **Assets**: Icons and static files in extension root
- **Manifests**: Both root `manifest.json` (for load-from-root) and `claude-backup-organizer/manifest.json`

### Message Types
- **Runtime messages**: UPPER_SNAKE_CASE naming convention
- **Core message types**: `SYNC_INCREMENTAL`, `SYNC_FULL`, `STOP_SYNC`, `EXPORT_INDEX_CSV`, `EXPORT_INDEX_JSON`, `EXPORT_MARKDOWN`

## Development Workflow

### Commit Guidelines
- **Imperative mood**: Use conventional commit format
- **Scopes**: Consider using `background`, `popup`, `options`, `viewer`, `styles`, `manifest`
- **PR requirements**: Include summary, UI screenshots/GIFs, permission notes, manual test steps

### Rate Limiting Considerations
- **Preserve existing delays**: Small delays already exist in `background.js` - maintain them when modifying fetch loops
- **Configurable settings**: Rate limiting parameters are defined in `RATE` object in `background.js`
- **Error handling**: Built-in exponential backoff for HTTP errors