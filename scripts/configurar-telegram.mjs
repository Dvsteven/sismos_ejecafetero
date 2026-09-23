// Conecta el bot de Telegram con tu sitio. Córrelo una vez después de
// desplegar, con las mismas variables que pusiste en Netlify:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... SITE_URL=https://tu-sitio.netlify.app npm run telegram
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secreto, SITE_URL: sitio } = process.env;
if (!token || !secreto || !sitio) {
  console.error('Faltan TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET o SITE_URL');
  process.exit(1);
}
const api = async (metodo, cuerpo) =>
  (await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })).json();

console.log('Webhook:', await api('setWebhook', {
  url: `${sitio.replace(/\/$/, '')}/api/telegram`,
  secret_token: secreto,
  allowed_updates: ['message'],
  drop_pending_updates: true,
}));
console.log('Comandos:', await api('setMyCommands', {
  commands: [
    { command: 'umbral', description: 'Cambiar la magnitud mínima, ej. /umbral 3' },
    { command: 'stop', description: 'Dejar de recibir avisos' },
  ],
}));
console.log('Descripción:', await api('setMyDescription', {
  description: 'Avisos de sismos en el Eje Cafetero y alrededores, con datos del Servicio Geológico Colombiano.',
}));
