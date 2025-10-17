
function mdEscape(s){ return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderHtmlFromMd(md){
  const lines = md.split(/\r?\n/);
  const out = [];
  let inCode = false;
  for (let line of lines){
    if (line.startsWith('```')){
      inCode = !inCode;
      out.push(inCode ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inCode){ out.push(mdEscape(line)); continue; }
    if (line.startsWith('# ')) out.push(`<h1>${mdEscape(line.slice(2))}</h1>`);
    else if (line.startsWith('## ')) out.push(`<h2>${mdEscape(line.slice(3))}</h2>`);
    else if (line.startsWith('### ')) out.push(`<h3>${mdEscape(line.slice(4))}</h3>`);
    else if (line.trim().length===0) out.push('<br/>');
    else out.push(`<p>${mdEscape(line)}</p>`);
  }
  return out.join('\n');
}

function qs(k){ return new URLSearchParams(location.search).get(k); }

(async function init(){
  const id = qs('id');
  if (!id) return;
  document.getElementById('exportMd').onclick = async () => {
    const res = await chrome.runtime.sendMessage({ type: 'EXPORT_CONVERSATION_MD', id });
    if (res?.ok === false) alert(res.error || 'Export failed');
  };

  const { md } = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATION_MD', id });
  document.getElementById('markdown').value = md;
  document.getElementById('rendered').innerHTML = renderHtmlFromMd(md);

  const firstLine = md.split('\n')[0].replace(/^#\s*/, '').trim();
  if (firstLine) document.getElementById('title').textContent = firstLine;

  const mode = document.getElementById('mode');
  mode.addEventListener('change', () => {
    const m = mode.value;
    document.getElementById('markdown').style.display = m==='markdown' ? 'block' : 'none';
    document.getElementById('rendered').style.display = m==='rendered' ? 'block' : 'none';
  });
})();
