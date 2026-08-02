// Run once: node generate-vapid.js
// Prints a VAPID keypair. Save both values as environment variables
// on Render (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) — never commit them.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\nVAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('\nSave both. The public key also needs to be pasted into');
console.log('index.html (PUSH_PUBLIC_KEY constant) so the app can subscribe.\n');
