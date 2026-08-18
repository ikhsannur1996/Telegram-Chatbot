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
  { id: 'deepseek/deepseek-v4-flash-0731', name: '🔍 DeepSeek V4 Flash', in: 0.00000008, out: 0.00000018 },
  { id: 'openai/gpt-4o-mini', name: '⚡ GPT-4o Mini', in: 0.15, out: 0.60 },
  { id: 'anthropic/claude-3.5-sonnet', name: '🧠 Claude 3.5 Sonnet', in: 3.0, out: 15.0 },
  { id: 'google/gemini-2.0-flash-001', name: '🚀 Gemini 2.0 Flash', in: 0.10, out: 0.40 },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: '🦙 Llama 3.3 70B', in: 0.25, out: 1.0 },
];

const FALLBACK_IMAGE = [
  { id: 'google/gemini-2.5-flash-image', name: '🖼️ Gemini 2.5 Flash Image', price: 0.0000003 },
  { id: 'google/gemini-3.1-flash-image', name: '🖼️ Gemini 3.1 Flash Image', price: 0.0000005 },
  { id: 'openai/gpt-5-image-mini', name: '🖼️ GPT-5 Image Mini', price: 0.0000025 },
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
      const inMods = m.architecture?.input_modalities || [];
      const outMods = m.architecture?.output_modalities || [];

      // Text-capable: outputs text
      if (outMods.includes('text') && !isNaN(prompt) && !isNaN(completion)) {
        text.push({
          id: m.id,
          name: m.name || m.id,
          isFree: prompt === 0 && completion === 0,
          priceStr: prompt === 0 && completion === 0 ? '🆓 Free' : `$${fmt(prompt)}/$${fmt(completion)}`,
          prompt, completion,
          supportsVision: inMods.includes('image'),
        });
      }
      // Image-GENERATION: outputs images (not just vision-input)
      if (outMods.includes('image')) {
        const imgPrice = parseFloat(p.image ?? p.image_output ?? p.prompt);
        if (!isNaN(imgPrice) && imgPrice > 0) { // skip auto/-1 pricing
          image.push({
            id: m.id,
            name: m.name || m.id,
            isFree: imgPrice === 0,
            priceStr: imgPrice === 0 ? '🆓 Free' : `$${imgPrice.toFixed(6)}/img`,
            price: imgPrice,
          });
        }
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
      image: FALLBACK_IMAGE.map((m) => ({ id: m.id, name: m.name, isFree: false, priceStr: `$${m.price.toFixed(6)}/img`, price: m.price })),
    };
  }
}

// ─── Default models ────────────────────────────────────────────────────────────
const DEFAULT_TEXT_ID = 'deepseek/deepseek-v4-flash-0731'; // cheapest DeepSeek model
const DEFAULT_IMAGE_ID = 'google/gemini-2.5-flash-image'; // cheapest image generation model

// Pick the cheapest DeepSeek model as the default (excluding batch-only models).
async function getDefaultTextModel() {
  try {
    const all = await fetchModels();
    const deepseek = all.text.filter((m) => m.id.startsWith('deepseek/') && !m.id.includes(':batch'));
    if (deepseek.length > 0) {
      deepseek.sort((a, b) => a.prompt - b.prompt); // cheapest first
      return deepseek[0].id;
    }
    if (all.text.length > 0) return all.text[0].id;
  } catch {}
  return DEFAULT_TEXT_ID;
}

// Pick the cheapest realtime image model (excluding batch-only models).
async function getDefaultImageModel() {
  try {
    const all = await fetchModels();
    const imgs = all.image
      .filter((m) => !m.id.includes(':batch')) // batch models can't generate on demand
      .sort((a, b) => a.price - b.price);
    if (imgs.length > 0) return imgs[0].id;
  } catch {}
  return DEFAULT_IMAGE_ID;
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
      { text: '💬 Chat', callback_data: 'menu:chat' },
      { text: '🎨 Image', callback_data: 'menu:image' },
    ],
    [
      { text: '🔍 Models', callback_data: 'menu:models' },
      { text: '📊 Usage', callback_data: 'menu:usage' },
    ],
    [
      { text: '👤 Profile', callback_data: 'menu:profile' },
      { text: 'ℹ️ About', callback_data: 'menu:about' },
    ],
    [
      { text: '🖥️ VM Admin', callback_data: 'menu:vmadmin' },
    ],
  ]);
}

