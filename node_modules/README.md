# PeptideRx Push Server

Backend that fires real push notifications to your and the LT's iPhones,
even when the app is closed. This round is intentionally scoped narrow:
get a test push landing reliably on both phones before wiring the real
dose schedule into it.

## What's in here

| File | Purpose |
|---|---|
| `server.js` | Express server: subscribe, unsubscribe, test-push, schedule (stubbed), and a per-minute cron that checks for due doses |
| `generate-vapid.js` | One-time script to generate your VAPID keypair |
| `sw-push-addition.js` | Code to merge into your existing `sw.js` — handles incoming push + notification tap |
| `client-subscribe-snippet.js` | Code to add to `index.html` — subscribes the device and gives you a "send test push" button |
| `data/` | JSON file storage for subscriptions/schedules (see disk note below) |

## Step 1 — Generate your VAPID keys (do this once, locally)

```bash
npm install
npm run generate-vapid
```

This prints a public and private key. **Save both somewhere safe** —
you'll paste the public one into `index.html` and set both as
environment variables on Render.

## Step 2 — Deploy to Render

1. Push this folder to a new GitHub repo (e.g. `peptiderx-server`) — keep
   it **separate** from your `peptiderx` (GitHub Pages) repo, since this
   one needs an actual Node process, not static hosting.
2. On [render.com](https://render.com) → New → Web Service → connect the repo.
3. Environment: **Node**. Build command: `npm install`. Start command: `npm start`.
4. Add environment variables:
   - `VAPID_PUBLIC_KEY` — from Step 1
   - `VAPID_PRIVATE_KEY` — from Step 1
   - `CONTACT_EMAIL` — `mailto:your-email@example.com` (required by the push spec, not used to contact you)
5. Deploy. Render gives you a URL like `https://peptiderx-server.onrender.com`.
6. Hit `https://peptiderx-server.onrender.com/health` in a browser — you should see `{"ok":true,"users":0,...}`.

### Free tier heads-up (accuracy note, not a sales pitch)

Render's free web services **spin down after ~15 min of no traffic** and
take 30–60 seconds to wake back up on the next request. That's fine for
subscribing/testing, but it means the per-minute cron job **won't run
while the service is asleep** — so a dose scheduled for 9:00 PM might
get missed if nothing has hit the server recently. Two ways to fix that
when we get to the real scheduling round:
- Render's paid tier ($7/mo) keeps it always-on, or
- A free uptime-pinger (e.g. a cron-job.com ping every 10 min) keeps it awake, which itself isn't fully reliable.

Worth deciding once we're past "does push work at all."

Also: the free tier's filesystem is **ephemeral** — a redeploy or a
spin-down/wake cycle can wipe `data/*.json`. Fine for this test phase.
Before relying on it for real schedules, we should either add a Render
persistent disk (small paid add-on) or swap the JSON files for a proper
lightweight DB (SQLite on a persistent disk, or a free-tier Postgres).

## Step 3 — Wire up the app side

1. Open `client-subscribe-snippet.js`, set `PUSH_SERVER_URL` to your
   Render URL and `PUSH_PUBLIC_KEY` to the VAPID public key from Step 1.
2. Paste that code into your `index.html`'s main `<script>` block.
3. Add a button somewhere (Settings screen makes sense):
   ```html
   <button onclick="enablePushNotifications()">Enable Notifications</button>
   <button onclick="sendTestPush()">Send Test Push</button>
   ```
4. Merge `sw-push-addition.js` into your existing `sw.js`.
5. Redeploy the GitHub Pages app.

## Step 4 — Test it, both phones

On each iPhone:
1. Open the app **from the home screen icon** (not Safari directly — push only works from the installed PWA on iOS).
2. Tap **Enable Notifications** → allow when iOS prompts.
3. Tap **Send Test Push**.
4. You should get a real notification within a few seconds, even if you background the app.

If it doesn't arrive: check `/health` on the server to confirm it's
awake, check Safari's console for subscribe errors, and confirm
Settings → Notifications → PeptideRx is allowed on the phone.

## Not included yet (next round)

- Actual dose schedules aren't synced to the server yet — `/api/schedule`
  exists and the cron will fire against whatever's posted there, but
  nothing in the app calls it yet. Once test push is confirmed solid on
  both phones, next step is having the app POST each peptide's schedule
  to `/api/schedule` whenever you add/edit a peptide, converting your
  existing on/off-cycle and titration logic into flat `{peptideName,
  doseLabel, time, units}` entries the cron can check against.
