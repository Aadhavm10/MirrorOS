# Google Routes API Setup — Guaranteed $0

The commute widget uses Google's Routes API for traffic-aware drive times.
Google requires a billing account (card on file), but a **daily quota cap**
makes overage charges structurally impossible. Follow every step — the quota
cap is the part that guarantees $0.

## 1. Create a project

1. Go to https://console.cloud.google.com
2. Top bar → project dropdown → **New Project** → name it `mirroros` → Create

## 2. Enable the Routes API

1. In the search bar, type **Routes API** → select it → **Enable**
   (This is the newer API — not "Directions API", which is legacy.)

## 3. Set up billing

1. Left menu → **Billing** → link a billing account → add your card
2. Free tier: 10,000 Routes API "Essentials" calls/month. MirrorOS uses
   ~120/day ≈ 3,600/month — well under, even before the cap below.

## 4. Create and restrict an API key

1. **APIs & Services → Credentials → Create Credentials → API key**
2. Click the new key to edit it:
   - **API restrictions** → Restrict key → check only **Routes API**
   - Leave application restrictions off (the key is server-side only,
     it never reaches the browser)
3. Copy the key into `.env` as `GOOGLE_MAPS_API_KEY=...`

## 5. Set the daily quota cap (the $0 guarantee)

1. **APIs & Services → Routes API → Quotas & System Limits**
2. Find **Compute Routes requests per day** (per project)
3. Click the edit (pencil) icon → set the limit to **300**
4. Confirm

With this cap, even a runaway bug polling in a tight loop stops dead at 300
requests — which is inside the monthly free tier no matter what. Requests past
the cap fail with an error; MirrorOS logs the failure and keeps showing the
last cached commute time. Nothing can bill.

## 6. Configure MirrorOS

In `.env`:

```
GOOGLE_MAPS_API_KEY=AIza...
COMMUTE_ORIGIN=123 Home St, Richardson, TX 75080
COMMUTE_DEST=456 Work Ave, Dallas, TX 75201
COMMUTE_DEPART=07:30
COMMUTE_LABEL=Work
MOCK_COMMUTE=0
```

Plain addresses work — Google geocodes them. `COMMUTE_DEPART` is the
"leaving at" time for the second number; `COMMUTE_LABEL` is what the mirror
shows ("Work", "School", etc.).

Restart the server. The widget appears in **morning mode only** and shows:

```
Work    24 min now    31 min at 07:30
```

## Quota math

- Polls every 5 minutes, but **only between 5am and 10am** (the morning
  window — outside it the widget is hidden, so the source returns its cache
  without calling Google)
- 5 hours × 12 polls/hour × 2 requests (leave-now + leave-at) = **120/day**
- Cap: 300/day. Free tier: 10,000/month. Usage: ~3,600/month.
