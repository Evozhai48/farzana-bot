// ============================================================
//  BotRental MY — Multi-Tenant WhatsApp Chatbot
//  Meta WhatsApp Cloud API  →  Claude API  →  Auto-reply
//  One deployment, swappable restaurant data via DEMO_RESTAURANT_ID
// ============================================================

import express from "express";
import twilio from "twilio";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Clients ────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let twilioClient = null;
try {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
} catch (err) {
  console.warn("⚠️ Twilio client not initialized (invalid/missing credentials) — skipping. This is expected if you've moved to Meta Cloud API.");
}

// — Meta WhatsApp Cloud API webhook ————————————————————
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified ✅");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// — Send a WhatsApp message via Meta Cloud API ————————————————————
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const META_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

async function sendWhatsAppMeta(to, text) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("❌ Meta send error:", JSON.stringify(data));
    } else {
      console.log(`✅ Sent to ${to}: ${text}`);
    }
    return data;
  } catch (err) {
    console.error("❌ Failed to send via Meta:", err.message);
  }
}

// ── In-memory stores ───────────────────────────────────────
// Conversation history per customer (resets after 2 hrs idle)
const conversations = {};
// Orders pending follow-up { customerNumber: { orderedAt, items } }
const pendingFollowUps = {};

// ============================================================
//  RESTAURANT CONFIGS — multi-tenant demo data
//
//  Add a new entry here for each prospect before a live demo.
//  Then set DEMO_RESTAURANT_ID=<key> (DigitalOcean env var) to switch
//  which restaurant the bot represents. No code changes needed
//  after this file is set up — just edit this object + redeploy,
//  or maintain a few pre-built entries and flip the env var.
//
//  Default is now "generic" (blank template) instead of "farzana" —
//  fill in the bracketed fields live during a call, or add a new
//  named key per prospect. "farzana" is kept below as a saved
//  reference config, not the active default.
// ============================================================
const RESTAURANTS = {
  farzana: {
    name: "Farzana Corner",
    assistantName: "Hana",
    address: "927, Jalan Mawar, Kampung Sungai Kayu Ara, 47400 Petaling Jaya, Selangor",
    phone: "017-316 2057",
    hours: "Open 24 hours, 7 days a week",
    priceRange: "RM 1 – RM 20 per person",
    services: "Dine-in, Takeaway, Delivery (Grab & Foodpanda)",
    menu: `
Roti & Breakfast:
- Roti Canai – RM 1.50
- Roti Telur – RM 2.50
- Roti Bawang – RM 2.00
- Roti Pisang – RM 2.50
- Roti Sardin – RM 3.00
- Roti Tissue – RM 4.50
- Roti John – RM 6.00
- Murtabak Daging – RM 7.00
- Murtabak Ayam – RM 6.50
- Nasi Lemak (Basic) – RM 3.00
- Nasi Lemak Special (with fried chicken) – RM 7.00
- Mihun Sup – RM 5.00

Nasi:
- Nasi Kandar Ayam – RM 8.00
- Nasi Kandar Daging – RM 9.50
- Nasi Kandar Campur (2 lauk) – RM 9.00
- Nasi Goreng Ayam – RM 7.00
- Nasi Goreng Kampung – RM 8.00
- Nasi Goreng Seafood – RM 9.50
- Nasi Briyani Ayam – RM 9.00
- Nasi Briyani Daging – RM 10.00
- Nasi Putih + Lauk (pilih 2) – RM 7.50

Mee & Mihun:
- Mee Goreng – RM 7.00
- Mihun Goreng – RM 7.00
- Maggi Goreng – RM 7.50
- Mee Rebus – RM 6.50
- Mee Bandung – RM 7.00
- Kuey Teow Goreng – RM 7.50

Sup & Side Dishes:
- Sup Ekor – RM 12.00
- Sup Tulang – RM 10.00
- Sup Kambing – RM 13.00
- Ayam Goreng (1 piece) – RM 4.00
- Telur Mata – RM 1.50
- Sayur Campur – RM 3.00
- Ikan Goreng – RM 5.00

Satay (min 10 sticks):
- Sate Ayam – RM 0.80/stick
- Sate Daging – RM 1.00/stick

Western (Light):
- Chicken Chop – RM 12.00
- Fish & Chips – RM 13.00

Minuman:
- Teh Tarik – RM 2.00
- Teh O – RM 1.50
- Teh C – RM 2.20
- Teh C Peng – RM 2.50
- Kopi O – RM 1.50
- Kopi Susu – RM 1.80
- Milo Ais – RM 2.50
- Milo Tarik – RM 2.80
- Air Sirap – RM 1.50
- Ice Lemon Tea – RM 2.50
- Sirap Bandung – RM 1.80
- Mineral Water – RM 1.50
    `.trim(),
  },

  // Generic placeholder — a normal, ordinary Malaysian kedai makan.
  // Swap in the prospect's real name/address/menu before a live demo,
  // or add a dedicated key per prospect instead.
  generic: {
    name: "Restoran Sri Melur",
    assistantName: "Hana",
    address: "12, Jalan SS15/4D, 47500 Subang Jaya, Selangor",
    phone: "012-345 6789",
    hours: "8:00 AM – 10:00 PM, Isnin – Ahad",
    priceRange: "RM 5 – RM 15 per person",
    services: "Dine-in, Takeaway, Delivery (Grab & Foodpanda)",
    menu: `
Nasi & Mains:
- Nasi Campur (pilih 2 lauk) – RM 8.00
- Nasi Ayam Goreng – RM 7.50
- Nasi Goreng Kampung – RM 7.00
- Mee Goreng Mamak – RM 6.50
- Mee Hoon Sup – RM 6.00
- Ayam Penyet – RM 9.00
- Sayur Campur – RM 3.00

Minuman:
- Teh Ais / Teh Panas – RM 2.00
- Milo Ais – RM 2.50
- Kopi O / Kopi Susu – RM 1.80
- Air Sirap – RM 1.50
- Mineral Water – RM 1.50

Extra:
- Telur Mata – RM 1.50
- Ikan Goreng – RM 4.00
    `.trim(),
  },

  // ── Add new prospects below this line ──────────────────────
  // dyamu_tomyam: {
  //   name: "Dyamu Tomyam 4",
  //   assistantName: "Hana",
  //   address: "...",
  //   phone: "...",
  //   hours: "...",
  //   priceRange: "...",
  //   services: "Dine-in, Takeaway, Delivery (Grab)",
  //   menu: `
  // - Tomyam Ayam – RM X
  // ...
  //   `.trim(),
  // },
};

