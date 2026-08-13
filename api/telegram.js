// Telegram AI Bot — serverless webhook for Vercel
// Uses OpenRouter for chat + image generation, Vercel KV for per-user model prefs.

import OpenAI from 'openai';
import { kv } from '@vercel/kv';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://vercel.com',
    'X-Title': 'Telegram AI Bot',
  },
});

// ─── Model catalogs ────────────────────────────────────────────────────────────
const TEXT_MODELS = [
  { id: 'openai/gpt-4o-mini', label: '⚡ GPT-4o Mini', in: 0.15, out: 0.60 },
  { id: 'anthropic/claude-3.5-sonnet', label: '🧠 Claude 3.5 Sonnet', in: 3.0, out: 15.0 },
  { id: 'google/gemini-2.0-flash-001', label: '🚀 Gemini 2.0 Flash', in: 0.10, out: 0.40 },
  { id: 'deepseek/deepseek-r1', label: '🔍 DeepSeek R1', in: 0.55, out: 2.19 },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: '🦙 Llama 3.3 70B', in: 0.25, out: 1.0 },
];

const IMAGE_MODELS = [
  { id: 'openai/dall-e-3', label: '🖌️ DALL-E 3', price: 0.04 },
  { id: 'black-forest-labs/flux-1.1-pro', label: '🎨 Flux 1.1 Pro', price: 0.04 },
  { id: 'stabilityai/sdxl-turbo', label: '✨ SDXL Turbo', price: 0.003 },
];

const KV_PREFIX = 'tg:';

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function getUserPrefs(chatId) {
  try {
    const prefs = await kv.hgetall(`${KV_PREFIX}${chatId}`);
    return prefs || {};
  } catch {
    return {};
  }
}

async function saveUserPref(chatId, field, value) {
  try {
    await kv.hset(`${KV_PREFIX}${chatId}`, { [field]: value });
  } catch {}
}

function inlineKeyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function mainMenuKeyboard() {
  return inlineKeyboard([
    [
      { text: '🤖 Models', callback_data: 'menu:models' },
      { text: '📊 Usage', callback_data: 'menu:usage' },
    ],
    [
      { text: '💲 Pricing', callback_data: 'menu:price' },
      { text: 'ℹ️ Info', callback_data: 'menu:info' },
    ],
  ]);
}

function modelKeyboards(kind, currentId) {
  const list = kind === 'text' ? TEXT_MODELS : IMAGE_MODELS;
  const rows = list.map((m) => [
    { text: `${m.id === currentId ? '✅ ' : ''}${m.label}`, callback_data: `pick:${kind}:${m.id}` },
  ]);
  rows.push([{ text: '🔙 Back', callback_data: 'menu:back' }]);
  return inlineKeyboard(rows);
}

function formatPriceText() {
  const lines = TEXT_MODELS.map(
    (m) => `• ${m.label} — \`${m.id}\`\n  In: $${m.in} / 1M · Out: $${m.out} / 1M`
  );
  const img = IMAGE_MODELS.map((m) => `• ${m.label} — \`${m.id}\` — $${m.price}/image`);
  return `💲 *Pricing*\n\n*Text models (USD / 1M tokens):*\n${lines.join('\n')}\n\n*Image models:*\n${img.join('\n')}`;
}
// ─── Telegram send helpers ─────────────────────────────────────────────────────
async function sendMessage(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  });
  if (!res.ok) console.error('sendMessage failed:', res.status, await res.text());
}

async function sendPhoto(chatId, url, caption = '') {
  const api = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: url, caption }),
  });
  if (!res.ok) console.error('sendPhoto failed:', res.status, await res.text());
}

