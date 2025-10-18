
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', event => {
  console.warn('Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

// Handle errors
self.addEventListener('error', event => {
  console.warn('Global error:', event.error);
});

// Polite rate limiting and delays
const RATE = {
  minGapMs: 300,        // minimum gap between any API requests
  jitterMs: 120,        // random jitter added to sleeps
  pageDelayMs: 350,     // delay between conversation list pages
  downloadDelayMs: 300, // delay between per-conversation downloads
  errorDelayMs: 800     // delay after an error before retrying next item
};
let lastRequestAt = 0;
function withJitter(ms) { return ms + Math.floor(Math.random() * RATE.jitterMs); }
async function ensureRate() {
  const now = Date.now();
  const gap = now - lastRequestAt;
  const wait = RATE.minGapMs - gap;
  if (wait > 0) await sleep(withJitter(wait));
  lastRequestAt = Date.now();
}

// Simple global sync state to support stop/abort
const activeSync = { running: false, controller: null, aborted: false };

// Progress broadcasting
async function broadcastProgress(progress) {
  try {
    // Store progress for any new listeners
    await chrome.storage.local.set({ syncProgress: progress });
    
    // Try to send to all extension views
    chrome.runtime.sendMessage({ type: 'SYNC_PROGRESS', progress }).catch(() => {
      // Views might not be open, that's ok
    });
  } catch (_) {
    // Storage might fail, continue anyway
  }
}

// Lightweight in-memory conversation cache (per-session)
const convCache = new Map(); // id -> { updatedAt, data }
function cacheSet(id, updatedAt, data) {
  try {
    convCache.set(id, { updatedAt, data });
    if (convCache.size > 200) {
      const firstKey = convCache.keys().next().value;
      convCache.delete(firstKey);
    }
  } catch (_) { /* ignore */ }
}
function cacheGet(id) {
  return convCache.get(id);
}

// Debug logging: persist and broadcast to views
async function appendDebugEntry(entry) {
  try {
    const { debugLog = [] } = await chrome.storage.local.get(["debugLog"]);
    debugLog.push(entry);
    if (debugLog.length > 300) debugLog.splice(0, debugLog.length - 300);
    await chrome.storage.local.set({ debugLog });
  } catch (_) { /* ignore */ }
}

async function logDebug(level, msg) {
  try {
    const entry = { ts: new Date().toISOString(), level, msg };
    
    // Console logging
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    else console.log(msg);
    
    // Storage logging (wrapped to prevent issues)
    try {
      await appendDebugEntry(entry);
    } catch (storageError) {
      console.warn('Debug storage failed:', storageError);
    }
  } catch (logError) {
    // Fallback to basic console.log if everything else fails
    console.log(`[${level}] ${msg}`);
  }
}

// --- Persistent cache (IndexedDB) ---
let idbDb = null;
async function openDb() {
  if (idbDb) return idbDb;
  idbDb = await new Promise((resolve, reject) => {
    const req = indexedDB.open('claudeCache', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return idbDb;
}

async function dbGetConv(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
  });
}

async function dbPutConv(id, updatedAt, data) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');
    const req = store.put({ id, updatedAt: updatedAt || '', data });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('IndexedDB put failed'));
  });
}

async function dbDeleteConv(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
  });
}

function beginSync() {
  if (activeSync.running) throw new Error("Sync already in progress");
  activeSync.controller = new AbortController();
  activeSync.aborted = false;
  activeSync.running = true;
  return activeSync.controller;
}

function endSync() {
  activeSync.running = false;
  activeSync.aborted = false;
  activeSync.controller = null;
}

