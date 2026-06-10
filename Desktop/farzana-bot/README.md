# Farzana Corner WhatsApp Bot

WhatsApp AI chatbot powered by Claude — handles orders, confirms special requests,
sends owner alerts, and follows up with customers after 30 minutes.

---

## What it does

- Answers FAQs (menu, hours, location) instantly, 24/7
- Takes orders via WhatsApp and confirms special requests (e.g. tak pedas)
- Sends a WhatsApp alert to the owner for every confirmed order
- Follows up with the customer 30 min after order to check satisfaction
- Flags complaints to the owner immediately
- Handles conversations in Bahasa Malaysia / Manglish

---

## Setup (step by step)

### 1. Get your API keys

**Anthropic (Claude):**
- Go to https://console.anthropic.com
- Sign up → API Keys → Create Key
- Copy the key

**Twilio:**
- Go to https://twilio.com → sign up free
- Go to Messaging → Senders → WhatsApp → Request access
- Wait 1–2 days for WhatsApp approval
- From your Twilio Console: copy Account SID, Auth Token, and your WhatsApp number

---

### 2. Clone and install

```bash
git clone <your-repo-url>
cd farzana-bot
npm install
```

---

### 3. Set up environment variables

Copy the example file:
```bash
cp .env.example .env
```

Then open `.env` and fill in your real values:
```
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_NUMBER=+1415XXXXXXX
OWNER_WHATSAPP_NUMBER=+60123456789
```

---

### 4. Deploy to Railway

1. Go to https://railway.app → New Project → Deploy from GitHub
2. Connect your GitHub repo
3. In Railway dashboard → Variables → add all your `.env` values
4. Railway auto-deploys. Copy your public URL (e.g. `https://farzana-bot.up.railway.app`)

---

### 5. Connect Twilio webhook

1. Go to Twilio Console → Messaging → Senders → WhatsApp Senders
2. Click your WhatsApp number
3. Under "When a message comes in" → paste your Railway URL + `/webhook`
   - Example: `https://farzana-bot.up.railway.app/webhook`
4. Method: HTTP POST
5. Save

---

### 6. Test it

Send a WhatsApp message to your Twilio number:
- "Apa menu ada?" → should reply with menu
- "Nak order nasi goreng, tak pedas" → should confirm + alert owner + schedule follow-up
- "Makanan tadi tak sedap" → should apologize + flag to owner

---

## Customising for a new client

To use this bot for a different restaurant, update these sections in `index.js`:

1. **SYSTEM_PROMPT** — change restaurant name, address, hours, phone, and menu
2. **OWNER_WHATSAPP_NUMBER** in `.env` — change to the new owner's number

Each client gets their own deployed instance with their own Twilio number.

---

## File structure

```
farzana-bot/
├── index.js          ← main bot code (webhook + Claude + Twilio)
├── package.json      ← dependencies
├── railway.toml      ← Railway deployment config
├── .env.example      ← environment variable template
└── README.md         ← this file
```

---

## Cost per client per month

| Item | Cost |
|------|------|
| Twilio WhatsApp number | ~RM 65 |
| Claude API (1,000 msgs) | ~RM 8 |
| Railway hosting | RM 0–20 |
| **Total** | **~RM 93** |
| **You charge client** | **RM 299** |
| **Net profit** | **~RM 206** |