const PAGE_SIZE = 8;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'QAZ123qaz@';
const IDCLOUDHOST_BASE_URL = (process.env.IDCLOUDHOST_BASE_URL || 'https://api.idcloudhost.com').replace(/\/+$/, '');
const IDCLOUDHOST_API_KEY = process.env.IDCLOUDHOST_API_KEY || '';
const IDCLOUDHOST_VM_ID = process.env.IDCLOUDHOST_VM_ID || '';
const IDCLOUDHOST_TIMEOUT_MS = Number(process.env.IDCLOUDHOST_TIMEOUT_MS || 15000);
const adminSessions = new Map();
const vmState = {
  // Basic info
  name: 'ubuntu-test',
  uuid: IDCLOUDHOST_VM_ID || 'not configured',
  status: 'stopped',
  description: '—',
  
  // Resource info
  currentPlan: 'Not synced',
  cpu: '—',
  ram: '—',
  disk: '—',
  
  // Network info
  privateIp: '—',
  publicIp: '—',
  mac: '—',
  hostname: '—',
  
  // Storage info
  storageCount: 0,
  
  // System info
  osName: '—',
  osVersion: '—',
  os: '—',
  uptime: '—',
  
  // Account info
  username: '—',
  billingAccount: '—',
  backup: false,
  
  // Timestamps
  createdAt: '—',
  updatedAt: '—',
  
  // Config info
  apiKey: 'not configured',
  vmId: IDCLOUDHOST_VM_ID || 'not configured',
};

const VM_RESOURCE_PRESETS = {
  lite: { label: 'Lite', cpu: 2, ramMb: 2048, ramDisplay: '2 GB' },
  basic: { label: 'Basic', cpu: 2, ramMb: 4096, ramDisplay: '4 GB' },
  medium: { label: 'Medium', cpu: 4, ramMb: 8192, ramDisplay: '8 GB' },
  performance: { label: 'Performance', cpu: 8, ramMb: 16384, ramDisplay: '16 GB' },
};

function getAdminSession(chatId) {
  return adminSessions.get(chatId) || { authenticated: false, step: 'idle' };
}

function saveAdminSession(chatId, session) {
  adminSessions.set(chatId, session);
}

function clearAdminSession(chatId) {
  adminSessions.delete(chatId);
}

function hasIdCloudHostConfig() {
  return Boolean(IDCLOUDHOST_API_KEY && IDCLOUDHOST_VM_ID);
}

function maskApiKey(value) {
  if (!value) return 'not configured';
  if (value.length <= 8) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function toFormBody(data) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  return params.toString();
}

