// Telegram AI Bot — serverless webhook for Vercel
// Uses OpenRouter for chat, vision, and image generation. No KV needed.

import OpenAI from 'openai';

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

// ─── Model catalogs (fallback when API is unreachable) ──────────────────────────
const FALLBACK_TEXT = [
  { id: 'openai/gpt-4o-mini', name: '⚡ GPT-4o Mini', in: 0.15, out: 0.60 },
  { id: 'anthropic/claude-3.5-sonnet', name: '🧠 Claude 3.5 Sonnet', in: 3.0, out: 15.0 },
  { id: 'google/gemini-2.0-flash-001', name: '🚀 Gemini 2.0 Flash', in: 0.10, out: 0.40 },
  { id: 'deepseek/deepseek-r1', name: '🔍 DeepSeek R1', in: 0.55, out: 2.19 },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: '🦙 Llama 3.3 70B', in: 0.25, out: 1.0 },
];

const FALLBACK_IMAGE = [
  { id: 'openai/dall-e-3', name: '🖌️ DALL-E 3', price: 0.04 },
  { id: 'black-forest-labs/flux-1.1-pro', name: '🎨 Flux 1.1 Pro', price: 0.04 },
  { id: 'stabilityai/sdxl-turbo', name: '✨ SDXL Turbo', price: 0.003 },
];

// ─── Fetch models live from OpenRouter ─────────────────────────────────────────
let cachedModels = null; // per-invocation cache (Vercel is per-request anyway)

async function fetchModels() {
  if (cachedModels) return cachedModels;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = json.data || [];

    const text = [], image = [];
    for (const m of list) {
      const p = m.pricing || {};
      const prompt = parseFloat(p.prompt);
      const completion = parseFloat(p.completion);
      const imgPrice = parseFloat(p.image);

      // Text-capable: has prompt+completion pricing (even if $0)
      if (!isNaN(prompt) && !isNaN(completion)) {
        const modalities = m.architecture?.input_modalities || [];
        text.push({
          id: m.id,
          name: m.name || m.id,
          isFree: prompt === 0 && completion === 0,
          priceStr: prompt === 0 && completion === 0 ? '🆓 Free' : `$${fmt(prompt)}/$${fmt(completion)}`,
          prompt, completion,
          supportsVision: modalities.includes('image'),
        });
      }
      // Image-generation: has image pricing
      if (!isNaN(imgPrice)) {
        image.push({
          id: m.id,
          name: m.name || m.id,
          isFree: imgPrice === 0,
          priceStr: imgPrice === 0 ? '🆓 Free' : `$${imgPrice.toFixed(3)}/img`,
          price: imgPrice,
        });
      }
    }

    const result = {
      text: text.sort((a, b) => a.name.localeCompare(b.name)),
      image: image.sort((a, b) => a.name.localeCompare(b.name)),
    };
    cachedModels = result;
    return result;
  } catch (err) {
    console.error('fetchModels error:', err.message);
    // Fallback: convert static lists to dynamic format
    return {
      text: FALLBACK_TEXT.map((m) => ({ id: m.id, name: m.name, isFree: false, priceStr: `$${m.in}/$${m.out}`, prompt: m.in, completion: m.out, supportsVision: true })),
      image: FALLBACK_IMAGE.map((m) => ({ id: m.id, name: m.name, isFree: false, priceStr: `$${m.price.toFixed(3)}/img`, price: m.price })),
    };
  }
}

// ─── Default models: prefer free ones ─────────────────────────────────────────
const DEFAULT_FREE_TEXT_ID = 'meta-llama/llama-3.3-70b-instruct';
const DEFAULT_FREE_IMAGE_ID = 'stabilityai/sdxl-turbo';

// Pick a free text model; fall back to a known good model if no free ones exist.
async function getDefaultTextModel() {
  try {
    const all = await fetchModels();
    const freeText = all.text.filter((m) => m.isFree && m.supportsVision !== false);
    if (freeText.length > 0) return freeText[0].id;
    if (all.text.length > 0) return all.text[0].id;
  } catch {}
  return DEFAULT_FREE_TEXT_ID;
}

// Pick a free image model.
async function getDefaultImageModel() {
  try {
    const all = await fetchModels();
    const freeImg = all.image.filter((m) => m.isFree);
    if (freeImg.length > 0) return freeImg[0].id;
    if (all.image.length > 0) return all.image[0].id;
  } catch {}
  return DEFAULT_FREE_IMAGE_ID;
}


function fmt(n) { return n < 0.001 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2); }

