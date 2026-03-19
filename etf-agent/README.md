# ETF Portfolio Agent

Real-time ETF portfolio tracker with automated email alerts via Google Apps Script.

## Features

- Live market data: Nifty 50, Midcap 150, India VIX, Gold, USD/INR
- Deployment trigger monitor (T2: 22,500 · T3: 21,500 · VIX · Oil · PE)
- P&L calculation across all holdings
- Email alerts every 15 minutes via Google Apps Script (free, runs on Google's servers)
- Browser push notifications when triggers fire
- Holdings stored in localStorage (persists across sessions)

## Deploy to GitHub Pages (5 minutes)

1. Fork or create new repo named `etf-portfolio-agent`
2. Upload all files (index.html, css/style.css, js/data.js, js/app.js)
3. Settings → Pages → Source: main branch → / (root)
4. Your URL: `https://YOUR_USERNAME.github.io/etf-portfolio-agent`

## Set Up Email Alerts (Google Apps Script)

1. Go to [script.google.com](https://script.google.com)
2. New project → paste the Apps Script code (click "Copy Apps Script" in the app)
3. Change `ALERT_EMAIL` to your email on line 3
4. Save → Run `testSendEmail` first to verify email works
5. Triggers (clock icon) → Add trigger:
   - Function: `checkPortfolioTriggers`
   - Event source: Time-driven
   - Type: Minutes timer → Every 15 minutes
6. Authorize the permissions → Done

The script runs forever on Google's servers, costs nothing, and sends you emails whenever any trigger fires.

## Update Holdings

When you deploy more capital:
1. Open the app → click "+ Add deployment"
2. Enter ETF name, category, amount (₹L), and your avg buy price
3. If the ETF already exists, it automatically recalculates the weighted average NAV

## Zerodha Kite Connect (optional auto-sync)

```python
pip install kiteconnect
from kiteconnect import KiteConnect

kite = KiteConnect(api_key="YOUR_KEY")
print(kite.login_url())  # Open this, login, copy request_token from URL

session = kite.generate_session("REQUEST_TOKEN", api_secret="YOUR_SECRET")
kite.set_access_token(session["access_token"])

holdings = kite.holdings()  # All ETF + MF positions
print(holdings)
```

Run this once each morning. Then manually update the app's holdings to match.

## Files

```
etf-portfolio-agent/
├── index.html          # Main dashboard
├── css/
│   └── style.css       # Styles
├── js/
│   ├── data.js         # Config, triggers, Apps Script code
│   └── app.js          # Market data fetch, rendering, logic
└── README.md
```
