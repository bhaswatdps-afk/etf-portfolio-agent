// ─── STATE ─────────────────────────────────────────────────────────────────
let holdings = JSON.parse(localStorage.getItem('etf_holdings') || 'null') || DEFAULT_HOLDINGS.map(h => ({...h}));

let market = {
  nifty: null, niftyPrev: null,
  midcap: null, midcapPrev: null,
  vix: null,
  gold: null, goldPrev: null,
  inr: null,
  oil: 110,   // manual — no free CORS-safe oil API
  niftyPE: 20.26,
};

let triggerStates = JSON.parse(localStorage.getItem('trigger_states') || '{}');

// ─── FETCH HELPERS ──────────────────────────────────────────────────────────
// Yahoo Finance v8 via allorigins CORS proxy (reliable, free)
const PROXY = 'https://corsproxy.io/?';

async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  try {
    // Try direct first (works from GitHub Pages with certain CORS configs)
    const r = await fetch(url, { mode: 'cors', headers: { 'Accept': 'application/json' } });
    if (r.ok) {
      const d = await r.json();
      return extractClose(d);
    }
  } catch(_) {}
  try {
    // Fallback: corsproxy.io
    const r2 = await fetch(PROXY + encodeURIComponent(url));
    if (r2.ok) {
      const d2 = await r2.json();
      return extractClose(d2);
    }
  } catch(_) {}
  try {
    // Fallback 2: allorigins
    const r3 = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    if (r3.ok) {
      const wrapper = await r3.json();
      const d3 = JSON.parse(wrapper.contents);
      return extractClose(d3);
    }
  } catch(_) {}
  return null;
}

function extractClose(data) {
  try {
    const result = data.chart.result[0];
    const closes = result.indicators.quote[0].close.filter(v => v !== null);
    if (closes.length === 0) return null;
    return {
      cur: closes[closes.length - 1],
      prev: closes.length > 1 ? closes[closes.length - 2] : closes[0],
    };
  } catch(_) { return null; }
}

// ─── MARKET DATA FETCH ──────────────────────────────────────────────────────
async function fetchMarketData() {
  setStatus('Fetching...');

  // Fetch all in parallel
  const [nifty, midcap, vix, gold, inr] = await Promise.all([
    fetchYahoo('^NSEI'),
    fetchYahoo('NIFTYMIDCAP150.NS'),
    fetchYahoo('^INDIAVIX'),
    fetchYahoo('GC=F'),   // Gold futures
    fetchYahoo('USDINR=X'),
  ]);

  if (nifty) {
    market.nifty = nifty.cur;
    market.niftyPrev = nifty.prev;
    updateChip('chip-nifty', 'nifty-val', 'nifty-chg', nifty.cur, nifty.prev, '₹', 0);
  }
  if (midcap) {
    market.midcap = midcap.cur;
    market.midcapPrev = midcap.prev;
    updateChip('chip-midcap', 'mid-val', 'mid-chg', midcap.cur, midcap.prev, '₹', 0);
  }
  if (vix) {
    market.vix = vix.cur;
    document.getElementById('vix-val').textContent = vix.cur.toFixed(2);
    const vixStatus = document.getElementById('vix-status');
    if (vix.cur > 30)       { vixStatus.textContent = 'EXTREME FEAR'; vixStatus.className = 'mc-chg neg'; document.getElementById('chip-vix').className = 'market-chip danger'; }
    else if (vix.cur > 26)  { vixStatus.textContent = 'HIGH FEAR'; vixStatus.className = 'mc-chg amber'; document.getElementById('chip-vix').className = 'market-chip warn'; }
    else if (vix.cur > 20)  { vixStatus.textContent = 'Elevated'; vixStatus.className = 'mc-chg amber'; document.getElementById('chip-vix').className = 'market-chip ok'; }
    else                    { vixStatus.textContent = 'Normal'; vixStatus.className = 'mc-chg pos'; document.getElementById('chip-vix').className = 'market-chip ok'; }
  }
  if (gold) {
    market.gold = gold.cur;
    market.goldPrev = gold.prev;
    updateChip('chip-gold', 'gold-val', 'gold-chg', gold.cur, gold.prev, '$', 0);
  }
  if (inr) {
    market.inr = inr.cur;
    document.getElementById('inr-val').textContent = '₹' + inr.cur.toFixed(2);
    const inrStatus = document.getElementById('inr-status');
    if (inr.cur > 92) { inrStatus.textContent = 'Record low'; inrStatus.className = 'mc-chg neg'; }
    else if (inr.cur > 88) { inrStatus.textContent = 'Weak'; inrStatus.className = 'mc-chg amber'; }
    else { inrStatus.textContent = 'Stable'; inrStatus.className = 'mc-chg pos'; }
  }

  const now = new Date();
  document.getElementById('last-refresh').textContent =
    'Updated ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  renderHoldings();
  renderTriggers();
  checkAndFireAlerts();
}