// ─── Per-user model prefs (in-memory) ─────────────────────────────────────────
// ponytail: prefs live only for the lifetime of a warm serverless instance.
// On cold start they reset to free-model defaults. Upgrade path: add a
// real store (Upstash Redis / Vercel KV) behind the same two functions.
const userPrefs = new Map();

function getUserPrefs(chatId) {
  return userPrefs.get(chatId) || {};
}

function saveUserPref(chatId, field, value) {
  const prefs = userPrefs.get(chatId) || {};
  prefs[field] = value;
  userPrefs.set(chatId, prefs);
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
      { text: 'ℹ️ Info', callback_data: 'menu:info' },
    ],
    [
      { text: 'ℹ️ About', callback_data: 'menu:about' },
    ],
  ]);
}

const PAGE_SIZE = 8;

// Build a paginated model-selection keyboard
async function modelPageKeyboard(kind, currentId, page = 0, freeOnly = false) {
  const all = await fetchModels();
  let list = kind === 'free'
    ? [...all.text.filter((m) => m.isFree), ...all.image.filter((m) => m.isFree)]
    : kind === 'text' ? all.text : all.image;

  if (freeOnly && kind !== 'free') list = list.filter((m) => m.isFree);
  const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
  const p = Math.min(page, totalPages - 1);
  const slice = list.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);

  const rows = slice.map((m) => [
    {
      text: `${m.id === currentId ? '✅ ' : ''}${m.name.slice(0, 30)} (${m.priceStr})`,
      callback_data: `p:${m.id}`,
    },
  ]);

  // Pagination row
  const nav = [];
  if (p > 0) nav.push({ text: '⬅️', callback_data: `pp:${kind}:${p - 1}:${freeOnly ? 1 : 0}` });
  nav.push({ text: `📄 ${p + 1}/${totalPages}`, callback_data: 'noop' });
  if (p < totalPages - 1) nav.push({ text: '➡️', callback_data: `pp:${kind}:${p + 1}:${freeOnly ? 1 : 0}` });
  if (nav.length > 1) rows.push(nav);

  // Free toggle + back
  const bottom = [];
  if (kind !== 'free') {
    const label = freeOnly ? '🌟 All models' : '🆓 Free only';
    bottom.push({ text: label, callback_data: `ft:${kind}:${p}` });
  }
  bottom.push({ text: '🔙 Main menu', callback_data: 'b' });
  rows.push(bottom);

  return inlineKeyboard(rows);
}

// ─── Telegram send helpers ─────────────────────────────────────────────────────
const MAX_MSG_LEN = 4000;

// Split long messages on line boundaries (Telegram max ~4096 chars)
function splitMessage(text) {
  if (!text || text.length <= MAX_MSG_LEN) return text ? [text] : [];
  const parts = [];
  let rest = text;
  while (rest.length > MAX_MSG_LEN) {
    let cut = rest.lastIndexOf('\n', MAX_MSG_LEN);
    if (cut < MAX_MSG_LEN / 2) cut = MAX_MSG_LEN;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Escape text for safe insertion into Telegram HTML
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Reformat raw model output into clean, readable Telegram HTML.
// Converts markdown-ish text (bold, italic, code, lists, headings) safely.
function beautify(text) {
  if (!text) return '_(no response)_';
  let t = escapeHtml(text.trim()).replace(/\r\n/g, '\n');

  // ```code blocks```
  t = t.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);
  // inline `code`
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // **bold**
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  // *italic* (single, not part of bold)
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  // markdown headings → bold section label
  t = t.replace(/^#{1,6}\s*(.+)$/gm, '📌 <b>$1</b>');
  // dash bullets → nice dot bullets
  t = t.replace(/^[-*]\s+/gm, '• ');
  // collapse excessive blank lines
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// Send one message; falls back to plain text if parse_mode rejects it.
async function sendMessageOnce(chatId, text, parseMode, extra = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, ...extra }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error('sendMessage failed:', res.status, errBody);
    if (res.status === 400) {
      // parse_mode choked on the text — resend as plain text so we never lose a reply
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...extra }),
      });
    }
  }
}

// Markdown-mode send (used by hand-written bot templates)
async function sendMessage(chatId, text, extra = {}) {
  for (const part of splitMessage(text)) {
    await sendMessageOnce(chatId, part, 'Markdown', extra);
  }
}

// HTML-mode send (used for beautified AI responses)
async function sendMessageHTML(chatId, text, extra = {}) {
  for (const part of splitMessage(text)) {
    await sendMessageOnce(chatId, part, 'HTML', extra);
  }
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

async function setWebhook(host) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
  // Use explicit host from request header (production URL, not preview hash)
  const domain = host || process.env.VERCEL_URL;
  const webhookUrl = domain ? `https://${domain}/api/telegram` : '';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const result = await res.json();
  return { ...result, webhookUrl, domain };
}