const DEMO_ID = process.env.DEMO_RESTAURANT_ID || "generic";
const RESTAURANT = RESTAURANTS[DEMO_ID] || RESTAURANTS.generic;

if (!RESTAURANTS[DEMO_ID]) {
  console.warn(`⚠️ DEMO_RESTAURANT_ID="${DEMO_ID}" not found in RESTAURANTS — falling back to "generic".`);
}
console.log(`🏪 Bot is representing: ${RESTAURANT.name} (key: ${DEMO_ID})`);

// ── System prompt builder ───────────────────────────────────
function buildSystemPrompt(r) {
  return `
You are ${r.assistantName}, the friendly WhatsApp assistant for ${r.name} restaurant.

RESTAURANT INFO:
- Name: ${r.name}
- Address: ${r.address}
- Phone: ${r.phone}
- Hours: ${r.hours}
- Price range: ${r.priceRange}
- Services: ${r.services}

MENU:
${r.menu}

LANGUAGE:
- Reply in the same language the customer uses
- Default to friendly Bahasa Malaysia mixed with English (Manglish)
- Keep replies short, warm, and clear — like a friendly staff member texting
- Use 😊 occasionally but don't overdo emojis

ORDERING RULES — VERY IMPORTANT:
1. Always ask for spicy preference: "Nak pedas tak, atau tak pedas?"
2. Always confirm the full order back before closing: repeat items + special requests
3. Always ask: "Dine-in, takeaway, atau delivery?"
4. For delivery: ask for full address
5. If customer says "no spicy" or "tak pedas" — acknowledge it clearly: "Okay, noted — tak pedas ye! 👍"
6. Never skip confirming special requests — this is critical

AFTER ORDER IS CONFIRMED:
- End your message with exactly this line on its own:
  [ORDER_CONFIRMED: <summary of order in one line>]
- Example: [ORDER_CONFIRMED: Nasi Goreng Ayam x1 (tak pedas), Teh Tarik x1 — Takeaway]

COMPLAINTS:
- If a customer complains about food quality, wrong order, or bad experience:
  - Apologize sincerely and warmly first
  - Do NOT be defensive
  - End your message with: [COMPLAINT_FLAGGED: <one-line summary of complaint>]
  - Example: [COMPLAINT_FLAGGED: Customer received spicy food despite requesting tak pedas]

THINGS YOU DON'T KNOW:
- Real-time wait times — say "Boleh call kami di ${r.phone} untuk tanya terus 😊"
- Stock availability — same, redirect to call

Stay helpful, honest, and warm. You represent ${r.name}.
`.trim();
}