async function answerCallback(callbackQueryId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function setWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
  const webhookUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/telegram`
    : '';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });
  return res.json();
}
// ─── Command handlers ──────────────────────────────────────────────────────────
async function handleStart(chatId) {
  await sendMessage(
    chatId,
    '👋 *Welcome to Telegram AI Bot!*\n\n' +
      'I can chat with you and generate images using top AI models via OpenRouter.\n\n' +
      'Send me any *text* to chat, or use:\n' +
      '• /image `<prompt>` — generate an image\n' +
      '• /models — pick your text & image model\n' +
      '• /usage — check OpenRouter usage\n' +
      '• /price — see model pricing\n' +
      '• /info — overall summary',
    mainMenuKeyboard()
  );
}

async function handleImage(chatId, prompt) {
  if (!prompt) {
    await sendMessage(chatId, 'Usage: /image <prompt>\nExample: /image a futuristic city at sunset');
    return;
  }
  const prefs = await getUserPrefs(chatId);
  const modelId = prefs.image_model || IMAGE_MODELS[1].id;
  const model = IMAGE_MODELS.find((m) => m.id === modelId) || IMAGE_MODELS[1];

  await sendMessage(chatId, `🎨 Generating image with ${model.label}…`);
  try {
    const res = await openai.images.generate({ model: model.id, prompt });
    const imageUrl = res.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL returned');
    await sendPhoto(chatId, imageUrl, `🖼️ Generated with ${model.id}`);
  } catch (err) {
    console.error('image error:', err);
    await sendMessage(chatId, `❌ Image generation failed: ${err.message}`);
  }
}

async function handleChat(chatId, text) {
  const prefs = await getUserPrefs(chatId);
  const modelId = prefs.text_model || TEXT_MODELS[0].id;
  const model = TEXT_MODELS.find((m) => m.id === modelId) || TEXT_MODELS[0];

  try {
    const res = await openai.chat.completions.create({
      model: model.id,
      messages: [{ role: 'user', content: text }],
    });
    const reply = res.choices?.[0]?.message?.content || 'No response.';
    await sendMessage(chatId, reply, mainMenuKeyboard());
  } catch (err) {
    console.error('chat error:', err);
    await sendMessage(chatId, `❌ Chat failed: ${err.message}`);
  }
}

async function handleUsage(chatId) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const d = data?.data || {};
    const used = d.usage ?? 0;
    const limit = d.limit ?? 0;
    const plan = d.is_free_tier ? 'Free' : 'Paid';
    const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));

    await sendMessage(
      chatId,
      `📊 *OpenRouter Usage*\n\nUsed: $${used.toFixed(4)}\nLimit: $${limit.toFixed(4)}\nPlan: ${plan}\nProgress: ${bar} ${pct}%`
    );
  } catch (err) {
    console.error('usage error:', err);
    await sendMessage(chatId, `❌ Could not fetch usage: ${err.message}`);
  }
}

async function handleInfo(chatId) {
  const prefs = await getUserPrefs(chatId);
  const textModel = prefs.text_model || TEXT_MODELS[0].id;
  const imageModel = prefs.image_model || IMAGE_MODELS[1].id;
  const t = TEXT_MODELS.find((m) => m.id === textModel) || TEXT_MODELS[0];
  const i = IMAGE_MODELS.find((m) => m.id === imageModel) || IMAGE_MODELS[1];

  let usageLine = '—';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    const data = await res.json();
    const d = data?.data || {};
    usageLine = `Spent: $${(d.usage ?? 0).toFixed(4)}\nLimit: $${(d.limit ?? 0).toFixed(4)}`;
  } catch {}

  await sendMessage(
    chatId,
    `📊 *Overall Summary*\n\n` +
      `🤖 *Active Models:*\n` +
      `💬 Text: \`${t.id}\`\n` +
      `🖼️ Image: \`${i.id}\`\n\n` +
      `💰 *Pricing:*\n` +
      `Text: $${t.in} / 1M in, $${t.out} / 1M out\n` +
      `Image: $${i.price} per image\n\n` +
      `📈 *Usage:*\n${usageLine}\n\n` +
      `Tip: Use /models to switch models anytime.`
  );
}
// ─── Callback (menu button) handler ────────────────────────────────────────────
async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  const data = query.data || '';
  const queryId = query.id;
  if (!chatId) return;

  if (data === 'menu:back') {
    await answerCallback(queryId, 'Main menu');
    await sendMessage(chatId, '👋 *Main Menu*\n\nPick an option:', mainMenuKeyboard());
    return;
  }

  if (data.startsWith('menu:')) {
    await answerCallback(queryId);
    const section = data.split(':')[1];
    if (section === 'models') {
      const rows = [
        [{ text: '💬 Text model', callback_data: 'sel:text' }],
        [{ text: '🖼️ Image model', callback_data: 'sel:image' }],
        [{ text: '🔙 Back', callback_data: 'menu:back' }],
      ];
      await sendMessage(chatId, '🤖 *Choose a category:*', inlineKeyboard(rows));
    } else if (section === 'usage') {
      await handleUsage(chatId);
    } else if (section === 'price') {
      await sendMessage(chatId, formatPriceText(), mainMenuKeyboard());
    } else if (section === 'info') {
      await handleInfo(chatId);
    }
    return;
  }

  if (data.startsWith('sel:')) {
    await answerCallback(queryId);
    const kind = data.split(':')[1];
    const prefs = await getUserPrefs(chatId);
    const current = kind === 'text' ? prefs.text_model : prefs.image_model;
    const title = kind === 'text' ? '💬 *Select your text model:*' : '🖼️ *Select your image model:*';
    await sendMessage(chatId, title, modelKeyboards(kind, current));
    return;
  }

  if (data.startsWith('pick:')) {
    const [, kind, id] = data.split(':');
    const valid =
      (kind === 'text' && TEXT_MODELS.some((m) => m.id === id)) ||
      (kind === 'image' && IMAGE_MODELS.some((m) => m.id === id));
    if (!valid) return;
    await saveUserPref(chatId, `${kind}_model`, id);
    await answerCallback(queryId, `✅ ${kind === 'text' ? 'Text' : 'Image'} model set!`);
    await sendMessage(
      chatId,
      `✅ Model saved!\n${kind === 'text' ? '💬 Text' : '🖼️ Image'} model → \`${id}\``,
      mainMenuKeyboard()
    );
    return;
  }
}

