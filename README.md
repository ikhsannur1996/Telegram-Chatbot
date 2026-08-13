Here is the content for your `README.md` file. It documents the lightweight Telegram AI bot we built — deployable on Vercel, using OpenRouter for chat and images — and includes all the menu options, model selection, usage tracking, pricing, and the "Info" summary feature.

---

```markdown
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
| **Model selection** | Choose from a list of text and image models directly in the chat. |
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
├── package.json          # Dependencies (openai, @vercel/kv)
├── vercel.json           # Optional function timeout config
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
git clone https://github.com/your-username/telegram-ai-bot.git
cd telegram-ai-bot
```

### 2. Install Dependencies Locally (Optional)

```bash
npm install
```

### 3. Connect to Vercel

Push the repo to GitHub, then import it into [Vercel](https://vercel.com). The build settings will be automatically detected.

### 4. Set Environment Variables

In Vercel Dashboard → your project → **Settings → Environment Variables**, add:

| Key                    | Value                                  |
|------------------------|----------------------------------------|
| `TELEGRAM_BOT_TOKEN`   | Your Telegram bot token                |
| `OPENROUTER_API_KEY`   | Your OpenRouter API key                |
| `KV_URL`               | (Auto-added when you connect Vercel KV) |
| `KV_REST_API_URL`      | (Auto-added)                           |
| `KV_REST_API_TOKEN`    | (Auto-added)                           |

> `KV_URL`, `KV_REST_API_URL`, and `KV_REST_API_TOKEN` are automatically injected by Vercel once you attach a KV database to your project. No manual setup needed.

### 5. Deploy

Click **Deploy** in the Vercel dashboard (or use the CLI). After deployment, copy your function URL, e.g.:

```
https://your-app.vercel.app/api/telegram
```

### 6. Set the Telegram Webhook

Run this in your terminal (replace `<TOKEN>` and `<YOUR_URL>`):

```bash
curl "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-app.vercel.app/api/telegram"
```

You should see `{"ok":true,"result":true}` in the response.

---

## 🧑‍💻 Bot Commands & Menu

### Commands (type in Telegram)

| Command | Description |
|---------|-------------|
| `/start` | Show the main interactive menu |
| `/image <prompt>` | Generate an image (e.g., `/image a red car`) |
| `/models` | Open model selection menu |
| `/usage` | View OpenRouter usage and credit limit |
| `/price` | Show pricing for the currently active models |
| `/info` | Combined summary – models, usage, pricing |
| `/about` | Information about the bot |
| `/help` | List all commands and usage tips |

### Interactive Menu (after /start)

The main menu shows these buttons:

```
[ 💬 Chat ]  [ 🖼️ Image ]
[ ⚙️ Models ]  [ 📊 Usage ]
[ 💲 Price ]  [ ℹ️ Info ]
```

- **💬 Chat** – Reminds the user that they can simply type to chat.
- **🖼️ Image** – Explains how to use `/image` command.
- **⚙️ Models** – Opens sub-menu with text and image model selection.
- **📊 Usage** – Opens live usage/limit view.
- **💲 Price** – Opens pricing for current models.
- **ℹ️ Info** – Shows combined summary (models, usage, price).
- **❓ Help** – Displays full instructions (optional, but included in the code).

### Model Selection Menu

```
⚙️ *Model Selection*

Current text: openai/gpt-4o-mini
Current image: black-forest-labs/flux-1.1-pro

[ 📝 Text Models ]
[ 🎨 Image Models ]
[ 🔙 Back to Main ]
```

Tapping a model updates the user's preference in Vercel KV and shows a confirmation.

---

## 🛠 Configuration

### Default Models

In `api/telegram.js`, you can change the default models:

```javascript
const DEFAULT_TEXT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux-1.1-pro";
```

### Available Models (with Pricing)

Text models are stored as objects with `id`, `label`, `input`, and `output` (prices per 1M tokens in USD):

| Model ID | Friendly Label | Input (USD / 1M) | Output (USD / 1M) |
|----------|---------------|------------------|-------------------|
| `openai/gpt-4o-mini` | ⚡ GPT-4o Mini | 0.15 | 0.60 |
| `anthropic/claude-3.5-sonnet` | 🧠 Claude 3.5 Sonnet | 3.00 | 15.00 |
| `google/gemini-2.0-flash-001` | 🚀 Gemini 2.0 Flash | 0.10 | 0.40 |
| `deepseek/deepseek-r1` | 🔍 DeepSeek R1 | 0.55 | 2.19 |
| `meta-llama/llama-3.3-70b-instruct` | 🦙 Llama 3.3 70B | 0.25 | 1.00 |

Image models have a flat price per image (USD):

| Model ID | Friendly Label | Price per image (USD) |
|----------|---------------|------------------------|
| `openai/dall-e-3` | 🖌️ DALL-E 3 | 0.04 |
| `black-forest-labs/flux-1.1-pro` | 🎨 Flux 1.1 Pro | 0.04 |
| `stabilityai/sdxl-turbo` | ✨ SDXL Turbo | 0.003 |

To add more models, simply append them to the `TEXT_MODELS` or `IMAGE_MODELS` arrays in `api/telegram.js`.

---

## 📊 Example Outputs

### Chat Response

```
User: What is the capital of France?
Bot: The capital of France is Paris.
```

### Image Generation

```
User: /image a futuristic city at sunset
Bot: (sends photo) 🖼️ Generated with black-forest-labs/flux-1.1-pro
```

### Usage View

```
📊 OpenRouter Usage

Used: $0.1250
Limit: $1.0000
Plan: Free
```

### Info Summary

```
📊 Overall Summary

🤖 Active Models:
💬 Text: `openai/gpt-4o-mini`
🖼️ Image: `black-forest-labs/flux-1.1-pro`

💰 Pricing:
Text: 0.15 USD / 1M input, 0.60 USD / 1M output
Image: 0.04 USD per image

📈 Usage:
Spent: 0.1250 USD
Limit: 1.0000 USD
Plan: Free
Progress: ███░░░░░░░  12.5%

Tip: Use /models to switch models anytime.
```

---

## ⏱️ Vercel Timeout Considerations

- **Free tier** has a **10-second** function timeout.
- Image generation (e.g., Flux) may take longer than 10 seconds.
- The code sets `maxDuration` to 60 seconds (requires **Vercel Pro**).
- For free tier, use faster image models like `stabilityai/sdxl-turbo` or change the prompt to be simpler.

You can set `maxDuration` in `vercel.json`:

```json
{
  "functions": {
    "api/telegram.js": {
      "maxDuration": 60
    }
  }
}
```

---

## 🧰 Troubleshooting

| Problem | Possible Fix |
|---------|--------------|
| Webhook not responding | Re-set the webhook URL using the `curl` command above. |
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

This project is open-source and available under the **MIT License**. Feel free to use, modify, and distribute it.

---

## 👤 Credits

Built with [OpenRouter](https://openrouter.ai), [Vercel](https://vercel.com), and [Vercel KV](https://vercel.com/docs/storage/vercel-kv). 

---

**Enjoy your bot!** If you find it useful, consider giving the repository a ⭐.
```

---

Let me know if you'd like me to include the full `api/telegram.js` code directly in the README or if you prefer to keep the README as a high-level documentation file.