async function fetchJSON(url, opts = {}) {
  await ensureRate();
  const res = await fetch(url, { credentials: "include", signal: opts.signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function getOrgId(opts = {}) {
  const orgs = await fetchJSON("https://claude.ai/api/organizations", opts);
  const org = orgs.find(o => (o?.capabilities || []).includes("chat")) || orgs[0];
  if (!org) throw new Error("No Claude org found.");
  return org.uuid || org.id;
}

async function listConversations(orgId, limit = 100, opts = {}) {
  let offset = 0, all = [];
  for (;;) {
    if (opts.signal?.aborted || activeSync.aborted) throw new Error("Aborted");
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`;
    const batch = await fetchJSON(url, opts);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
    await sleep(withJitter(RATE.pageDelayMs));
  }
  return all;
}

async function getConversation(orgId, chatId, opts = {}) {
  const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${chatId}?tree=True&rendering_mode=messages&render_all_tools=true`;
  return fetchJSON(url, opts);
}

async function getIndex() {
  const { index = [], byId = {}, lastSync = null } = await chrome.storage.local.get(["index", "byId", "lastSync"]);
  return { index, byId, lastSync };
}

async function setIndex({ index, byId, lastSync }) {
  await chrome.storage.local.set({ index, byId, lastSync });
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  return {
    downloadDuringSync: false,
    deleteMode: 'local-only', // 'local-only', 'web-confirm', 'web-default'
    showExportReminder: true,
    confirmBulkDeletes: true,
    ...settings
  };
}

async function setSettings(next) {
  const cur = await getSettings();
  const settings = { ...cur, ...next };
  await chrome.storage.local.set({ settings });
  return settings;
}

function normalizeTitle(s) {
  return (s || "untitled").trim() || "untitled";
}

function conversationToMarkdown(conv) {
  const title = normalizeTitle(conv?.name);
  const lines = [`# ${title}`, ""];
  const msgs = conv?.chat_messages || conv?.tree_state?.messages || conv?.messages || [];
  for (const m of msgs) {
    const role = m.sender || m.role || 'assistant';
    const parts = m.content || [];
    const textPart = parts.find(p => p.type === 'text') || parts.find(p => p.text);
    const text = textPart?.text || '';
    lines.push(`## ${role}`);
    if (text) lines.push(text);
    const toolParts = parts.filter(p => p.type && p.type !== 'text');
    for (const tp of toolParts) {
      if (tp.type === 'thinking' && tp.thinking) {
        lines.push(`<details><summary>thinking</summary>\n\n${tp.thinking}\n\n</details>`);
      } else {
        lines.push(`<details><summary>${tp.type}</summary>\n\n${JSON.stringify(tp, null, 2)}\n\n</details>`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  const base64 = btoa(binary);
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

async function downloadBlob(filename, blob, saveAs = false) {
  const url = await blobToDataUrl(blob);
  await chrome.downloads.download({ url, filename, saveAs });
}

async function downloadText(filename, text, mime = 'text/plain', saveAs = false) {
  const blob = new Blob([text], { type: mime });
  await downloadBlob(filename, blob, saveAs);
}

async function incrementalSync() {
  const controller = beginSync();
  try {
    await logDebug('info', 'Sync start (incremental)');
    await broadcastProgress({ 
      phase: 'starting', 
      message: 'Starting incremental sync...', 
      current: 0, 
      total: 0 
    });
    
    const orgId = await getOrgId({ signal: controller.signal });
    await broadcastProgress({ 
      phase: 'fetching', 
      message: 'Fetching conversation list...', 
      current: 0, 
      total: 0 
    });
    
    const all = await listConversations(orgId, 100, { signal: controller.signal });
  const { index, byId } = await getIndex();

  const indexMap = new Map(index.map(x => [x.id, x]));

  const toDownload = [];
  for (const c of all) {
    const id = c.uuid || c.id;
    const updatedAt = c.updated_at || c.updatedAt || c.updated || c.modified_at || c.modifiedAt || null;
    const existing = indexMap.get(id);
    if (!existing || existing.updatedAt !== updatedAt) {
      toDownload.push({ id, updatedAt, name: c.name });
    }
  }

  await broadcastProgress({ 
    phase: 'downloading', 
    message: `Found ${toDownload.length} conversations to sync (${all.length} total)`, 
    current: 0, 
    total: toDownload.length 
  });

  let downloaded = 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const orgIdCached = orgId;

  const settings = await getSettings();
  for (const item of toDownload) {
    try {
      if (controller.signal.aborted || activeSync.aborted) throw new Error("Aborted");
      const full = await getConversation(orgIdCached, item.id, { signal: controller.signal });
      const title = normalizeTitle(full?.name || item.name || item.id);
      if (settings.downloadDuringSync) {
        const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" });
        await downloadBlob(`claude-backup/${stamp}/${title}__${item.id}.json`, blob, false);
      }

      const prev = indexMap.get(item.id);
      const record = {
        id: item.id,
        title,
        updatedAt: item.updatedAt || full?.updated_at || full?.updatedAt || null,
        tags: prev?.tags || [],
        notes: prev?.notes || "",
        folder: prev?.folder || 'Inbox'
      };
      indexMap.set(item.id, record);
      cacheSet(item.id, record.updatedAt, full);
      try {
        await dbPutConv(item.id, record.updatedAt, full);
      } catch (e) {
        // IndexedDB unavailable - log but continue with in-memory cache
        await logDebug('warn', `IndexedDB cache failed for ${item.id}: ${e.message}. Using in-memory cache only.`);
      }
      downloaded++;
      
      // Broadcast progress every conversation
      await broadcastProgress({ 
        phase: 'downloading', 
        message: `Syncing: ${title}`, 
        current: downloaded, 
        total: toDownload.length,
        currentItem: title
      });
      
      if (downloaded % 10 === 0) { await logDebug('info', `Downloaded ${downloaded}/${toDownload.length}`); }
      await sleep(withJitter(RATE.downloadDelayMs));
    } catch (e) {
      if (String(e?.message).toLowerCase().includes("abort")) {
        await logDebug('warn', 'Sync aborted by user');
        break;
      }
      await logDebug('error', `Failed download ${item.id}: ${e?.message || e}`);
      await sleep(withJitter(RATE.errorDelayMs));
    }
  }

  const newIndex = Array.from(indexMap.values()).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const newById = Object.fromEntries(newIndex.map(r => [r.id, { updatedAt: r.updatedAt }]));
  await setIndex({ index: newIndex, byId: newById, lastSync: new Date().toISOString() });

    const result = { ok: true, total: all.length, changed: toDownload.length, downloaded };
    await logDebug('info', `Sync done: total=${result.total} changed=${result.changed} downloaded=${result.downloaded}`);
    
    await broadcastProgress({ 
      phase: 'completed', 
      message: `Sync completed! ${result.downloaded} conversations synced`, 
      current: result.downloaded, 
      total: result.downloaded,
      completed: true
    });
    
    return result;
  } catch (error) {
    await broadcastProgress({ 
      phase: 'error', 
      message: `Sync failed: ${error.message}`, 
      current: 0, 
      total: 0,
      error: true
    });
    throw error;
  } finally {
    endSync();
    // Update last sync time for stats
    try {
      await chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });
    } catch (_) {}
  }
}

async function fullSync() {
  await chrome.storage.local.set({ byId: {} });
  return incrementalSync();
}

async function updateMeta(id, { tags, notes, folder }) {
  const { index, byId, lastSync } = await getIndex();
  const idx = index.findIndex(x => x.id === id);
  if (idx === -1) throw new Error("Unknown conversation id");
  const prev = index[idx];
  const next = {
    ...prev,
    tags: Array.isArray(tags) ? [...new Set(tags.map(t => t.trim()).filter(Boolean))] : prev.tags,
    notes: typeof notes === "string" ? notes : prev.notes,
    folder: typeof folder === 'string' ? folder : (prev.folder || 'Inbox')
  };
  index[idx] = next;
  await setIndex({ index, byId, lastSync });
  return next;
}

async function deleteConversationFromWeb(orgId, chatId, opts = {}) {
  await ensureRate();
  const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${chatId}`;
  const res = await fetch(url, { 
    method: 'DELETE',
    credentials: "include", 
    signal: opts.signal 
  });
  
  if (!res.ok) {
    if (res.status === 404) {
      // Already deleted or doesn't exist
      return { ok: true, alreadyDeleted: true };
    }
    throw new Error(`${res.status} ${res.statusText}`);
  }
  
  return { ok: true };
}

async function deleteConversation(id, options = {}) {
  const { deleteFromWeb = false } = options;
  
  try {
    // If web deletion is requested, delete from Claude.ai first
    if (deleteFromWeb) {
      const orgId = await getOrgId();
      await deleteConversationFromWeb(orgId, id);
      await logDebug('info', `Deleted conversation ${id} from Claude.ai`);
    }
    
    // Always remove from local storage/cache
    const { index, byId, lastSync } = await getIndex();
    const idx = index.findIndex(x => x.id === id);
    if (idx === -1) throw new Error("Conversation not found");
    
    index.splice(idx, 1);
    delete byId[id];
    convCache.delete(id);

    try {
      await dbDeleteConv(id);
    } catch (e) {
      // IndexedDB unavailable - log but continue
      await logDebug('warn', `IndexedDB delete failed for ${id}: ${e.message}`);
    }
    
    await setIndex({ index, byId, lastSync });
    return { ok: true, deletedFromWeb: deleteFromWeb };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}


async function exportIndex() {
  const data = await chrome.storage.local.get(null);
  const text = JSON.stringify(data, null, 2);
  await downloadText(`claude-backup/index-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, text, 'application/json', true);
  await logDebug('info', 'Exported index JSON');
}

async function exportIndexCsv() {
  const { index = [] } = await chrome.storage.local.get(["index"]);
  const esc = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  const rows = [
    ['id','title','updatedAt','tags','notes'],
    ...index.map(r => [r.id, r.title, r.updatedAt||'', (r.tags||[]).join('|'), (r.notes||'').replace(/\n/g,'\\n')])
  ];
  const csv = rows.map(row => row.map(esc).join(',')).join('\n');
  await downloadText(`claude-backup/index-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
  await logDebug('info', 'Exported index CSV');
  return { ok: true };
}

// Helper function to escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function conversationToRawView(conv) {
  const title = normalizeTitle(conv?.name);
  const msgs = conv?.chat_messages || conv?.tree_state?.messages || conv?.messages || [];

  let html = `<div class="conversation-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="conversation-meta">
      <span>Created: ${new Date(conv?.created_at || '').toLocaleString()}</span>
      <span>Updated: ${new Date(conv?.updated_at || '').toLocaleString()}</span>
      <span>Model: ${escapeHtml(conv?.model || 'Unknown')}</span>
    </div>
  </div>`;
  
  for (const m of msgs) {
    const role = m.sender || m.role || 'assistant';
    const isHuman = role === 'human';
    const parts = m.content || [];
    
    html += `<div class="message ${isHuman ? 'human-message' : 'assistant-message'}">
      <div class="message-header">
        <span class="role-badge ${role}">${isHuman ? 'You' : 'Claude'}</span>
        <span class="timestamp">${new Date(m.created_at || m.updated_at || '').toLocaleString()}</span>
      </div>
      <div class="message-content">`;
    
    // Handle thinking content first (if present)
    const thinkingPart = parts.find(p => p.type === 'thinking');
    if (thinkingPart && thinkingPart.thinking) {
      html += `<details class="thinking-section">
        <summary>🤔 Thinking</summary>
        <div class="thinking-content">${escapeHtml(thinkingPart.thinking).replace(/\n/g, '<br>')}</div>
      </details>`;
    }

    // Handle main text content
    const textPart = parts.find(p => p.type === 'text') || parts.find(p => p.text);
    if (textPart && textPart.text) {
      html += `<div class="message-text">${escapeHtml(textPart.text).replace(/\n/g, '<br>')}</div>`;
    }
    
    // Handle other content types (tools, etc.)
    const otherParts = parts.filter(p => p.type && p.type !== 'text' && p.type !== 'thinking');
    for (const part of otherParts) {
      html += `<details class="tool-section">
        <summary>🔧 ${part.type}</summary>
        <pre class="tool-content">${JSON.stringify(part, null, 2)}</pre>
      </details>`;
    }
    
    html += `</div></div>`;
  }
  
  return html;
}

async function getConversationMarkdown(id) {
  const conv = await getConversationCached(id);
  return conversationToMarkdown(conv);
}

async function getConversationRawView(id) {
  const conv = await getConversationCached(id);
  return conversationToRawView(conv);
}

async function exportConversationMd(id) {
  const md = await getConversationMarkdown(id);
  const { index = [] } = await chrome.storage.local.get(["index"]);
  const meta = index.find(x => x.id === id);
  const name = (meta?.title || id).replace(/[^\/\w\-]+/g,'_').slice(0,80);
  await downloadText(`claude-backup/markdown/${name}.md`, md, 'text/markdown');
  return { ok: true };
}

async function getConversationCached(id, opts = {}) {
  const { index = [] } = await chrome.storage.local.get(["index"]);
  const meta = index.find(x => x.id === id);
  const cached = cacheGet(id);
  if (cached && (!meta || cached.updatedAt === meta.updatedAt)) {
    return cached.data;
  }
  // Try persistent cache
  try {
    const p = await dbGetConv(id);
    if (p && (!meta || p.updatedAt === meta.updatedAt)) {
      cacheSet(id, p.updatedAt, p.data);
      return p.data;
    }
  } catch (e) {
    // IndexedDB unavailable - log and fallback to fetch
    await logDebug('warn', `IndexedDB read failed for ${id}: ${e.message}. Fetching from Claude.ai...`);
  }

  // Fetch fresh and update caches
  const orgId = await getOrgId(opts);
  const conv = await getConversation(orgId, id, opts);
  const updatedAt = conv?.updated_at || conv?.updatedAt || meta?.updatedAt || null;
  cacheSet(id, updatedAt, conv);
  try {
    await dbPutConv(id, updatedAt, conv);
  } catch (e) {
    // IndexedDB unavailable - log but continue with in-memory cache
    await logDebug('warn', `IndexedDB put failed for ${id}: ${e.message}. Using in-memory cache only.`);
  }
  return conv;
}

// Lightweight test that hits minimal endpoints and avoids downloads
async function testSync() {
  try {
    const orgId = await getOrgId();
    const sample = await listConversations(orgId, 5);
    const titles = sample.slice(0, 3).map(c => normalizeTitle(c?.name || c?.id));
    await logDebug('info', `Test OK: org=${orgId} count=${sample.length}`);
    return { ok: true, orgId, count: sample.length, sampleTitles: titles };
  } catch (e) {
    await logDebug('error', `Test failed: ${e?.message || e}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

// Window management for pop-out library
async function popOutLibrary() {
  try {
    // Get saved window dimensions or use defaults
    const { windowState = {} } = await chrome.storage.local.get(['windowState']);
    const defaultDimensions = {
      width: 1200,
      height: 800,
      left: 100,
      top: 100
    };
    
    const dimensions = { ...defaultDimensions, ...windowState };
    
    // Create the window with full mode parameter
    const window = await chrome.windows.create({
      url: chrome.runtime.getURL('options.html?mode=full'),
      type: 'popup',
      width: dimensions.width,
      height: dimensions.height,
      left: dimensions.left,
      top: dimensions.top,
      focused: true
    });
    
    await logDebug('info', `Pop-out library opened in window ${window.id}`);
    return { ok: true, windowId: window.id };
  } catch (e) {
    await logDebug('error', `Failed to pop out library: ${e?.message || e}`);
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "SYNC_INCREMENTAL":
        try {
          sendResponse(await incrementalSync());
        } catch (e) {
          await logDebug('error', `Sync error: ${e?.message || e}`);
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        break;
      case "SYNC_FULL":
        try {
          sendResponse(await fullSync());
        } catch (e) {
          await logDebug('error', `Full sync error: ${e?.message || e}`);
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        break;
      case "SYNC_STOP":
        try {
          if (activeSync.controller) {
            activeSync.aborted = true;
            activeSync.controller.abort();
          }
          await logDebug('info', 'Stop requested');
          sendResponse({ ok: true, stopped: true });
        } catch (e) {
          await logDebug('error', `Stop error: ${e?.message || e}`);
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        break;
      case "SYNC_TEST":
        sendResponse(await testSync());
        break;
      case "GET_SETTINGS":
        sendResponse(await getSettings());
        break;
      case "SET_SETTINGS":
        try {
          sendResponse(await setSettings(msg.settings || {}));
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        break;
      case "UPDATE_META":
        try {
          const result = await updateMeta(msg.id, msg.payload || {});
          sendResponse({ ok: true, data: result });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        break;
      case "EXPORT_INDEX":
        await exportIndex();
        sendResponse({ ok: true });
        break;
      case "EXPORT_INDEX_CSV":
        sendResponse(await exportIndexCsv());
        break;
      case "EXPORT_CONVERSATION_MD":
        sendResponse(await exportConversationMd(msg.id));
        break;
      case "GET_CONVERSATION_MD":
        sendResponse({ md: await getConversationMarkdown(msg.id) });
        break;
      case "GET_CONVERSATION_RAW":
        sendResponse({ html: await getConversationRawView(msg.id) });
        break;
      case "DELETE_CONVERSATION":
        sendResponse(await deleteConversation(msg.id, msg.options || {}));
        break;
      case "POP_OUT_LIBRARY":
        try {
          sendResponse(await popOutLibrary());
        } catch (e) {
          await logDebug('error', `Pop out error: ${e?.message || e}`);
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        break;
      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  })().catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