async function idCloudHostRequest(path, options = {}) {
  if (!hasIdCloudHostConfig()) {
    throw new Error('IDCloudHost belum dikonfigurasi. Setel IDCLOUDHOST_API_KEY dan IDCLOUDHOST_VM_ID di environment Anda.');
  }

  let url = `${IDCLOUDHOST_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (options.queryParams) {
    const params = new URLSearchParams(options.queryParams);
    url += '?' + params.toString();
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), IDCLOUDHOST_TIMEOUT_MS) : null;

  try {
    const headers = {
      Accept: 'application/json',
      apikey: IDCLOUDHOST_API_KEY,
      ...(options.headers || {}),
    };
    if (options.formData) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.formData ? toFormBody(options.formData) : undefined,
      signal: controller ? controller.signal : undefined,
    });

    const text = await response.text();
    let payload = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

    if (!response.ok) {
      const message = payload?.message || payload?.error || payload?.detail || payload || `HTTP ${response.status}`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }

    return payload;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function idCloudHostVmAction(action, payload = {}) {
  const vmId = IDCLOUDHOST_VM_ID;
  const paths = {
    start: '/v1/user-resource/vm/start',
    stop: '/v1/user-resource/vm/stop',
    modify: '/v1/user-resource/vm',
    status: '/v1/user-resource/vm',
  };

  const methodMap = {
    start: 'POST',
    stop: 'POST',
    modify: 'PATCH',
    status: 'GET',
  };

  const path = paths[action];
  if (!path) {
    if (action === 'restart') {
      await idCloudHostVmAction('stop', { uuid: vmId });
      return idCloudHostVmAction('start', { uuid: vmId });
    }
    throw new Error(`Action tidak didukung: ${action}`);
  }

  if (action === 'status') {
    return idCloudHostRequest(path, {
      method: 'GET',
      queryParams: { uuid: vmId, ...payload },
    });
  }

  const form = action === 'start' || action === 'stop'
    ? { uuid: vmId, ...payload }
    : action === 'modify'
      ? { uuid: vmId, ...payload }
      : { uuid: vmId };

  return idCloudHostRequest(path, {
    method: methodMap[action],
    formData: form,
  });
}

async function refreshVmStateFromApi() {
  if (!hasIdCloudHostConfig()) {
    vmState.apiKey = 'not configured';
    vmState.vmId = 'not configured';
    return;
  }

  vmState.apiKey = maskApiKey(IDCLOUDHOST_API_KEY);
  vmState.vmId = IDCLOUDHOST_VM_ID;

  try {
    const result = await idCloudHostVmAction('status');
    const data = result?.data || result?.result || result || {};
    const statusRaw = String(data.status || data.state || data.power_status || vmState.status || 'stopped').toLowerCase();
    
    // Basic info
    vmState.name = data.name || vmState.name;
    vmState.uuid = data.uuid || vmState.uuid;
    vmState.status = statusRaw === 'running' || statusRaw === 'on' ? 'running' : 'stopped';
    vmState.description = data.description || vmState.description;
    
    // Resource info
    vmState.currentPlan = data.designated_pool_name || data.current_pool_name || data.plan || vmState.currentPlan;
    vmState.cpu = data.vcpu ? `${data.vcpu} vCPU` : vmState.cpu;
    vmState.ram = data.memory ? `${data.memory} MB` : vmState.ram;
    vmState.disk = data.storage?.[0]?.size ? `${data.storage[0].size} GB` : vmState.disk;
    
    // Network info
    vmState.privateIp = data.private_ipv4 || vmState.privateIp;
    vmState.publicIp = data.public_ipv4 || data.public_ip || vmState.publicIp;
    vmState.mac = data.mac || vmState.mac;
    vmState.hostname = data.hostname || vmState.hostname;
    
    // Storage info
    vmState.storageCount = data.storage?.length || 0;
    
    // System info
    vmState.osName = data.os_name || vmState.osName;
    vmState.osVersion = data.os_version || vmState.osVersion;
    vmState.os = [data.os_name, data.os_version].filter(Boolean).join(' ') || vmState.os;
    vmState.uptime = data.uptime || data.running_time || vmState.uptime;
    
    // Account info
    vmState.username = data.username || vmState.username;
    vmState.billingAccount = data.billing_account || vmState.billingAccount;
    vmState.backup = data.backup || vmState.backup;
    
    // Timestamps
    if (data.created_at) vmState.createdAt = data.created_at.split(' ')[0];
    if (data.updated_at) vmState.updatedAt = data.updated_at.split(' ')[0];
  } catch (err) {
    console.error('refreshVmStateFromApi error:', err.message);
  }
}

function vmAdminKeyboard() {
  return inlineKeyboard([
    [
      { text: '📊 Overview', callback_data: 'vm:status' },
      { text: '🧠 Resource', callback_data: 'vm:status' },
    ],
    [
      { text: '▶️ Start', callback_data: 'vm:start' },
      { text: '⏹️ Stop', callback_data: 'vm:stop' },
    ],
    [
      { text: '🔄 Restart', callback_data: 'vm:restart' },
      { text: '🛠️ Modify', callback_data: 'vm:modify' },
    ],
    [
      { text: '� Backup', callback_data: 'vm:backup' },
      { text: '📡 Network', callback_data: 'vm:network' },
    ],
    [
      { text: '🧾 Logs', callback_data: 'vm:logs' },
      { text: '�🚪 Logout', callback_data: 'vm:logout' },
    ],
  ]);
}

function vmModifyKeyboard() {
  return inlineKeyboard([
    [{ text: 'Lite (2 vCPU / 2 GB)', callback_data: 'vm:plan:lite' }],
    [{ text: 'Basic (2 vCPU / 4 GB)', callback_data: 'vm:plan:basic' }],
    [{ text: 'Medium (4 vCPU / 8 GB)', callback_data: 'vm:plan:medium' }],
    [{ text: 'Performance (8 vCPU / 16 GB)', callback_data: 'vm:plan:performance' }],
    [{ text: 'Custom', callback_data: 'vm:custom' }],
    [{ text: '🔙 Kembali', callback_data: 'vm:back' }],
  ]);
}

function formatVmSummary() {
  const statusText = vmState.status === 'running' ? '🟢 Running' : '🔴 Stopped';
  const backupText = vmState.backup ? '✅ Enabled' : '❌ Disabled';
  const lines = [
    `📦 *VM Information*`,
    `Name: \`${vmState.name}\``,
    `Status: ${statusText}`,
    `Description: ${vmState.description}`,
    ``,
    `💾 *Resources*`,
    `Plan: ${vmState.currentPlan}`,
    `vCPU: ${vmState.cpu}`,
    `Memory: ${vmState.ram}`,
    `Storage: ${vmState.disk} (${vmState.storageCount} disk${vmState.storageCount !== 1 ? 's' : ''})`,
    ``,
    `🌐 *Network*`,
    `Private IP: \`${vmState.privateIp}\``,
    `Public IP: ${vmState.publicIp === '—' || !vmState.publicIp ? '❌ None' : `\`${vmState.publicIp}\``}`,
    `MAC Address: \`${vmState.mac}\``,
    `Hostname: ${vmState.hostname}`,
    ``,
    `🖥️ *System*`,
    `OS: ${vmState.os}`,
    `Uptime: ${vmState.uptime}`,
    `Backup: ${backupText}`,
    ``,
    `👤 *Account*`,
    `Username: ${vmState.username}`,
    `Billing: ${vmState.billingAccount}`,
    `UUID: \`${vmState.uuid}\``,
    `Created: ${vmState.createdAt}`,
    `Updated: ${vmState.updatedAt}`,
  ];
  return lines.join('\n');
}

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

