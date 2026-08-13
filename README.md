# 🤖 Telegram AI Bot (OpenRouter + Vercel)

A lightweight, serverless Telegram bot that connects to [OpenRouter](https://openrouter.ai) to provide **chat**, **image analysis**, and **image generation** through a clean interactive menu. Auto-deploys on Vercel with every `git push`.

This bot is designed for **Vercel** (serverless) with no persistent server required. It includes:

- 💬 Chat with top AI models
- 👁️ Analyze images you send (vision, OCR, object detection)
- 🖼️ Generate images on demand
- ⚙️ Per-user model selection (in-memory, resets on cold start)
- 📊 Live usage & limit tracking (from OpenRouter)
- 💲 Pricing information for the active models
- ℹ️ One-tap overall summary of models and usage
- 🔐 Simple, stateless architecture — no external database needed

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Chat** | Send any text and the bot replies using your selected text model. |
| **Image analysis** | Send a photo and the bot extracts info, text, objects, or describes it with a vision-capable model. |
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
                               ├── /models → User model selection (in-memory)
                               ├── /usage → OpenRouter auth/key endpoint
                               └── /info → Combined summary
```

- **Stateless logic** – Each webhook invocation is independent.
- **No database needed** – Per-user model prefs are kept in memory (reset on cold start).
- **OpenRouter API** – Handles both text, vision, and images with one API key.

---

## 📁 Project Structure

```
telegram-ai-bot/
├── api/
│   └── telegram.js       # Main serverless function
├── .env.example          # Environment variable template
├── .gitignore
├── package.json          # Dependencies (openai)
├── vercel.json           # Function timeout config
└── README.md             # This file
```

---

## ⚙️ Prerequisites

1. **Telegram Bot Token** – Create via [@BotFather](https://t.me/BotFather).
2. **OpenRouter API Key** – Get from [OpenRouter Keys](https://openrouter.ai/keys).
3. **Vercel Account** – For hosting (free tier works for chat; image generation may need Pro or faster models).

No database or storage service required — the bot runs on just the two API keys above.

---

## 🔑 How to Get Your API Keys

This bot needs two API keys: a **Telegram Bot Token** and an **OpenRouter API Key**. Here's exactly how to get both.

---

### 1️⃣ Telegram Bot Token (from @BotFather)

1. **Open Telegram** and search for [@BotFather](https://t.me/BotFather) (the official, verified bot with a blue check ✓).
2. **Start a chat** with BotFather and send the command:
   ```
   /newbot
   ```
3. BotFather will ask for a **name** for your bot — this is the display name people see. Example: `My AI Assistant`
4. It will then ask for a **username** for your bot. This must:
   - End with the word `bot` (e.g. `my_ai_assistant_bot`)
   - Be **unique** across all of Telegram
5. If successful, BotFather replies with a message containing your **token**, which looks like:
   ```
   1234567890:AAHfKx9mExampleToken...abc123deF
   ```
   ⚠️ Keep this token **secret** — anyone who has it can control your bot.

6. *(Optional but recommended)* Set what your bot does — send `/setdescription` and `/setabouttext`.
7. *(Optional)* To see a list of all your bots: send `/mybots`.

> **💡 Tip:** The token is what you'll put in the `TELEGRAM_BOT_TOKEN` environment variable on Vercel.

---

### 2️⃣ OpenRouter API Key (AI models)

1. **Create an account** at [openrouter.ai](https://openrouter.ai) (Sign up with Google, GitHub, or email — free).
2. After logging in, open the **Keys** page: [openrouter.ai/keys](https://openrouter.ai/keys).
3. Click **"Create Key"** (or "Keys" → "Create Key").
   - Enter a name for the key, e.g. `telegram-bot`.
   - *(Optional)* Set a **credit limit** so you never accidentally spend more than you want.
4. Copy the key that is generated. It looks like:
   ```
   sk-or-v1-a1b2c3d4e5f6...
   ```
   ⚠️ This key is shown **only once** — copy it immediately and store it somewhere safe.

> **💡 Tip:** The key is what you'll put in the `OPENROUTER_API_KEY` environment variable on Vercel.

**About credits (important for free usage):**
- OpenRouter gives you a small **free credit** to start with.
- Many models are **completely free** (`🆓`) — this bot defaults to free models.
- Paid models use your **credit balance** (you can add credit/Credit Cards in your OpenRouter dashboard).
- You can see your usage & limit in the bot with `/usage`.

---

### 🧪 Testing your keys locally (optional)

```bash
# 1. Create a local .env file from the template
cp .env.example .env

# 2. Fill in your real keys:
# TELEGRAM_BOT_TOKEN=1234567890:AA...
# OPENROUTER_API_KEY=sk-or-v1-...

# 3. Verify OpenRouter works (returns model names):
curl -s https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer sk-or-v1-YOUR_KEY" \
  | head -c 300
```

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
| `/start` | Show the About info and welcome menu |
| `/chat` | Chat with the AI (or just send any text) |
| `/image <prompt>` | Generate an image from a text prompt |
| `/models` | Browse and select text and image models |
| `/usage` | Check OpenRouter credit usage |
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
| Model selection not saving | Prefs are in-memory and reset on cold start — pick the model again if it resets. |
| Bot doesn't reply to text | Check if the bot is allowed to receive messages (in Telegram privacy settings) or if the webhook is set correctly. |

---

## 🔮 Customization Ideas

- Add conversation memory (store chat history in a database).
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

Built with [OpenRouter](https://openrouter.ai) and [Vercel](https://vercel.com).

**Enjoy your bot!** ⭐
