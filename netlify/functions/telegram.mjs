// Webhook del bot de Telegram. Telegram llama aquí cada vez que alguien le
// escribe al bot. Maneja:
//   /start <clave>  vincula el chat con el registro creado desde la app
//   /stop           deja de enviar avisos a este chat
//   /umbral 3.5     cambia la magnitud mínima desde Telegram
import { tiendaSuscripciones } from './lib/push.mjs';
import { telegram, urlSitio } from './lib/canales.mjs';

const ok = () => new Response('ok');

async function registrosDelChat(chatId) {
  const t = tiendaSuscripciones();
  const { blobs } = await t.list({ prefix: 'tg-' });
  const regs = await Promise.all(blobs.map(async ({ key }) => ({ key, reg: await t.get(key, { type: 'json' }) })));
  return regs.filter(({ reg }) => reg?.destino === chatId);
}

export default async (req) => {
  const secreto = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secreto || req.headers.get('x-telegram-bot-api-secret-token') !== secreto) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text || !msg.chat?.id) return ok();

  const chatId = msg.chat.id;
  const [comando, arg] = msg.text.trim().split(/\s+/, 2);
  const responder = (text) => telegram('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  const t = tiendaSuscripciones();

  if (comando === '/start') {
    const reg = arg?.startsWith('tg-') ? await t.get(arg, { type: 'json' }) : null;
    if (!reg || reg.canal !== 'telegram') {
      const vinculados = await registrosDelChat(chatId);
      await responder(
        vinculados.length
          ? 'Ya recibes avisos de sismos aquí. Escribe /stop para dejar de recibirlos.'
          : `Para recibir avisos, abre la app y elige Telegram:\n${urlSitio() || ''}`,
      );
      return ok();
    }
    // Un chat, un registro: si ya estaba vinculado con otro, se reemplaza.
    for (const { key } of await registrosDelChat(chatId)) if (key !== arg) await t.delete(key);
    await t.setJSON(arg, { ...reg, destino: chatId, confirmado: true, etiqueta: msg.chat.first_name ? `Telegram (${msg.chat.first_name})` : 'Telegram' });
    await responder(
      `Listo. Te avisaré aquí cada sismo en la zona ${reg.minMag > 0 ? `de magnitud ${reg.minMag.toFixed(1)} o más` : 'de cualquier magnitud'}.\n\n` +
        'Comandos:\n/umbral 3 cambia la magnitud mínima\n/stop deja de enviar avisos',
    );
    return ok();
  }

  if (comando === '/stop') {
    const regs = await registrosDelChat(chatId);
    await Promise.all(regs.map(({ key }) => t.delete(key)));
    await responder(regs.length ? 'Listo, ya no recibirás avisos. Vuelve a activarlos desde la app cuando quieras.' : 'No tenías avisos activos.');
    return ok();
  }

  if (comando === '/umbral') {
    const n = Number(String(arg ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 9) {
      await responder('Escribe la magnitud mínima, por ejemplo: /umbral 3');
      return ok();
    }
    const regs = await registrosDelChat(chatId);
    await Promise.all(regs.map(({ key, reg }) => t.setJSON(key, { ...reg, minMag: n })));
    await responder(regs.length ? `Listo, te aviso desde magnitud ${n.toFixed(1)}.` : 'Primero activa los avisos desde la app.');
    return ok();
  }

  await responder('Comandos: /umbral 3 para cambiar la magnitud mínima, /stop para dejar de recibir avisos.');
  return ok();
};

export const config = { path: '/api/telegram', method: 'POST' };
