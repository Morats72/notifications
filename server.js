const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ── CORS (app is served from a different origin — GitHub Pages) ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── VAPID setup ──
// Set these as environment variables on Render — do not hardcode.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'mailto:admin@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars. Run: npm run generate-vapid');
  process.exit(1);
}

webpush.setVapidDetails(CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ── Simple JSON file storage ──
// NOTE: On Render's free tier the filesystem is ephemeral — it resets on
// redeploy or when the service spins down after inactivity. Fine for
// testing. For "don't lose subscriptions ever" reliability, attach a
// Render persistent disk (small paid add-on) and point DATA_DIR at it.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const FIRED_FILE = path.join(DATA_DIR, 'fired-today.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// subscriptions.json shape: { "<userId>": { subscription: {...}, label: "Walter" } }
// schedules.json shape:     { "<userId>": [ { peptideName, doseLabel, time: "HH:MM", units } ] }
// fired-today.json shape:   { "<dateStr>": ["<userId>:<peptideName>:<time>", ...] }

// ── Routes ──

app.get('/health', (req, res) => {
  const subs = readJSON(SUBS_FILE, {});
  res.json({ ok: true, users: Object.keys(subs).length, time: new Date().toISOString() });
});

// Save/replace a user's push subscription
app.post('/api/subscribe', (req, res) => {
  const { userId, subscription, label } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'userId and subscription required' });
  const subs = readJSON(SUBS_FILE, {});
  subs[userId] = { subscription, label: label || userId };
  writeJSON(SUBS_FILE, subs);
  res.json({ ok: true });
});

// Remove a user's subscription (they toggled notifications off)
app.post('/api/unsubscribe', (req, res) => {
  const { userId } = req.body;
  const subs = readJSON(SUBS_FILE, {});
  delete subs[userId];
  writeJSON(SUBS_FILE, subs);
  res.json({ ok: true });
});

// Store a user's dose schedule (for the cron to check against).
// Kept minimal for now — full app-side sync wiring comes next round.
app.post('/api/schedule', (req, res) => {
  const { userId, schedule } = req.body;
  if (!userId || !Array.isArray(schedule)) return res.status(400).json({ error: 'userId and schedule[] required' });
  const schedules = readJSON(SCHEDULES_FILE, {});
  schedules[userId] = schedule;
  writeJSON(SCHEDULES_FILE, schedules);
  res.json({ ok: true, count: schedule.length });
});

// Fire an immediate test push to a user — this is the one to hit first.
app.post('/api/test-push', async (req, res) => {
  const { userId, title, body } = req.body;
  const subs = readJSON(SUBS_FILE, {});
  const entry = subs[userId];
  if (!entry) return res.status(404).json({ error: 'No subscription for that userId' });

  const payload = JSON.stringify({
    title: title || 'PeptideRx test',
    body: body || 'If you see this, push is working end to end.',
    tag: 'test-push'
  });

  try {
    await webpush.sendNotification(entry.subscription, payload);
    res.json({ ok: true, sent: true });
  } catch (err) {
    console.error('Push failed:', err.statusCode, err.body);
    if (err.statusCode === 410 || err.statusCode === 404) {
      delete subs[userId];
      writeJSON(SUBS_FILE, subs);
    }
    res.status(500).json({ ok: false, error: err.message, statusCode: err.statusCode });
  }
});

// ── Scheduler: checks every minute for doses due right now ──
function todayKey() {
  return new Date().toISOString().split('T')[0];
}
function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function checkAndFireDueDoses() {
  const subs = readJSON(SUBS_FILE, {});
  const schedules = readJSON(SCHEDULES_FILE, {});
  const fired = readJSON(FIRED_FILE, {});
  const today = todayKey();
  const now = nowHHMM();
  fired[today] = fired[today] || [];

  for (const userId of Object.keys(schedules)) {
    const subEntry = subs[userId];
    if (!subEntry) continue;

    for (const dose of schedules[userId]) {
      if (dose.time !== now) continue;
      const fireKey = `${userId}:${dose.peptideName}:${dose.doseLabel || ''}:${dose.time}`;
      if (fired[today].includes(fireKey)) continue;

      const payload = JSON.stringify({
        title: `${dose.peptideName} due`,
        body: dose.units ? `${dose.doseLabel || 'Dose'} — pull to ${dose.units}` : (dose.doseLabel || 'Time to log this dose'),
        tag: fireKey
      });

      try {
        await webpush.sendNotification(subEntry.subscription, payload);
        fired[today].push(fireKey);
      } catch (err) {
        console.error(`Push failed for ${userId}:`, err.statusCode);
        if (err.statusCode === 410 || err.statusCode === 404) {
          delete subs[userId];
          writeJSON(SUBS_FILE, subs);
        }
      }
    }
  }

  // trim fired-today to just today + yesterday so the file doesn't grow forever
  for (const key of Object.keys(fired)) {
    if (key !== today) delete fired[key];
  }
  writeJSON(FIRED_FILE, fired);
}

cron.schedule('* * * * *', () => {
  checkAndFireDueDoses().catch(err => console.error('Scheduler error:', err));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PeptideRx push server listening on ${PORT}`));
