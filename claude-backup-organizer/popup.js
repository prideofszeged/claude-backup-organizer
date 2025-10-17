
function strIncludes(hay, needle) {
  return (hay || "").toLowerCase().includes((needle || "").toLowerCase());
}

function rank(item, q) {
  const t = [item.title, (item.tags||[]).join(" "), item.notes||""]; // simple OR
  const score = t.reduce((s, f) => s + (strIncludes(f, q) ? 1 : 0), 0);
  const rec = (item.updatedAt || "").slice(0, 10) === new Date().toISOString().slice(0, 10) ? 0.5 : 0;
  return score + rec;
}

async function loadIndex() {
  const { index = [] } = await chrome.storage.local.get(["index"]);
  return index;
}

function viewUrl(id) {
  const path = location.pathname; // e.g., '/popup.html' or '/claude-backup-organizer/popup.html'
  const dir = path.slice(0, path.lastIndexOf('/') + 1); // '/claude-backup-organizer/' or '/'
  const rel = (dir === '/' ? '' : dir.slice(1)) + 'viewer.html?id=' + encodeURIComponent(id);
  return chrome.runtime.getURL(rel);
}

function render(results) {
  const ul = document.getElementById("results");
  ul.innerHTML = "";
  for (const r of results.slice(0, 200)) {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <div class="title">${r.title}</div>
      <div class="meta">${r.updatedAt || ''} • ${r.tags?.map(t=>`<span class="tag">${t}</span>`).join(' ') || ''}</div>
      <textarea class="notes" placeholder="Notes...">${r.notes || ''}</textarea>
      <div class="actions">
        <input class="tagsInput" value="${(r.tags||[]).join(', ')}" placeholder="tag1, tag2" />
        <button class="save" data-id="${r.id}">Save</button>
        <button class="view" data-id="${r.id}">View</button>
        <button class="exportMd" data-id="${r.id}">Export MD</button>
      </div>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll('button.save').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      const item = e.target.closest('.item');
      const tags = item.querySelector('.tagsInput').value.split(',').map(s=>s.trim()).filter(Boolean);
      const notes = item.querySelector('.notes').value;
      const res = await chrome.runtime.sendMessage({ type: 'UPDATE_META', id, payload: { tags, notes } });
      if (res?.ok === false) alert(res.error || 'Failed to save');
    });
  });
  ul.querySelectorAll('button.view').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.dataset.id;
      chrome.tabs.create({ url: viewUrl(id) });
    });
  });
  ul.querySelectorAll('button.exportMd').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      const res = await chrome.runtime.sendMessage({ type: 'EXPORT_CONVERSATION_MD', id });
      if (res?.ok === false) alert(res.error || 'Export failed');
    });
  });
}

async function doSearch(q) {
  const idx = await loadIndex();
  if (!q) return render(idx);
  const ranked = idx
    .map(x => ({ item: x, score: rank(x, q) }))
    .filter(x => x.score > 0)
    .sort((a,b)=>b.score - a.score)
    .map(x => x.item);
  render(ranked);
}

document.getElementById('q').addEventListener('input', (e)=> doSearch(e.target.value));

// Lightweight status and debug helpers
function setStatus(msg, ok=true) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + (ok ? 'ok' : 'err');
  el.style.display = 'block';
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(()=>{ el.style.display='none'; }, 4000);
}

function debugLog(line) {
  const area = document.getElementById('debugLog');
  if (!area) return;
  const ts = new Date().toISOString();
  area.textContent += `[${ts}] ${line}\n`;
  area.scrollTop = area.scrollHeight;
}

// Debug toggle wiring
(async function initDebug(){
  const toggle = document.getElementById('debugToggle');
  const area = document.getElementById('debugLog');
  const clearBtn = document.getElementById('debugClear');
  const saved = localStorage.getItem('popup.debug') === '1';
  if (toggle) toggle.checked = saved;
  if (area) area.style.display = saved ? 'block' : 'none';
  toggle?.addEventListener('change', ()=>{
    const on = !!toggle.checked;
    area.style.display = on ? 'block' : 'none';
    localStorage.setItem('popup.debug', on ? '1' : '0');
  });
  clearBtn?.addEventListener('click', async ()=>{ if (area) area.textContent=''; await chrome.storage.local.set({ debugLog: [] }); });
  // Load persisted debug logs
  try {
    const { debugLog = [] } = await chrome.storage.local.get(['debugLog']);
    for (const e of debugLog) { debugLogFn(e); }
  } catch (_) {}
})();

function debugLogFn(entry){
  const { ts, level, msg } = entry || {};
  debugLog(`[${level||'info'}] ${msg||''}`);
}

chrome.runtime.onMessage.addListener((msg)=>{
  if (msg?.type === 'DEBUG_LOG' && msg.entry) {
    debugLogFn(msg.entry);
  }
});

document.getElementById('syncInc').onclick = async () => {
  debugLog('Sync: incremental start');
  const res = await chrome.runtime.sendMessage({ type: 'SYNC_INCREMENTAL' });
  if (res?.ok === false) { setStatus(res.error || 'Sync failed', false); debugLog('Sync error: ' + (res.error||'unknown')); }
  else { setStatus(`Synced ${res.downloaded}/${res.changed} updates`); debugLog(`Sync ok: total=${res.total} changed=${res.changed} downloaded=${res.downloaded}`); }
  await doSearch(document.getElementById('q').value);
};

document.getElementById('syncFull').onclick = async () => {
  debugLog('Sync: full start');
  const res = await chrome.runtime.sendMessage({ type: 'SYNC_FULL' });
  if (res?.ok === false) { setStatus(res.error || 'Full sync failed', false); debugLog('Full sync error: ' + (res.error||'unknown')); }
  else { setStatus(`Full sync ok: ${res.downloaded}/${res.changed}`); debugLog(`Full sync ok: total=${res.total} changed=${res.changed} downloaded=${res.downloaded}`); }
  await doSearch(document.getElementById('q').value);
};

document.getElementById('syncTest').onclick = async () => {
  debugLog('Test: start');
  const res = await chrome.runtime.sendMessage({ type: 'SYNC_TEST' });
  if (res?.ok === false) { setStatus(res.error || 'Test failed', false); debugLog('Test error: ' + (res.error||'unknown')); return; }
  const sample = (res.sampleTitles||[]).join(', ') || 'n/a';
  setStatus(`Test OK (org ${res.orgId})`);
  debugLog(`Test ok: org=${res.orgId} sample=[${sample}]`);
};

document.getElementById('syncStop').onclick = async () => {
  debugLog('Stop: requested');
  const res = await chrome.runtime.sendMessage({ type: 'SYNC_STOP' });
  if (res?.ok === false) { setStatus(res.error || 'Stop failed', false); debugLog('Stop error: ' + (res.error||'unknown')); }
  else { setStatus('Stopped'); debugLog('Stop ok'); }
};

document.getElementById('openOptions').onclick = () => chrome.runtime.openOptionsPage();

// initial
loadIndex().then(render);