// ─── Webhook entrypoint ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query.register === '1') {
      const result = await setWebhook();
      return res.status(200).json({ ok: true, result });
    }
    return res.status(200).json({ ok: true, status: 'Telegram bot webhook ready' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body || {};
  console.log(JSON.stringify({
    update_id: body.update_id,
    type: body.message ? 'message' : body.callback_query ? 'callback' : 'other',
  }));

  try {
    if (body.message) {
      const { chat, text } = body.message;
      if (!chat) return res.status(200).json({ ok: true });
      const chatId = chat.id;

      if (text) {
        if (text.startsWith('/start')) await handleStart(chatId);
        else if (text.startsWith('/image')) await handleImage(chatId, text.split(' ').slice(1).join(' ').trim());
        else if (text.startsWith('/models')) {
          const rows = [
            [{ text: '💬 Text model', callback_data: 'sel:text' }],
            [{ text: '🖼️ Image model', callback_data: 'sel:image' }],
            [{ text: '🔙 Back', callback_data: 'menu:back' }],
          ];
          await sendMessage(chatId, '🤖 *Choose a category:*', inlineKeyboard(rows));
        } else if (text.startsWith('/usage')) await handleUsage(chatId);
        else if (text.startsWith('/price')) await sendMessage(chatId, formatPriceText(), mainMenuKeyboard());
        else if (text.startsWith('/info')) await handleInfo(chatId);
        else await handleChat(chatId, text);
      }
    } else if (body.callback_query) {
      await handleCallback(body.callback_query);
    }
  } catch (err) {
    console.error('handler error:', err);
  }

  return res.status(200).json({ ok: true });
}