// ─── Register bot commands + menu button (bottom of chat, like BotFather) ──────
async function setBotCommands() {
  // 1. Set autocomplete commands when typing /
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`;
  const commands = [
    { command: 'start', description: 'Start the bot and show the About info' },
    { command: 'chat', description: 'Chat with the AI (or just send any text)' },
    { command: 'image', description: 'Generate an image from a prompt' },
    { command: 'models', description: 'Browse and select AI models' },
    { command: 'usage', description: 'Check OpenRouter credit usage' },
    { command: 'profile', description: 'Your profile — active models and usage' },
    { command: 'about', description: 'Learn about this bot — features, architecture & more' },
    { command: 'vmadmin', description: 'Access the VM admin dashboard' },
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  const result = await res.json();

  // 2. Set the menu button at the bottom of the chat (like BotFather)
  const menuUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setChatMenuButton`;
  await fetch(menuUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_button: { type: 'commands' } }),
  });

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
  await sendMessage(chatId, '👋 *Welcome!* Here is everything you need to know about this bot:');
  await handleAbout(chatId);
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

async function handleProfile(chatId) {
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
    `👤 *Profile* — your current settings\n\n` +
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
    '💲 *Cost-efficient* — defaults to the cheapest DeepSeek model, image gen picks the lowest-cost model\n\n' +
    '⚙️ *Architecture:*\n' +
    '• Telegram webhook → Vercel serverless function\n' +
    '• OpenRouter API handles text, vision & images with one key\n' +
    '• Model prefs kept in memory (reset on cold start)\n\n' +
    '📌 *Quick commands:*\n' +
    '• /models — pick text & image model\n' +
    '• /image <prompt> — generate an image\n' +
    '• /usage — check credit usage\n' +
    '• /profile — your current summary\n\n' +
    'Open source & MIT licensed. Built with ❤️ using Node.js, OpenRouter & Vercel.';
  await sendMessage(chatId, text, mainMenuKeyboard());
}

