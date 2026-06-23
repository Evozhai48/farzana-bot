// ============================================================
//  Farzana Corner WhatsApp Chatbot
//  Twilio WhatsApp  →  Claude API  →  Auto-reply
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
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
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

app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (messages) {
      messages.forEach((message) => {
        const from = message.from;
        const text = message.text?.body;
        console.log(`📩 From ${from}: ${text}`);
        // TODO: wire this into the same Claude logic Twilio uses below
      });
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});
// ── In-memory stores ───────────────────────────────────────
// Conversation history per customer (resets after 2 hrs idle)
const conversations = {};
// Orders pending follow-up { customerNumber: { orderedAt, items } }
const pendingFollowUps = {};

// ── System prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `
You are Hana, the friendly WhatsApp assistant for Farzana Corner restaurant in Petaling Jaya, Selangor.

RESTAURANT INFO:
- Name: Farzana Corner
- Address: 927, Jalan Mawar, Kampung Sungai Kayu Ara, 47400 Petaling Jaya, Selangor
- Phone: 017-316 2057
- Hours: Open 24 hours, 7 days a week
- Price range: RM 1 – RM 20 per person
- Services: Dine-in, Takeaway, Delivery (Grab & Foodpanda)

MENU:
Breakfast / All Day:
- Roti Canai – RM 1.50
- Roti Telur – RM 2.50
- Nasi Lemak (Basic) – RM 3.00
- Nasi Lemak Special (with fried chicken) – RM 7.00
- Mihun Sup – RM 5.00
- Teh Tarik – RM 2.00
- Milo Ais – RM 2.50
- Kopi O – RM 1.50

Mains:
- Nasi Goreng Ayam – RM 7.00
- Nasi Goreng Kampung – RM 8.00
- Mee Goreng – RM 7.00
- Mihun Goreng – RM 7.00
- Sup Ekor – RM 12.00
- Sup Tulang – RM 10.00

Satay (min 10 sticks):
- Sate Ayam – RM 0.80/stick
- Sate Daging – RM 1.00/stick

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
- Real-time wait times — say "Boleh call kami di 017-316 2057 untuk tanya terus 😊"
- Stock availability — same, redirect to call

Stay helpful, honest, and warm. You represent Farzana Corner.
`.trim();

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

// ── Notify owner ───────────────────────────────────────────
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

  await sendWhatsApp(ownerNumber, msg);
}

// ── Schedule follow-up after 30 minutes ───────────────────
function scheduleFollowUp(customerNumber, orderSummary) {
  pendingFollowUps[customerNumber] = { orderedAt: Date.now(), items: orderSummary };

  setTimeout(async () => {
    if (!pendingFollowUps[customerNumber]) return;
    delete pendingFollowUps[customerNumber];

    const followUpMsg =
      `Hi! Makanan dari Farzana Corner tadi okay tak? 😊\n\n` +
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

// ── Main webhook endpoint ──────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Acknowledge Twilio immediately (prevents retry)
  res.status(200).send("<Response></Response>");

  const incomingMsg = (req.body.Body || "").trim();
  const from = (req.body.From || "").replace("whatsapp:", "");

  if (!incomingMsg || !from) return;

  console.log(`[IN]  ${from}: ${incomingMsg}`);

  try {
    const history = getHistory(from);

    // Add user message to history
    history.push({ role: "user", content: incomingMsg });

    // Call Claude
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    let replyText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Add assistant reply to history
    history.push({ role: "assistant", content: replyText });

    // ── Parse special tags ────────────────────────────────
    const orderMatch = replyText.match(/\[ORDER_CONFIRMED:\s*(.+?)\]/);
    const complaintMatch = replyText.match(/\[COMPLAINT_FLAGGED:\s*(.+?)\]/);

    if (orderMatch) {
      const orderSummary = orderMatch[1].trim();
      replyText = replyText.replace(orderMatch[0], "").trim();
      await notifyOwner("ORDER", orderSummary, from);
      scheduleFollowUp(from, orderSummary);
    }

    if (complaintMatch) {
      const complaintDetail = complaintMatch[1].trim();
      replyText = replyText.replace(complaintMatch[0], "").trim();
      await notifyOwner("COMPLAINT", complaintDetail, from);
    }

    // ── Send reply to customer ────────────────────────────
    console.log(`[OUT] ${from}: ${replyText}`);
    await sendWhatsApp(from, replyText);

  } catch (err) {
    console.error("Error:", err.message);
    await sendWhatsApp(
      from,
      "Maaf, ada gangguan sekejap. Cuba lagi atau call kami di 017-316 2057 😊"
    );
  }
});

// ── Health check ───────────────────────────────────────────
app.get("/", (req, res) => res.send("Farzana Corner bot is running ✅"));

// ── Start server ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
