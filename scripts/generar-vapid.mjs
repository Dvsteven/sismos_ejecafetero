// Genera el par de llaves VAPID para Web Push. Córrelo una sola vez y pega
// los valores en Netlify > Site configuration > Environment variables.
import webpush from 'web-push';
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:tu-correo@ejemplo.com');