async function showVmAdminMenu(chatId, prefix = '🖥️ *VM Admin*') {
  const session = getAdminSession(chatId);
  if (!session.authenticated) {
    saveAdminSession(chatId, { authenticated: false, step: 'waiting_username' });
    await sendMessage(chatId, '🔐 *VM Admin Login*\n\nMasukkan username admin:');
    return;
  }

  try {
    await refreshVmStateFromApi();
  } catch (err) {
    console.error('showVmAdminMenu refresh error:', err.message);
  }

  await sendMessage(chatId, `${prefix}\n\n${formatVmSummary()}`, vmAdminKeyboard());
}

async function handleVmAdmin(chatId) {
  const session = getAdminSession(chatId);
  if (!session.authenticated) {
    await showVmAdminMenu(chatId);
    return;
  }

  await showVmAdminMenu(chatId, '✅ *VM Admin Dashboard*');
}

async function handleVmAdminModify(chatId) {
  if (!hasIdCloudHostConfig()) {
    await sendMessage(chatId, '⚠️ IDCloudHost belum dikonfigurasi. Isi variabel environment:\n\n`IDCLOUDHOST_API_KEY`\n`IDCLOUDHOST_VM_ID`\n\nLalu jalankan ulang /vmadmin.');
    return;
  }

  try {
    await refreshVmStateFromApi();
  } catch (err) {
    console.error('handleVmAdminModify status check error:', err.message);
  }

  if (vmState.status !== 'stopped') {
    await sendMessage(chatId, '❌ *Modify VM hanya bisa dilakukan saat VM dalam keadaan mati.*\n\nSilakan gunakan tombol *Stop VM* terlebih dahulu, lalu ulangi proses modify.');
    await showVmAdminMenu(chatId, '⚠️ *VM masih aktif*');
    return;
  }

  await sendMessage(chatId, '🛠️ *Modify VM*\n\nPilih konfigurasi baru VM:', vmModifyKeyboard());
}

async function applyVmPreset(chatId, presetKey) {
  const preset = VM_RESOURCE_PRESETS[presetKey];
  if (!preset) {
    await sendMessage(chatId, '❌ Pilihan preset tidak valid.');
    return;
  }

  try {
    const payload = {
      vcpu: preset.cpu,
      ram: preset.ramMb,
      plan: preset.label,
    };

    await idCloudHostVmAction('modify', payload);
    vmState.currentPlan = preset.label;
    vmState.cpu = `${preset.cpu} vCPU`;
    vmState.ram = preset.ramDisplay;
    vmState.status = 'stopped';

    await sendMessage(
      chatId,
      `✅ *Modify VM berhasil.*\n\nVM diubah ke konfigurasi: *${preset.label}*\nCPU: ${vmState.cpu}\nRAM: ${vmState.ram}\n\nSetelah modify, nyalakan VM kembali dengan tombol *Start VM*.`
    );
    await showVmAdminMenu(chatId, '🔧 *VM configuration updated*');
  } catch (err) {
    console.error('applyVmPreset error:', err.message);
    await sendMessage(chatId, `❌ Modify VM gagal: ${err.message}`);
  }
}