const SYSTEM_PROMPT = buildSystemPrompt(RESTAURANT);

// ── Conversation helper ────────────────────────────────────
function getHistory(from) {
  if (!conversations[from]) conversations[from] = { messages: [], lastActive: Date.now() };
  conversations[from].lastActive = Date.now();
  return conversations[from].messages;
}

function pruneOldConversations() {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = Date.now();
  for (const key of Object.keys(conversations)) {
    if (now - conversations[key].lastActive > TWO_HOURS) delete conversations[key];
  }
}
setInterval(pruneOldConversations, 30 * 60 * 1000);

// ── Send WhatsApp message via Twilio ───────────────────────
async function sendWhatsApp(to, body) {
  await twilioClient.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:${to}`,
    body,
  });
}

// ── Notify owner (uses Meta API — Twilio path is deprecated) ────
async function notifyOwner(type, detail, customerNumber) {
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (!ownerNumber) return;

  let msg = "";
  if (type === "ORDER") {
    msg =
      `🛎️ *Pesanan Baru!*\n` +
      `Customer: wa.me/${customerNumber.replace("+", "")}\n` +
      `Order: ${detail}\n` +
      `Masa: ${new Date().toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}`;
  } else if (type === "COMPLAINT") {
    msg =
      `⚠️ *Aduan Customer*\n` +
      `Customer: wa.me/${customerNumber.replace("+", "")}\n` +
      `Isu: ${detail}\n` +
      `Sila follow up segera!`;
  }

  try {
    // NOTE: previously used the Twilio-based sendWhatsApp(), which throws
    // because Twilio credentials are no longer valid post Meta-migration.
    // That uncaught error was bubbling up and causing the CUSTOMER to see
    // a fallback "ada gangguan" message instead of their real order
    // confirmation. Switched to the working Meta sender + wrapped in
    // try/catch so a notify failure can never break the customer reply.
    await sendWhatsAppMeta(ownerNumber, msg);
  } catch (err) {
    console.error("❌ Failed to notify owner:", err.message);
  }
}

// ── Log order to Google Sheet via Zapier webhook ────────────
const ZAPIER_ORDER_WEBHOOK_URL = process.env.ZAPIER_ORDER_WEBHOOK_URL;

async function logOrderToSheet(orderSummary, customerNumber) {
  if (!ZAPIER_ORDER_WEBHOOK_URL) {
    console.warn("⚠️ ZAPIER_ORDER_WEBHOOK_URL not set — skipping sheet log.");
    return;
  }
  try {
    await fetch(ZAPIER_ORDER_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }),
        restaurant: RESTAURANT.name,
        customer_phone: customerNumber,
        order_summary: orderSummary,
        status: "New",
      }),
    });
  } catch (err) {
    console.error("❌ Failed to log order to sheet:", err.message);
  }
}

// ── Schedule follow-up after 30 minutes ───────────────────
function scheduleFollowUp(customerNumber, orderSummary) {
  pendingFollowUps[customerNumber] = { orderedAt: Date.now(), items: orderSummary };

  setTimeout(async () => {
    if (!pendingFollowUps[customerNumber]) return;
    delete pendingFollowUps[customerNumber];

    const followUpMsg =
      `Hi! Makanan dari ${RESTAURANT.name} tadi okay tak? 😊\n\n` +
      `Kami harap semua sedap dan mengikut pesanan korang. ` +
      `Kalau ada apa-apa yang tak kena, bagitahu kami ye — ` +
      `kami nak pastikan korang puas hati! 🙏`;

    try {
      await sendWhatsApp(customerNumber, followUpMsg);
    } catch (err) {
      console.error("Follow-up failed:", err.message);
    }
  }, 30 * 60 * 1000); // 30 minutes
}

// — Shared Claude reply logic (used by both Twilio and Meta) ————————————
async function generateReply(from, incomingMsg) {
  const history = getHistory(from);
  history.push({ role: "user", content: incomingMsg });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: history,
  });

  let replyText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  history.push({ role: "assistant", content: replyText });

  const orderMatch = replyText.match(/\[ORDER_CONFIRMED:\s*(.+?)\]/);
  const complaintMatch = replyText.match(/\[COMPLAINT_FLAGGED:\s*(.+?)\]/);

  if (orderMatch) {
    const orderSummary = orderMatch[1].trim();
    replyText = replyText.replace(orderMatch[0], "").trim();
    await notifyOwner("ORDER", orderSummary, from);
    await logOrderToSheet(orderSummary, from);
    scheduleFollowUp(from, orderSummary);
  }

  if (complaintMatch) {
    const complaintDetail = complaintMatch[1].trim();
    replyText = replyText.replace(complaintMatch[0], "").trim();
    await notifyOwner("COMPLAINT", complaintDetail, from);
  }

  return replyText;
}

// — Main webhook endpoint (handles both Meta and legacy Twilio formats) —
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // --- Meta WhatsApp Cloud API format ---
  if (body.object === "whatsapp_business_account") {
    res.sendStatus(200);
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages) return;

    for (const message of messages) {
      const from = message.from;
      const incomingMsg = message.text?.body;
      if (!from || !incomingMsg) continue;

      console.log(`[IN-META] ${from}: ${incomingMsg}`);
      try {
        const replyText = await generateReply(from, incomingMsg);
        await sendWhatsAppMeta(from, replyText);
      } catch (err) {
        console.error("Error handling Meta message:", err.message);
        await sendWhatsAppMeta(from, `Maaf, ada gangguan sekejap. Cuba lagi atau call kami di ${RESTAURANT.phone} 😊`);
      }
    }
    return;
  }

  // --- Legacy Twilio format ---
  res.status(200).send("<Response></Response>");
  const incomingMsg = (req.body.Body || "").trim();
  const from = (req.body.From || "").replace("whatsapp:", "");
  if (!incomingMsg || !from) return;

  console.log(`[IN-TWILIO] ${from}: ${incomingMsg}`);
  try {
    const replyText = await generateReply(from, incomingMsg);
    await sendWhatsApp(from, replyText);
  } catch (err) {
    console.error("Error:", err.message);
    await sendWhatsApp(from, `Maaf, ada gangguan sekejap. Cuba lagi atau call kami di ${RESTAURANT.phone} 😊`);
  }
});

// ── Health check ───────────────────────────────────────────
app.get("/", (req, res) => res.send(`${RESTAURANT.name} bot is running ✅`));

// ── Start server ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
