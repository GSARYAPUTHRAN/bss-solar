/**
 * Print a fresh VAPID key pair for Web Push.
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * Paste the output into .env.local (and the hosting provider's environment).
 * Generate ONE pair per deployment and keep it: rotating the keys silently
 * invalidates every device's subscription until each user opens the app again
 * (the app then re-subscribes on its own). Never commit the private key.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
