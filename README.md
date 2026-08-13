# 🤖 Telegram AI Bot (OpenRouter + Vercel)

A lightweight, serverless Telegram bot that connects to [OpenRouter](https://openrouter.ai) to provide **chat** and **image generation** through a clean interactive menu.

This bot is designed for **Vercel** (serverless) with no persistent server required. It includes:

- 💬 Chat with top AI models
- 🖼️ Generate images on demand
- ⚙️ Per-user model selection (stored in Vercel KV)
- 📊 Live usage & limit tracking (from OpenRouter)
- 💲 Pricing information for the active models
- ℹ️ One-tap overall summary of models, usage, and price
- 🔐 Simple, stateless architecture (except KV for user preferences)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Chat** | Send any text and the bot replies using your selected text model. |
| **Image generation** | Use `/image <prompt>` to generate an image with your selected image model. |
| **Model selection** | Browse **all models live** from OpenRouter with pagination, filter by **free models only**, and pick any text or image model. |
| **Usage tracking** | Shows how much credit you've used (OpenRouter). |
| **Pricing view** | Displays cost per 1M tokens (text) and per image. |
| **Overall summary** | One button shows your models, current usage, and pricing. |
| **About / Help** | Info about the bot and usage instructions. |

---

## 🧠 How It Works

```
Telegram ──POST webhook──> Vercel (api/telegram.js)
                               │
                               ├── /start → Interactive menu
                               ├── <text> → OpenRouter Chat Completion
                               ├── /image <prompt> → OpenRouter Image Generation
                               ├── /models → User model selection (Vercel KV)
                               ├── /usage → OpenRouter auth/key endpoint
                               ├── /price → Local price table
                               └── /info → Combined summary
```

- **Stateless logic** – Each webhook invocation is independent.
- **Vercel KV** – Stores per-user model preferences (Redis underneath, free tier available).
- **OpenRouter API** – Handles both text and images with one API key.

---

## 📁 Project Structure

```
telegram-ai-bot/
├── api/
│   └── telegram.js       # Main serverless function
├── .env.example          # Environment variable template
├── .gitignore
├── package.json          # Dependencies (openai, @vercel/kv)
├── vercel.json           # Function timeout config
└── README.md             # This file
```

---

## ⚙️ Prerequisites

1. **Telegram Bot Token** – Create via [@BotFather](https://t.me/BotFather).
2. **OpenRouter API Key** – Get from [OpenRouter Keys](https://openrouter.ai/keys).
3. **Vercel Account** – For hosting (free tier works for chat; image generation may need Pro or faster models).
4. **Vercel KV** – Create a database in the Vercel Dashboard (Storage → Upstash Redis).
---

## 🚀 Deployment on Vercel

### 1. Clone the Repository

```bash
git clone https://github.com/ikhsannur1996/Telegram-Chatbot.git
cd Telegram-Chatbot
```

### 2. Set Environment Variables in Vercel

In Vercel Dashboard → your project → Settings → Environment Variables, add:

| Key | Value |
|-----|-------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from @BotFather |
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `KV_URL` | (Auto-added when you connect Vercel KV) |
| `KV_REST_API_URL` | (Auto-added when you connect Vercel KV) |
| `KV_REST_API_TOKEN` | (Auto-added when you connect Vercel KV) |

### 3. Deploy

Push the repo to GitHub, then import it into [Vercel](https://vercel.com). The build settings will be automatically detected.

### 4. Set the Telegram Webhook

After deployment, visit the following URL in your browser to register the webhook:

```
https://<your-vercel-project>.vercel.app/api/telegram?register=1
```

Or run manually:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<your-vercel-project>.vercel.app/api/telegram"}'
```

---

## 🤖 Available Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and interactive menu |
| `/image <prompt>` | Generate an image from a text prompt |
| `/models` | Select text and image models |
| `/usage` | Check OpenRouter credit usage |
| `/price` | View pricing for all models |
| `/info` | Overall summary of models, usage, and pricing |

---

## 💬 Text Models

The bot fetches **all available models live** from OpenRouter's API. You can browse them with pagination in the chat. Examples of popular models:

| Model ID | Pricing |
|----------|---------|
| `openai/gpt-4o-mini` | $0.15 / $0.60 per 1M |
| `anthropic/claude-3.5-sonnet` | $3.00 / $15.00 per 1M |
| `google/gemini-2.0-flash-001` | $0.10 / $0.40 per 1M |
| `deepseek/deepseek-r1` | $0.55 / $2.19 per 1M |
| `meta-llama/llama-3.3-70b-instruct` | $0.25 / $1.00 per 1M |

## 🎨 Image Models

| Model ID | Pricing |
|----------|---------|
| `openai/dall-e-3` | $0.04 / image |
| `black-forest-labs/flux-1.1-pro` | $0.04 / image |
| `stabilityai/sdxl-turbo` | $0.003 / image |

> 💡 Use `/models` in the chat to browse **all models** — including **free models** (🆓 filtered view).

---

## ⏱️ Vercel Timeout Considerations

- **Free tier** has a **10-second** function timeout.
- Image generation (e.g., Flux) may take longer than 10 seconds.
- The code sets `maxDuration` to 60 seconds (requires **Vercel Pro**).
- For free tier, use faster image models like `stabilityai/sdxl-turbo` or simpler prompts.

---

## 🧰 Troubleshooting

| Problem | Possible Fix |
|---------|--------------|
| Webhook not responding | Re-set the webhook URL via `?register=1` or the `curl` command above. |
| `/usage` shows error | Verify your OpenRouter API key is correct and not expired. |
| Image generation timeout | Use a faster model or upgrade to Vercel Pro. |
| Model selection not saving | Ensure Vercel KV is connected to your project and env vars are set. |
| Bot doesn't reply to text | Check if the bot is allowed to receive messages (in Telegram privacy settings) or if the webhook is set correctly. |

---

## 🔮 Customization Ideas

- Add conversation memory (store chat history in Vercel KV).
- Add moderation or content filtering.
- Add a `/feedback` command to forward user input to an admin.
- Add admin-only broadcast commands.
- Add a `/stats` command showing total usage by user.
- Integrate with another image provider (like Replicate or Stability API) for more model variety.

---

## 📄 License

This project is open-source and available under the **MIT License**.

---

## 👤 Credits

Built with [OpenRouter](https://openrouter.ai), [Vercel](https://vercel.com), and [Vercel KV](https://vercel.com/docs/storage/vercel-kv).

**Enjoy your bot!** ⭐