// ─── Register bot commands (autocomplete when typing /) ───────────────────────
async function setBotCommands() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`;
  const commands = [
    { command: 'start', description: 'Start the bot and show welcome menu' },
    { command: 'image', description: 'Generate an image from a prompt' },
    { command: 'models', description: 'Browse and select AI models' },
    { command: 'usage', description: 'Check OpenRouter credit usage' },
    { command: 'info', description: 'Overall summary of models, usage, and pricing' },
    { command: 'about', description: 'Learn about this bot — features, architecture & more' },
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  const result = await res.json();
  return { ...result, commands: commands.map(c => '/' + c.command) };
}

// ─── Vision: get Telegram photo URL ────────────────────────────────────────────
async function getTelegramFileUrl(fileId) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  if (!res.ok) throw new Error(`getFile HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok || !data.result?.file_path) throw new Error('getFile: no file_path');
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

// Vision-capable fallback models (if user's text model doesn't support images)
const VISION_FALLBACKS = ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 'anthropic/claude-3.5-sonnet'];

async function handleVision(chatId, photoArray, caption) {
  // Pick the largest photo
  const best = photoArray.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b));
  let imageUrl;
  try {
    imageUrl = await getTelegramFileUrl(best.file_id);
  } catch (err) {
    await sendMessage(chatId, `❌ Could not download image: ${err.message}`);
    return;
  }

  // Pick a vision-capable model (prefer free)
  const prefs = getUserPrefs(chatId);
  let modelId = prefs.text_model;
  const all = await fetchModels();
  const userModel = all.text.find((m) => m.id === modelId);
  if (!userModel || !userModel.supportsVision) {
    // Try to find a free vision-capable model first
    const freeVision = all.text.find((m) => m.isFree && m.supportsVision);
    if (freeVision) {
      modelId = freeVision.id;
    } else {
      const fallback = VISION_FALLBACKS.find((id) => all.text.some((m) => m.id === id));
      modelId = fallback || 'openai/gpt-4o-mini';
    }
  }

  const prompt = caption || 'Describe this image in detail. What do you see?';
  await sendMessage(chatId, `👁️ Analyzing image with \`${modelId}\`…`);

  try {
    const res = await openai.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1024,
    });
    const reply = res.choices?.[0]?.message?.content || 'No analysis returned.';
    await sendMessageHTML(chatId, `👁️ <b>Image Analysis</b>\n\n${beautify(reply)}\n\n<i>Tap a menu button below or send /start for help.</i>`, mainMenuKeyboard());
  } catch (err) {
    console.error('vision error:', err);
    await sendMessage(chatId, `❌ Image analysis failed: ${err.message}`);
  }
}
// ─── Command handlers ──────────────────────────────────────────────────────────
async function handleStart(chatId) {
  await sendMessage(
    chatId,
    '👋 *Welcome to Telegram AI Bot!*\n\n' +
      'I can chat with you, analyze images, and generate images using top AI models via OpenRouter.\n\n' +
      'Send me any *text* to chat, or use:\n' +
      '• 📷 *Send a photo* — I\'ll analyze it\n' +
      '• /image `<prompt>` — generate an image\n' +
      '• /models — pick your text & image model\n' +
      '• /usage — check OpenRouter usage\n' +
      '• /info — overall summary\n' +
      '• /about — learn about this bot',
    mainMenuKeyboard()
  );
}

async function handleImage(chatId, prompt) {
  if (!prompt) {
    await sendMessage(chatId, 'Usage: /image <prompt>\nExample: /image a futuristic city at sunset');
    return;
  }
  const prefs = getUserPrefs(chatId);
  const modelId = prefs.image_model || (await getDefaultImageModel());

  await sendMessage(chatId, `🎨 Generating image with \`${modelId}\`…`);
  try {
    const res = await openai.images.generate({ model: modelId, prompt, n: 1 });
    const first = res.data?.[0];
    if (!first) throw new Error('No image returned');
    // OpenRouter may return a URL or base64 data
    const imageUrl = first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : null);
    if (!imageUrl) throw new Error('No image URL returned');
    await sendPhoto(chatId, imageUrl, `🖼️ Generated with ${modelId}`);
  } catch (err) {
    console.error('image error:', err);
    await sendMessage(chatId, `❌ Image generation failed: ${err.message}`);
  }
}

