// ─── STATE ───────────────────────────────────────────────────────────────────
let holdings = JSON.parse(localStorage.getItem('etf_holdings') || 'null') || DEFAULT_HOLDINGS.map(h => ({...h}));
let market = {
  nifty: null, niftyPrev: null,
  midcap: null, midcapPrev: null,
  vix: null,
  gold: null, goldPrev: null,
  inr: null,
  oil: 110,
  niftyPE: 20.26,
};
let triggerStates = JSON.parse(localStorage.getItem('trigger_states') || '{}');


// ─── FETCH HELPERS ────────────────────────────────────────────────────────────
async function fetchYahoo(symbol) {
  const base1 = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
  const base2 = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;


  try {
    const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(base1)}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const wrapper = await r.json();
      if (wrapper.contents) { const result = extractClose(JSON.parse(wrapper.contents)); if (result) return result; }
    }
  } catch(_) {}


  try {
    const r2 = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(base2)}`, { signal: AbortSignal.timeout(8000) });
    if (r2.ok) {
      const wrapper2 = await r2.json();
      if (wrapper2.contents) { const result2 = extractClose(JSON.parse(wrapper2.contents)); if (result2) return result2; }
    }
  } catch(_) {}


  try {
    const r3 = await fetch(`https://thingproxy.freeboard.io/fetch/${base1}`, { signal: AbortSignal.timeout(8000) });
    if (r3.ok) { const result3 = extractClose(await r3.json()); if (result3) return result3; }
  } catch(_) {}


  return null;
}


function extractClose(data) {
  try {
    const result = data.chart.result[0];
    const closes = result.indicators.quote[0].close.filter(v => v !== null && v !== undefined);
    if (closes.length === 0) return null;
    return { cur: closes[closes.length - 1], prev: closes.length > 1 ? closes[closes.length - 2] : closes[0] };
  } catch(_) { return null; }
}


// ─── MARKET DATA FETCH ────────────────────────────────────────────────────────
async function fetchMarketData() {
  setStatus('Fetching live data...');


  const [nifty, midcap, vix, gold, inr] = await Promise.all([
    fetchYahoo('%5ENSEI'),
    fetchYahoo('NIFTYMIDCAP150.NS'),
    fetchYahoo('%5EINDIAVIX'),
    fetchYahoo('GC%3DF'),
    fetchYahoo('USDINR%3DX'),
  ]);

// ─── CLAUDE ADVISOR ───────────────────────────────────────────────────────────
let claudeLastFetch = 0;
const CLAUDE_CACHE_MS = 30 * 60 * 1000; // 30 min cache

function saveGasUrl() {
  const url = document.getElementById('gas-url-input').value.trim();
  if (!url.startsWith('https://script.google.com/macros/')) {
    showToast('Please enter a valid Apps Script Web App URL');
    return;
  }
  localStorage.setItem('gas_advisor_url', url);
  document.getElementById('claude-setup-notice').style.display = 'none';
  showToast('Connected! Fetching Claude recommendations...');
  fetchClaudeAdvice(true);
}

async function fetchClaudeAdvice(force = false) {
  const gasUrl = localStorage.getItem('gas_advisor_url');

  // Show setup notice if no URL configured
  if (!gasUrl) {
    document.getElementById('claude-setup-notice').style.display = 'flex';
    document.getElementById('claude-loading').style.display = 'none';
    return;
  }

  // Use cached result if fresh
  const now = Date.now();
  if (!force && (now - claudeLastFetch) < CLAUDE_CACHE_MS) return;

  // Show loading state
  const recsEl = document.getElementById('claude-recs');
  const btn = document.getElementById('btn-claude-refresh');
  recsEl.innerHTML = '<div class="claude-loading"><span class="spinner"></span><span>Analysing market data &amp; news with Claude...</span></div>';
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Thinking...'; }

  try {
    const payload = {
      market: {
        nifty: market.nifty,
        niftyPrev: market.niftyPrev,
        midcap: market.midcap,
        vix: market.vix,
        gold: market.gold,
        inr: market.inr,
        oil: market.oil,
        niftyPE: market.niftyPE
      },
      holdings: holdings.map(h => ({ name: h.name, cat: h.cat, invested: h.invested, avgNav: h.avgNav })),
      triggers: TRIGGER_DEFS.map(t => ({ label: t.label, threshold: t.threshold, alreadyTriggered: t.alreadyTriggered || false }))
    };

    const resp = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Unknown error');

    claudeLastFetch = Date.now();

    // Render news
    if (data.news && data.news.length > 0) {
      renderNews(data.news);
    }

    // Render recommendations
    renderClaudeRecs(data.recommendations);

    // Update timestamp
    const ts = document.getElementById('claude-timestamp');
    if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  } catch(err) {
    recsEl.innerHTML = '<div class="claude-error">⚠ Failed to fetch recommendations: ' + err.message + '. Check your Apps Script URL and try again.</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Ask Claude'; }
  }
}

function renderNews(newsItems) {
  const newsEl = document.getElementById('news-items');
  if (!newsEl) return;
  newsEl.innerHTML = newsItems.map((item, i) =>
    '<div class="news-item"><span class="news-item-num">' + (i + 1) + '.</span><span>' + item + '</span></div>'
  ).join('');
}

function renderClaudeRecs(text) {
  const recsEl = document.getElementById('claude-recs');
  if (!recsEl) return;

  // Parse the structured output from Claude
  const blocks = text.split(/\n(?=\d+\.)/).filter(b => b.trim());
  if (blocks.length === 0) {
    recsEl.innerHTML = '<div class="claude-error">No recommendations parsed. Raw response: ' + text.substring(0, 200) + '</div>';
    return;
  }

  let html = '';
  blocks.forEach((block, i) => {
    const actionMatch = block.match(/ACTION:\s*(.+?)(?=\nREASON:|$)/s);
    const reasonMatch = block.match(/REASON:\s*(.+?)(?=\nURGENCY:|$)/s);
    const urgencyMatch = block.match(/URGENCY:\s*(HIGH|MEDIUM|LOW)/i);

    const action = actionMatch ? actionMatch[1].trim() : block.replace(/^\d+\.\s*/, '').split('\n')[0].trim();
    const reason = reasonMatch ? reasonMatch[1].trim() : '';
    const urgency = urgencyMatch ? urgencyMatch[1].toUpperCase() : 'MEDIUM';

    html += '<div class="rec-urgency-' + urgency + '">' +
      '<div class="claude-rec-card">' +
        '<div class="rec-num">0' + (i + 1) + '</div>' +
        '<div class="rec-body">' +
          '<div class="rec-action">' + action + '</div>' +
          (reason ? '<div class="rec-reason">' + reason + '</div>' : '') +
        '</div>' +
        '<div class="rec-urgency-badge">' + urgency + '</div>' +
      '</div>' +
    '</div>';
  });

  html += '<div class="claude-footer"><div class="claude-footer-dot"></div>Generated by Claude Haiku &middot; Based on live Nifty, VIX, Gold + latest market news &middot; Not financial advice</div>';
  recsEl.innerHTML = html;
}