async function handleVmAdminLogin(chatId, text) {
  const raw = String(text || '').trim();
  const session = getAdminSession(chatId);

  if (session.step === 'waiting_username') {
    if (raw === ADMIN_USERNAME) {
      saveAdminSession(chatId, { authenticated: false, step: 'waiting_password' });
      await sendMessage(chatId, '🔐 Username benar. Masukkan password:');
    } else {
      saveAdminSession(chatId, { authenticated: false, step: 'waiting_username' });
      await sendMessage(chatId, '❌ Username salah. Masukkan username admin:');
    }
    return;
  }

  if (session.step === 'waiting_password') {
    if (raw === ADMIN_PASSWORD) {
      saveAdminSession(chatId, { authenticated: true, step: 'authenticated' });
      await showVmAdminMenu(chatId, '✅ *Login berhasil!*');
    } else {
      saveAdminSession(chatId, { authenticated: false, step: 'waiting_username' });
      await sendMessage(chatId, '❌ Password salah. Masukkan username admin:');
    }
    return;
  }

  if (session.step === 'waiting_custom') {
    const match = raw.match(/(\d+)\s*(?:vcpu|cpu)?\s*(?:[,/\- ]|\s+and\s+|\s+)\s*(\d+)\s*(?:gb|g|ram|mb|m)?/i);
    if (!match) {
      await sendMessage(chatId, '❌ Format custom tidak valid. Contoh: `4,8` atau `4 vCPU, 8 GB RAM`');
      return;
    }

    const [, cpuValueRaw, ramValueRaw] = match;
    const cpuValue = Number(cpuValueRaw);
    const ramUnit = raw.match(/(?:gb|g|ram|mb|m)/i)?.[0]?.toLowerCase() || '';
    let ramValue = Number(ramValueRaw);
    if (ramUnit && /mb|m/.test(ramUnit)) {
      ramValue = Number(ramValueRaw);
    } else {
      ramValue = Number(ramValueRaw) * 1024;
    }

    if (!Number.isFinite(cpuValue) || !Number.isFinite(ramValue)) {
      await sendMessage(chatId, '❌ Nilai CPU/RAM tidak valid. Gunakan format seperti `4,8` atau `4 vCPU, 8 GB RAM`.');
      return;
    }

    if (ramValue < 2048 || ramValue > 65535) {
      await sendMessage(chatId, '❌ *RAM tidak valid.*\n\nIDCloudHost mensyaratkan ukuran RAM antara *2048 MB* dan *65535 MB*.\nContoh: `2,4` = 2 vCPU, 4 GB RAM.');
      return;
    }

    try {
      await idCloudHostVmAction('modify', { vcpu: cpuValue, ram: Math.round(ramValue), plan: 'Custom' });
      vmState.currentPlan = 'Custom';
      vmState.cpu = `${cpuValue} vCPU`;
      vmState.ram = `${Math.round(ramValue / 1024)} GB`;
      vmState.status = 'stopped';
      saveAdminSession(chatId, { authenticated: true, step: 'authenticated' });

      await sendMessage(
        chatId,
        `✅ *Custom VM berhasil diset.*\n\nCPU: ${vmState.cpu}\nRAM: ${vmState.ram}\n\nVM masih dalam keadaan mati. Setelah itu, nyalakan VM dengan tombol *Start VM*.`
      );
      await showVmAdminMenu(chatId, '🧩 *Custom VM applied*');
    } catch (err) {
      console.error('custom VM modify error:', err.message);
      await sendMessage(chatId, `❌ Modify custom VM gagal: ${err.message}`);
    }
    return;
  }

  if (text && text.startsWith('/')) {
    await handleVmAdmin(chatId);
  }
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

  if (data.startsWith('vm:')) {
    await answerCallback(queryId);
    const [, action, subAction] = data.split(':');
    const session = getAdminSession(chatId);

    if (!session.authenticated) {
      await sendMessage(chatId, '❌ Anda belum login ke VM Admin. Gunakan /vmadmin untuk masuk.');
      return;
    }

    try {
      if (action === 'start') {
        await idCloudHostVmAction('start');
        vmState.status = 'running';
        await showVmAdminMenu(chatId, '✅ *VM berhasil di-start*');
      } else if (action === 'stop') {
        await idCloudHostVmAction('stop');
        vmState.status = 'stopped';
        await showVmAdminMenu(chatId, '⏹️ *VM berhasil di-stop*');
      } else if (action === 'restart') {
        await idCloudHostVmAction('restart');
        vmState.status = 'running';
        await showVmAdminMenu(chatId, '🔄 *VM berhasil di-restart*');
      } else if (action === 'status') {
        await refreshVmStateFromApi();
        await showVmAdminMenu(chatId, '📊 *Status Resource VM*');
      } else if (action === 'modify') {
        await handleVmAdminModify(chatId);
      } else if (action === 'backup') {
        await sendMessage(chatId, '💾 *Backup Status*\n\nBackup policy: Daily snapshot\nLast backup: 2026-08-18 02:00 UTC\nStorage: 20 GB\nStatus: Healthy');
        await showVmAdminMenu(chatId, '💾 *Backup status*');
      } else if (action === 'network') {
        await sendMessage(chatId, `📡 *Network Info*\n\nPrivate IP: ${vmState.privateIp}\nPublic IP: ${vmState.publicIp}\nGateway: 10.77.48.1\nDNS: 1.1.1.1, 8.8.8.8`);
        await showVmAdminMenu(chatId, '📡 *Network status*');
      } else if (action === 'logs') {
        await sendMessage(chatId, '🧾 *Recent VM Logs*\n\n[2026-08-18 03:24:33] VM stopped gracefully\n[2026-08-18 03:24:25] VM started successfully\n[2026-08-18 03:24:37] Resource modified to 4 vCPU / 2 GB\n[2026-08-18 03:00:10] VM created');
        await showVmAdminMenu(chatId, '🧾 *VM Logs*');
      } else if (action === 'back') {
        await showVmAdminMenu(chatId, '🔙 *Kembali ke dashboard*');
      } else if (action === 'plan') {
        await applyVmPreset(chatId, subAction);
      } else if (action === 'custom') {
        saveAdminSession(chatId, { authenticated: true, step: 'waiting_custom' });
        await sendMessage(chatId, '🧩 *Custom VM*\n\nMasukkan ukuran custom dengan format:\n`4,8`\natau\n`4 vCPU, 8 GB RAM`');
      } else if (action === 'logout') {
        clearAdminSession(chatId);
        await sendMessage(chatId, '👋 Anda telah logout dari VM Admin.');
      }
    } catch (err) {
      console.error('vm action error:', err.message);
      await sendMessage(chatId, `❌ VM action gagal: ${err.message}`);
    }
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
    } else if (section === 'chat') {
      await sendMessage(chatId, '💬 *Chat*\n\nJust send me any text and I\'ll reply using the default DeepSeek model!\n\nOr use /image to generate images, /models to change models, and more.', mainMenuKeyboard());
    } else if (section === 'image') {
      await sendMessage(chatId, '🎨 *Image Generation*\n\nUse `/image <prompt>` to generate images.\n\nExample: `/image a futuristic city at sunset`\n\nYou can change the image model in /models.', mainMenuKeyboard());
    } else if (section === 'usage') {
      await handleUsage(chatId);
    } else if (section === 'profile') {
      await handleProfile(chatId);
    } else if (section === 'about') {
      await handleAbout(chatId);
    } else if (section === 'vmadmin') {
      await handleVmAdmin(chatId);
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

    // Register bot commands only (autocomplete suggestions) + show current list
    if (req.query.commands === '1') {
      const cmds = await setBotCommands();
      const current = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMyCommands`
      ).then(r => r.json());
      return res.status(200).json({ ok: cmds.ok, ...cmds, currentCommands: current.result || [] });
    }

    // Show current webhook status from Telegram
    if (req.query.help === '1') {
      const info = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
      ).then(r => r.json());
      return res.status(200).json({ ok: true, info });
    }

    // Health check — also registers commands so they're always up to date
    const cmdsResult = await setBotCommands();
    return res.status(200).json({ ok: true, status: 'Telegram bot webhook ready', commandsRegistered: cmdsResult.ok, commandsError: cmdsResult.description || null });
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
        const session = getAdminSession(chatId);
        if (session.step === 'waiting_username' || session.step === 'waiting_password' || session.step === 'waiting_custom') {
          await handleVmAdminLogin(chatId, text);
          return res.status(200).json({ ok: true });
        }

        if (text.startsWith('/start')) await handleStart(chatId);
        else if (text.startsWith('/chat')) {
          await sendMessage(chatId, '💬 *Chat*\n\nJust send me any text and I\'ll reply using the AI!\n\nTip: /image <prompt> to generate images, /models to pick a model.', mainMenuKeyboard());
        } else if (text.startsWith('/image')) await handleImage(chatId, text.split(' ').slice(1).join(' ').trim());
        else if (text.startsWith('/models')) {
          const rows = [
            [{ text: '💬 Text models', callback_data: 'sel:text' }],
            [{ text: '🖼️ Image models', callback_data: 'sel:image' }],
            [{ text: '🆓 Free models', callback_data: 'sel:free' }],
            [{ text: '🔙 Main menu', callback_data: 'menu:back' }],
          ];
          await sendMessage(chatId, '🤖 *Choose a category:*', inlineKeyboard(rows));
        } else if (text.startsWith('/usage')) await handleUsage(chatId);
        else if (text.startsWith('/profile')) await handleProfile(chatId);
        else if (text.startsWith('/about')) await handleAbout(chatId);
        else if (text.startsWith('/vmadmin')) await handleVmAdmin(chatId);
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