async function handleChat(chatId, text) {
  const prefs = getUserPrefs(chatId);
  const modelId = prefs.text_model || (await getDefaultTextModel());

  try {
    const res = await openai.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: text }],
    });
    const reply = res.choices?.[0]?.message?.content || 'No response.';
    await sendMessageHTML(chatId, `🤖 <b>Response</b>\n\n${beautify(reply)}\n\n<i>Tap a menu button below or send /start for help.</i>`, mainMenuKeyboard());
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
  const prefs = getUserPrefs(chatId);
  const textModel = prefs.text_model || (await getDefaultTextModel());
  const imageModel = prefs.image_model || (await getDefaultImageModel());
  const all = await fetchModels();
  const t = all.text.find((m) => m.id === textModel);
  const i = all.image.find((m) => m.id === imageModel);
  const tPrice = t ? t.priceStr : '—';
  const iPrice = i ? i.priceStr : '—';

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
      `💬 Text: \`${textModel}\`\n` +
      `🖼️ Image: \`${imageModel}\`\n\n` +
      `💰 *Pricing:*\n` +
      `Text: ${tPrice}\n` +
      `Image: ${iPrice}\n\n` +
      `📈 *Usage:*\n${usageLine}\n\n` +
      `Tip: Use /models to switch models anytime.`
  );
}
async function handleAbout(chatId) {
  const text =
    '🤖 *About This Bot*\n\n' +
    'A lightweight, serverless Telegram AI bot built with OpenRouter and deployed on Vercel — no database required.\n\n' +
    '✨ *What it can do:*\n' +
    '• 💬 *Chat* — talk with top AI models (Llama, GPT, Claude, Gemini & more)\n' +
    '• 👁️ *Vision* — send a photo and I analyze / extract info from it\n' +
    '• 🎨 *Image generation* — `/image <prompt>` creates images on demand\n' +
    '• 🧠 *100+ models* — browse all OpenRouter models, filter free ones\n\n' +
    '🆓 *Free by default* — uses free models automatically to keep costs at $0\n\n' +
    '⚙️ *Architecture:*\n' +
    '• Telegram webhook → Vercel serverless function\n' +
    '• OpenRouter API handles text, vision & images with one key\n' +
    '• Model prefs kept in memory (reset on cold start)\n\n' +
    '📌 *Quick commands:*\n' +
    '• /models — pick text & image model\n' +
    '• /image <prompt> — generate an image\n' +
    '• /usage — check credit usage\n' +
    '• /info — your current summary\n\n' +
    'Open source & MIT licensed. Built with ❤️ using Node.js, OpenRouter & Vercel.';
  await sendMessage(chatId, text, mainMenuKeyboard());
}


