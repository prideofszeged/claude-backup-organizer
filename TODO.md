#+ TODO

## Done
- Root manifest added for load-from-root support.
- Robust viewer links from popup/options.
- Test and Stop sync controls; abortable sync with AbortController.
- Persistent conversation cache via IndexedDB (+ in-memory LRU).
- Service worker download fix: data URLs (no URL.createObjectURL).
- Visible status notifications; toggleable debug panel with persisted logs.
- Polite rate limiting and jitter between API calls/pages/downloads.
- Contributor guide: `AGENTS.md` created.

## Next Up
- Politeness settings UI (Options): configure delays (gap, page, item, error) and save to storage.
- “Clear Cache” actions: clear in-memory and IndexedDB; show cache stats.
- Better backoff on HTTP 429/5xx (exponential with cap, respect Retry-After).
- Import/Export: add bulk Markdown export; progress + cancellation.
- Packaging: script or doc for zipping release builds; Edge/Chrome store prep checklist.

## Backlog / Nice-to-Have
- Optional ESLint/Prettier setup and format script.
- More robust Markdown rendering in viewer (links, lists, code fences).
- Internationalization for UI strings.
- Fault-tolerant resume if service worker restarts mid-sync.
- Optional telemetry switch (local only) to summarize sync counts/durations.
