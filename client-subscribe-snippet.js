// ── Add this to index.html, inside the main <script> block ──
// Wire a button in Settings to call enablePushNotifications(). This is
// the ONLY new piece needed on the app side for this round — schedule
// syncing to the server comes next once test pushes are confirmed working.

const PUSH_SERVER_URL = 'https://YOUR-APP-NAME.onrender.com'; // set after Render deploy
const PUSH_PUBLIC_KEY = 'VAPID_PUBLIC_KEY=BBp2xFZROQn-5tPprE_hkwEvJa_WZxMPwivxTqIE7eWZsclVirK4o2bmuaMQFJ41fW5HPrc-TyTMkZ6i01oE7Zg';        // from generate-vapid.js output

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Give each device/person a stable id — reuse whatever profile/user id
// scheme the app already has, or fall back to a random one stored locally.
function getUserId() {
  let id = localStorage.getItem('prx_userId');
  if (!id) {
    id = 'user_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('prx_userId', id);
  }
  return id;
}

async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Push not supported on this browser');
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast('Notification permission denied');
    return false;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_KEY)
    });
  }
  const userId = getUserId();
  await fetch(PUSH_SERVER_URL + '/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, subscription: sub, label: userId })
  });
  toast('Notifications enabled');
  return true;
}

async function sendTestPush() {
  const userId = getUserId();
  const res = await fetch(PUSH_SERVER_URL + '/api/test-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, title: 'PeptideRx test', body: 'Push is working.' })
  });
  const data = await res.json();
  toast(data.ok ? 'Test push sent — check your phone' : 'Test push failed: ' + data.error);
}