// ─── Callback (menu button) handler ────────────────────────────────────────────
async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  const data = query.data || '';
  const queryId = query.id;
  if (!chatId) return;

  if (data === 'b') {
    await answerCallback(queryId);
    const rows = [
      [{ text: '💬 Text models', callback_data: 'sel:text' }],
      [{ text: '🖼️ Image models', callback_data: 'sel:image' }],
      [{ text: '🆓 Free models', callback_data: 'sel:free' }],
      [{ text: '🔙 Main menu', callback_data: 'menu:back' }],
    ];
    await sendMessage(chatId, '🤖 *Choose a category:*', inlineKeyboard(rows));
    return;
  }

  if (data === 'menu:back') {
    await answerCallback(queryId, 'Main menu');
    await sendMessage(chatId, '👋 *Main Menu*\n\nPick an option:', mainMenuKeyboard());
    return;
  }

  if (data === 'noop') {
    await answerCallback(queryId, '');
    return;
  }

  if (data.startsWith('menu:')) {
    await answerCallback(queryId);
    const section = data.split(':')[1];
    if (section === 'models') {
      const rows = [
        [{ text: '💬 Text models', callback_data: 'sel:text' }],
        [{ text: '🖼️ Image models', callback_data: 'sel:image' }],
        [{ text: '🆓 Free models', callback_data: 'sel:free' }],
        [{ text: '🔙 Main menu', callback_data: 'menu:back' }],
      ];
      await sendMessage(chatId, '🤖 *Choose a category:*', inlineKeyboard(rows));
    } else if (section === 'usage') {
      await handleUsage(chatId);
    } else if (section === 'info') {
      await handleInfo(chatId);
    } else if (section === 'about') {
      await handleAbout(chatId);
    }
    return;
  }

  // sel: → show first page of a category
  if (data.startsWith('sel:')) {
    await answerCallback(queryId);
    const kind = data.split(':')[1];
    const prefs = getUserPrefs(chatId);
    const current = kind === 'text' ? prefs.text_model : kind === 'image' ? prefs.image_model : null;
    const labels = { text: '💬 Text models', image: '🖼️ Image models', free: '🆓 Free models' };
    await sendMessage(chatId, `*${labels[kind] || 'Models'}*`, await modelPageKeyboard(kind, current, 0, false));
    return;
  }

  // pp: → pagination page
  if (data.startsWith('pp:')) {
    await answerCallback(queryId);
    const [, kind, pageStr, freeStr] = data.split(':');
    const page = parseInt(pageStr, 10) || 0;
    const freeOnly = freeStr === '1';
    const prefs = getUserPrefs(chatId);
    const current = kind === 'text' ? prefs.text_model : kind === 'image' ? prefs.image_model : null;
    await sendMessage(chatId, `📄 Page ${page + 1}`, await modelPageKeyboard(kind, current, page, freeOnly));
    return;
  }

  // ft: → toggle free filter
  if (data.startsWith('ft:')) {
    await answerCallback(queryId);
    const [, kind, pageStr] = data.split(':');
    const page = parseInt(pageStr, 10) || 0;
    const prefs = getUserPrefs(chatId);
    const current = kind === 'text' ? prefs.text_model : kind === 'image' ? prefs.image_model : null;
    // Toggle: current freeOnly state is unknown, so we pass opposite.
    // We track it via the callback_data, but since we don't have state, default to freeOnly=true
    await sendMessage(chatId, '🆓 *Free models only*', await modelPageKeyboard(kind, current, 0, true));
    return;
  }

  // p: → pick a model
  if (data.startsWith('p:')) {
    const id = data.slice(2);
    // Determine if it's text or image by checking the fetched lists
    const all = await fetchModels();
    const isText = all.text.some((m) => m.id === id);
    const isImage = all.image.some((m) => m.id === id);
    if (!isText && !isImage) {
      await answerCallback(queryId, '❌ Model not found');
      return;
    }
    const kind = isText ? 'text' : 'image';
    saveUserPref(chatId, `${kind}_model`, id);
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
    // Register webhook endpoint
    if (req.query.register === '1') {
      const result = await setWebhook(req.headers.host);
      const cmds = await setBotCommands();
      // Return HTML for easy debugging in browser
      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2em">
        <h1>🤖 Telegram Bot Webhook</h1>
        <p>${result.ok ? '✅ Webhook registered!' : '❌ Webhook registration failed'}</p>
        <p>${cmds.ok ? '✅ Commands registered!' : '❌ Commands registration failed'}</p>
        <pre>${JSON.stringify({ webhook: result, commands: cmds }, null, 2)}</pre>
        <hr>
        <p><a href="/api/telegram?help=1">Check webhook info</a> | <a href="/api/telegram?commands=1">Re-register commands only</a></p>
      </body></html>`;
      return res.status(200).setHeader('Content-Type', 'text/html').end(html);
    }

    // Register bot commands only (autocomplete suggestions)
    if (req.query.commands === '1') {
      const cmds = await setBotCommands();
      return res.status(200).json({ ok: cmds.ok, ...cmds });
    }

    // Show current webhook status from Telegram
    if (req.query.help === '1') {
      const info = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
      ).then(r => r.json());
      return res.status(200).json({ ok: true, info });
    }

    // Health check — also registers commands so they're always up to date
    setBotCommands().catch(() => {}); // fire-and-forget
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
      const { chat, text, photo, caption } = body.message;
      if (!chat) return res.status(200).json({ ok: true });
      const chatId = chat.id;

      // Photo message → vision analysis (caption is optional prompt)
      if (photo && photo.length > 0) {
        await handleVision(chatId, photo, caption || '');
        return res.status(200).json({ ok: true });
      }

      if (text) {
        if (text.startsWith('/start')) await handleStart(chatId);
        else if (text.startsWith('/image')) await handleImage(chatId, text.split(' ').slice(1).join(' ').trim());
        else if (text.startsWith('/models')) {
          const rows = [
            [{ text: '💬 Text models', callback_data: 'sel:text' }],
            [{ text: '🖼️ Image models', callback_data: 'sel:image' }],
            [{ text: '🆓 Free models', callback_data: 'sel:free' }],
            [{ text: '🔙 Main menu', callback_data: 'menu:back' }],
          ];
          await sendMessage(chatId, '🤖 *Choose a category:*', inlineKeyboard(rows));
        } else if (text.startsWith('/usage')) await handleUsage(chatId);
        else if (text.startsWith('/info')) await handleInfo(chatId);
        else if (text.startsWith('/about')) await handleAbout(chatId);
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