function updateChip(chipId, valId, chgId, cur, prev, prefix, decimals) {
  const chip = document.getElementById(chipId);
  const valEl = document.getElementById(valId);
  const chgEl = document.getElementById(chgId);
  const chg = cur - prev;
  const pct = (chg / prev * 100);
  valEl.textContent = prefix + cur.toLocaleString('en-IN', { maximumFractionDigits: decimals });
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toLocaleString('en-IN', { maximumFractionDigits: decimals })} (${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
  chgEl.className = 'mc-chg ' + (chg >= 0 ? 'pos' : 'neg');
  chip.className = 'market-chip ok';
}

function setStatus(txt) {
  document.getElementById('last-refresh').textContent = txt;
}

// ─── TRIGGER RENDER ─────────────────────────────────────────────────────────
function renderTriggers() {
  const board = document.getElementById('trigger-board');
  board.innerHTML = '';
  let activeCount = 0;
  let alertMessages = [];

  TRIGGER_DEFS.forEach(t => {
    const metricVal = getMetricVal(t.metric);
    let fired = t.alreadyTriggered;
    let progress = 0;
    let progressColor = '#ffb340';
    let status = 'watching';

    if (t.alreadyTriggered) {
      status = 'fired'; progress = 100; progressColor = '#00e87a';
    } else if (metricVal !== null) {
      if (t.direction === 'below') {
        progress = Math.min(100, Math.max(0, ((t.startRef - metricVal) / (t.startRef - t.threshold)) * 100));
        fired = metricVal < t.threshold;
      } else {
        progress = Math.min(100, (metricVal / t.threshold) * 100);
        fired = metricVal > t.threshold;
      }
      if (fired) { status = 'alert'; progressColor = '#ff4460'; activeCount++; alertMessages.push(t); }
      else if (progress > 70) { progressColor = '#ff4460'; }
      else if (progress > 40) { progressColor = '#ffb340'; }
      else { progressColor = '#4a9eff'; status = 'inactive'; }
    } else {
      status = 'inactive';
    }
    if (t.alreadyTriggered) status = 'fired';

    const curDisplay = metricVal !== null
      ? (t.metric === 'nifty' || t.metric === 'midcap'
          ? '₹' + Math.round(metricVal).toLocaleString('en-IN')
          : t.metric === 'vix'
          ? metricVal.toFixed(1)
          : t.metric === 'oil'
          ? '$' + metricVal
          : t.metric === 'niftyPE'
          ? metricVal.toFixed(1) + 'x'
          : metricVal.toFixed(2))
      : '—';

    const dist = (metricVal !== null && t.metric === 'nifty' && !t.alreadyTriggered)
      ? ` · ${(Math.abs((metricVal - t.threshold) / t.threshold) * 100).toFixed(1)}% from trigger`
      : '';

    const badge = t.alreadyTriggered ? 'DONE ✓'
      : status === 'alert' ? '⚡ ACT NOW'
      : status === 'watching' ? 'WATCHING'
      : `${t.metric === 'niftyPE' ? 'PE ' + (market.niftyPE || '—') + 'x' : '—'}`;

    const badgeClass = t.alreadyTriggered ? 'badge badge-fired'
      : status === 'alert' ? 'badge badge-alert'
      : status === 'watching' ? 'badge badge-watching'
      : 'badge badge-inactive';

    const card = document.createElement('div');
    card.className = `trigger-card tc-status-${status}`;
    card.innerHTML = `
      <div class="tc-tranche">${t.tranche}</div>
      <div class="tc-head">
        <div class="tc-title">${t.label}</div>
        <div class="${badgeClass}">${badge}</div>
      </div>
      <div class="tc-condition">${t.condition}</div>
      <div class="tc-vals">
        <div class="tc-cur" style="color:${status === 'fired' ? 'var(--green)' : status === 'alert' ? 'var(--red)' : 'var(--text)'}">${curDisplay}</div>
        <div class="tc-cur-lbl">${t.metric === 'nifty' ? 'Nifty 50' : t.metric === 'vix' ? 'India VIX' : t.metric === 'oil' ? 'Brent crude' : t.metric === 'niftyPE' ? 'PE ratio' : '—'}</div>
      </div>
      <div class="tc-target-lbl">Threshold: ${t.threshold.toLocaleString('en-IN')}${dist}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${progress}%;background:${progressColor}"></div></div>
      <div class="tc-action">${t.action}</div>
      <button class="tc-copy" onclick="copyTrigger('${t.id}')">⎘ Copy action plan</button>
    `;
    board.appendChild(card);
  });

  // Update summary
  const sEl = document.getElementById('s-triggers');
  const sTxt = document.getElementById('s-trigger-txt');
  if (activeCount > 0) {
    sEl.textContent = activeCount + ' ACTIVE';
    sEl.style.color = 'var(--red)';
    sTxt.textContent = 'Action required — check trigger board';
  } else {
    sEl.textContent = 'Watching';
    sEl.style.color = 'var(--amber)';
    sTxt.textContent = 'No immediate triggers fired';
  }
}

function getMetricVal(metric) {
  if (metric === 'nifty')   return market.nifty;
  if (metric === 'midcap')  return market.midcap;
  if (metric === 'vix')     return market.vix;
  if (metric === 'oil')     return market.oil;
  if (metric === 'niftyPE') return market.niftyPE;
  return null;
}

// ─── CHECK ALERTS (in-browser notification) ─────────────────────────────────
function checkAndFireAlerts() {
  TRIGGER_DEFS.forEach(t => {
    if (t.alreadyTriggered) return;
    const val = getMetricVal(t.metric);
    if (val === null) return;
    const fired = t.direction === 'below' ? val < t.threshold : val > t.threshold;
    if (fired && !triggerStates[t.id + '_fired_today']) {
      triggerStates[t.id + '_fired_today'] = true;
      localStorage.setItem('trigger_states', JSON.stringify(triggerStates));
      showToast(`⚡ ${t.label} — CHECK NOW`);
      // Browser notification if permitted
      if (Notification && Notification.permission === 'granted') {
        new Notification('ETF Portfolio Agent', {
          body: t.label + '\n' + t.action.substring(0, 80) + '...',
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📊</text></svg>'
        });
      }
    }
  });

  // Request notification permission once
  if (Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ─── HOLDINGS RENDER ────────────────────────────────────────────────────────
function renderHoldings() {
  const tbody = document.getElementById('holdings-body');
  tbody.innerHTML = '';
  let totInv = 0, totVal = 0;

  holdings.forEach((h, i) => {
    const units = (h.invested * 100000) / h.avgNav;
    const curPrice = estimatePrice(h);
    const curVal = (units * curPrice) / 100000;
    const pnl = curVal - h.invested;
    const pct = (pnl / h.invested) * 100;
    totInv += h.invested; totVal += curVal;

    const catLabels = { large:'LARGE CAP', mid:'MIDCAP', small:'SMALLCAP', sectoral:'SECTORAL', gold:'GOLD', liquid:'LIQUID', mutual:'MUTUAL FUND' };
    const pClass = pnl >= 0 ? 'pos' : 'neg';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="fund-name">${h.name}</div>
        <div class="fund-ticker">${h.ticker}</div>
        <span class="cat-tag cat-${h.cat}">${catLabels[h.cat] || h.cat.toUpperCase()}</span>
      </td>
      <td class="r">₹${h.avgNav.toFixed(2)}</td>
      <td class="r">${Math.round(units).toLocaleString('en-IN')}</td>
      <td class="r">₹${h.invested.toFixed(2)}L</td>
      <td class="r">₹${curPrice.toFixed(2)}</td>
      <td class="r">₹${curVal.toFixed(2)}L</td>
      <td class="r ${pClass}">${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}L</td>
      <td class="r ${pClass}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</td>
      <td><button class="btn-del" onclick="deleteHolding(${i})" title="Remove">×</button></td>
    `;
    tbody.appendChild(tr);
  });

  const totPnl = totVal - totInv;
  const totPct = (totPnl / totInv) * 100;
  const pc = totPnl >= 0 ? 'pos' : 'neg';
  document.getElementById('tf-invested').textContent = `₹${totInv.toFixed(2)}L`;
  document.getElementById('tf-value').textContent = `₹${totVal.toFixed(2)}L`;
  document.getElementById('tf-pnl').className = 'r ' + pc;
  document.getElementById('tf-pnl').textContent = `${totPnl >= 0 ? '+' : ''}₹${totPnl.toFixed(2)}L`;
  document.getElementById('tf-pct').className = 'r ' + pc;
  document.getElementById('tf-pct').textContent = `${totPct >= 0 ? '+' : ''}${totPct.toFixed(2)}%`;

  document.getElementById('s-invested').textContent = `₹${totInv.toFixed(1)}L`;
  document.getElementById('s-invested-pct').textContent = `${((totInv / CONFIG.CORPUS_LAKHS) * 100).toFixed(1)}% of ₹4cr corpus`;
  document.getElementById('s-curval').textContent = `₹${totVal.toFixed(1)}L`;
  const pnlEl = document.getElementById('s-pnl');
  pnlEl.textContent = `${totPnl >= 0 ? '+' : ''}₹${totPnl.toFixed(2)}L (${totPct >= 0 ? '+' : ''}${totPct.toFixed(2)}%)`;
  pnlEl.className = 'summary-sub ' + pc;
}

function estimatePrice(h) {
  if (!market.nifty || !market.niftyPrev || market.niftyPrev === 0) return h.avgNav;
  const niftyChg = (market.nifty - market.niftyPrev) / market.niftyPrev;
  const beta = { large: 1.0, mutual: 1.0, mid: 1.15, small: 1.3, sectoral: 1.1, gold: 0.2, liquid: 0 };
  return h.avgNav * (1 + niftyChg * (beta[h.cat] || 1.0));
}

// ─── HOLDINGS CRUD ───────────────────────────────────────────────────────────
function addHolding() {
  const name = document.getElementById('inp-name').value.trim();
  const cat  = document.getElementById('inp-cat').value;
  const amt  = parseFloat(document.getElementById('inp-amt').value);
  const nav  = parseFloat(document.getElementById('inp-nav').value);
  if (!name || isNaN(amt) || isNaN(nav) || amt <= 0 || nav <= 0) {
    showToast('Fill all fields with valid numbers');
    return;
  }
  // Check if exists → weighted average
  const idx = holdings.findIndex(h => h.ticker.toLowerCase() === name.toLowerCase() || h.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    const h = holdings[idx];
    const oldUnits = (h.invested * 100000) / h.avgNav;
    const newUnits = (amt * 100000) / nav;
    h.invested += amt;
    h.avgNav = (h.invested * 100000) / (oldUnits + newUnits);
    showToast(`Updated ${name} · Weighted avg NAV: ₹${h.avgNav.toFixed(2)}`);
  } else {
    const id = 'h' + Date.now();
    holdings.push({ id, name, ticker: name, cat, invested: amt, avgNav: nav });
    showToast(`Added ${name}`);
  }
  localStorage.setItem('etf_holdings', JSON.stringify(holdings));
  ['inp-name','inp-amt','inp-nav'].forEach(id => { document.getElementById(id).value = ''; });
  renderHoldings();
}

function deleteHolding(i) {
  if (!confirm(`Remove ${holdings[i].name}?`)) return;
  holdings.splice(i, 1);
  localStorage.setItem('etf_holdings', JSON.stringify(holdings));
  renderHoldings();
  showToast('Removed');
}

function toggleAddPanel() {
  const p = document.getElementById('add-panel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

// ─── APPS SCRIPT ─────────────────────────────────────────────────────────────
function copyScript() {
  navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => showToast('Apps Script code copied — paste into script.google.com'));
}

function copyTrigger(id) {
  const t = TRIGGER_DEFS.find(x => x.id === id);
  if (!t) return;
  const txt = `${t.label}\nCondition: ${t.condition}\nAction: ${t.action}`;
  navigator.clipboard.writeText(txt).then(() => showToast('Action plan copied'));
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── INIT + APPS SCRIPT DISPLAY ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Show Apps Script code in pre block
  const pre = document.getElementById('apps-script-code');
  if (pre) pre.textContent = APPS_SCRIPT_CODE;

  // First render with cached data
  renderHoldings();
  renderTriggers();

  // Fetch live data
  fetchMarketData();

  // Auto-refresh every 5 min
  setInterval(fetchMarketData, CONFIG.REFRESH_INTERVAL_MS);

  // Reset trigger states daily
  const today = new Date().toDateString();
  if (localStorage.getItem('trigger_state_date') !== today) {
    localStorage.setItem('trigger_state_date', today);
    localStorage.setItem('trigger_states', '{}');
    triggerStates = {};
  }
});
