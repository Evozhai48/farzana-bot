// ============================================================
//  BotRental MY — Multi-Tenant WhatsApp Chatbot
//  Meta WhatsApp Cloud API  →  Claude API  →  Auto-reply
//
//  TRUE MULTI-TENANCY: one deployment can now serve many paying
//  clients at once. Each incoming message tells us which Meta
//  phone_number_id it arrived on; we look that ID up in RESTAURANTS
//  and reply as that specific client. Add a `phoneNumberId` (and
//  optionally `ownerWhatsapp`) to a restaurant's config once their
//  own WhatsApp number is registered in Meta Business Manager —
//  no other code changes or redeploys needed to onboard them.
//
//  BRING-YOUR-OWN META ACCOUNT: a client can also register their
//  number under their OWN Meta Business Manager/WABA (their own
//  card on file, their own messaging costs) instead of yours. In
//  that case also set `accessToken` on their config to the token
//  they generated (or granted via partner access) for their WABA —
//  otherwise the shared META_ACCESS_TOKEN is used, which only
//  works for numbers living inside YOUR Business Manager.
//
//  DEMO_RESTAURANT_ID is kept as a fallback: if an incoming
//  phone_number_id doesn't match any configured client (e.g. the
//  shared demo number, or a client not yet given their own number),
//  the bot falls back to whichever restaurant DEMO_RESTAURANT_ID
//  points to. This preserves the old single-tenant demo behavior.
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

async function sendWhatsAppMeta(to, text, phoneNumberId = PHONE_NUMBER_ID, accessToken = META_ACCESS_TOKEN) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
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
//
//  DEMO / TRIAL clients (no dedicated WhatsApp number yet):
//  leave `phoneNumberId` unset. Set DEMO_RESTAURANT_ID=<key>
//  (DigitalOcean env var) to make them the fallback restaurant.
//
//  LIVE PAYING clients (own number registered in Meta Business
//  Manager): add `phoneNumberId: "<their Meta phone_number_id>"`
//  and, optionally, `ownerWhatsapp: "<owner's WhatsApp number>"`.
//  The bot will then route their customers' messages to this
//  config automatically — no env var change, no redeploy, no new
//  $5/month server. Just add the entry and it's live.
//
//  If the client registered their number under THEIR OWN Meta
//  Business Manager (their own card on file) instead of yours,
//  also add `accessToken: "<their WABA access token>"` — either a
//  System User token they generated themselves, or the token you
//  get once they've added you as a partner on their account. Leave
//  it unset for clients living inside your own Business Manager.
//
//  Default fallback is "generic" (blank template) instead of
//  "farzana" — fill in the bracketed fields live during a call,
//  or add a new named key per prospect. "farzana" is kept below
//  as a saved reference config, not the active default.
// ============================================================
const RESTAURANTS = {
  farzana: {
    name: "Farzana Corner",
    assistantName: "Hana",
    // phoneNumberId: "<Meta phone_number_id once they go live>",
    // ownerWhatsapp: "<owner's WhatsApp number for order/complaint alerts>",
    // accessToken: "<only if this client uses their OWN Meta Business Manager>",
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
  gepuklah: {
    name: "Gepuklah by mingchuun",
    assistantName: "Hana",
    address: "No.27, Ground Floor, Jalan SS 22/11, Damansara Jaya, 47400 Petaling Jaya, Selangor",
    phone: "03-8723 8801",
    hours: "11:00 AM – 9:00 PM, Closed Mondays",
    priceRange: "RM 6 – RM 26 per person",
    services: "Dine-in only (no takeaway/delivery currently)",
    menu: `
Signature Bowls:
- Mingchuun's Bowl (Boneless Ayam Gepuk + Mushroom + Kubis + Bayam) – RM 25.90
- Boneless Ayam Gepuk (crispy boneless chicken thigh, savoury peppery crust, nasi lemak rice, sambal gajus, bayam goreng, tempeh & timun, sunny-side-up egg) – RM 18.90
- Smoked Duck Gepuk (smoked duck, nasi lemak rice, sambal gajus, bayam goreng, tempeh & timun, sunny-side-up egg) – RM 24.90
- Crispy Oyster Mushroom Gepuk (crispy oyster mushroom, nasi lemak rice, sambal gajus, bayam goreng, tempeh & timun, sunny-side-up egg) – RM 17.90

Upgrade Your Bowl:
- Extra Sunny-Side-Up Egg – RM 1.90
- Extra Bayam Goreng – RM 3.90
- Extra Boneless Chicken Thigh – RM 8.90
- Extra Crispy Oyster Mushroom – RM 7.90
- Extra Smoked Duck Breast – RM 14.90

Sides (a la carte):
- Oyster Mushroom – RM 9.90
- Kubis Goreng (Thinly Sliced Fried Cabbage) – RM 5.90
- Boneless Fried Chicken – RM 10.90
- Bayam Goreng – RM 6.90
- Sunny-Side-Up Egg – RM 2.90

Note: Free refill on Nasi Lemak Rice & Sambal Gajus, dine-in guests only. All prices exclude service charge.
    `.trim(),
  },

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
console.log(`🏪 Fallback/demo restaurant: ${RESTAURANT.name} (key: ${DEMO_ID})`);

// ── Multi-tenant routing: which restaurant does this number belong to? ──
// Build once at startup: Meta phone_number_id -> restaurant config,
// for every client who has been given their own WhatsApp number.
const PHONE_ID_TO_RESTAURANT = {};
for (const r of Object.values(RESTAURANTS)) {
  if (r.phoneNumberId) PHONE_ID_TO_RESTAURANT[r.phoneNumberId] = r;
}
const liveClientCount = Object.keys(PHONE_ID_TO_RESTAURANT).length;
console.log(
  liveClientCount > 0
    ? `📡 Routing ${liveClientCount} live client number(s) by phone_number_id.`
    : `📡 No live client numbers configured yet — every message uses the fallback restaurant above.`
);

function getRestaurantForIncoming(incomingPhoneNumberId) {
  if (incomingPhoneNumberId && PHONE_ID_TO_RESTAURANT[incomingPhoneNumberId]) {
    return PHONE_ID_TO_RESTAURANT[incomingPhoneNumberId];
  }
  // No match (demo number, or a client not yet given a dedicated number) — use fallback.
  return RESTAURANT;
}

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

LANGUAGE & TONE:
- Reply in the same language the customer uses
- Default to friendly Bahasa Malaysia mixed with English (Manglish)
- Keep replies short, warm, and clear — like a friendly staff member texting on their phone, NOT like a formal AI assistant
- Use 😊 occasionally but don't overdo emojis
- Write like a real person casually texting: short sentences, natural contractions (takde, kot, jugak, ye)
- NEVER use bold headers, section titles, or emoji bullet icons (e.g. don't write "🍚 *Nasi:*" or "*Minuman:*") — just write it as normal flowing text or a simple plain list
- Don't over-explain or add unnecessary scripted closing lines (e.g. avoid stiff phrases like "Boleh saya tolong semak semula order you!") — just ask naturally, like "Nak order tak?" or "Confirm ke?"
- Avoid sounding overly polite or robotic — a little casual and imperfect is more natural than a perfectly structured message

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
- Real-time wait times or stock availability — you can't confirm these live
- Don't redirect the customer to call anyone. Instead, be upfront but keep it simple: say you can't confirm live stock, but take their order anyway so staff can check and confirm it
- Example: "Stock tak sure real-time, tapi boleh order — nanti staff confirm bila prepare ye"
- Still follow the normal ORDERING RULES below and end with [ORDER_CONFIRMED: ...] so staff sees exactly what was ordered and can quickly check/prepare it — that's what saves them time, not a phone number

Stay helpful, honest, and warm. You represent ${r.name}.
`.trim();
}

// Cache the built system prompt per restaurant (keyed by object identity)
// so we're not rebuilding the same long string on every incoming message.
const systemPromptCache = new Map();
function getSystemPrompt(r) {
  if (!systemPromptCache.has(r)) systemPromptCache.set(r, buildSystemPrompt(r));
  return systemPromptCache.get(r);
}

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
async function notifyOwner(type, detail, customerNumber, restaurant) {
  const ownerNumber = restaurant.ownerWhatsapp || process.env.OWNER_WHATSAPP_NUMBER;
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
    await sendWhatsAppMeta(ownerNumber, msg, restaurant.phoneNumberId || PHONE_NUMBER_ID, restaurant.accessToken || META_ACCESS_TOKEN);
  } catch (err) {
    console.error("❌ Failed to notify owner:", err.message);
  }
}

// ── Log order to Google Sheet via Zapier webhook ────────────
const ZAPIER_ORDER_WEBHOOK_URL = process.env.ZAPIER_ORDER_WEBHOOK_URL;

async function logOrderToSheet(orderSummary, customerNumber, restaurant) {
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
        restaurant: restaurant.name,
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
function scheduleFollowUp(customerNumber, orderSummary, restaurant) {
  pendingFollowUps[customerNumber] = { orderedAt: Date.now(), items: orderSummary };

  setTimeout(async () => {
    if (!pendingFollowUps[customerNumber]) return;
    delete pendingFollowUps[customerNumber];

    const followUpMsg =
      `Hi! Makanan dari ${restaurant.name} tadi okay tak? 😊\n\n` +
      `Kami harap semua sedap dan mengikut pesanan korang. ` +
      `Kalau ada apa-apa yang tak kena, bagitahu kami ye — ` +
      `kami nak pastikan korang puas hati! 🙏`;

    try {
      // NOTE: this used to call the old Twilio-based sendWhatsApp(), which
      // throws because Twilio credentials are no longer valid post-Meta
      // migration — the same bug already fixed in notifyOwner(). Switched
      // to the working Meta sender, from this restaurant's own number
      // when it has one.
      await sendWhatsAppMeta(customerNumber, followUpMsg, restaurant.phoneNumberId || PHONE_NUMBER_ID, restaurant.accessToken || META_ACCESS_TOKEN);
    } catch (err) {
      console.error("Follow-up failed:", err.message);
    }
  }, 30 * 60 * 1000); // 30 minutes
}

// — Shared Claude reply logic (used by both Twilio and Meta) ————————————
async function generateReply(from, incomingMsg, restaurant) {
  const history = getHistory(from);
  history.push({ role: "user", content: incomingMsg });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: getSystemPrompt(restaurant),
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
    await notifyOwner("ORDER", orderSummary, from, restaurant);
    await logOrderToSheet(orderSummary, from, restaurant);
    scheduleFollowUp(from, orderSummary, restaurant);
  }

  if (complaintMatch) {
    const complaintDetail = complaintMatch[1].trim();
    replyText = replyText.replace(complaintMatch[0], "").trim();
    await notifyOwner("COMPLAINT", complaintDetail, from, restaurant);
  }

  return replyText;
}

// — Main webhook endpoint (handles both Meta and legacy Twilio formats) —
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // --- Meta WhatsApp Cloud API format ---
  if (body.object === "whatsapp_business_account") {
    res.sendStatus(200);
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages;
    if (!messages) return;

    // This is the multi-tenant routing step: Meta tells us which of our
    // registered numbers this message arrived on. We use that to pick
    // the matching client — every reply, notification, order log, and
    // follow-up for this message uses THIS restaurant, not the global one.
    const incomingPhoneNumberId = value?.metadata?.phone_number_id;
    const restaurant = getRestaurantForIncoming(incomingPhoneNumberId);

    for (const message of messages) {
      const from = message.from;
      const incomingMsg = message.text?.body;
      if (!from || !incomingMsg) continue;

      console.log(`[IN-META] (${restaurant.name}) ${from}: ${incomingMsg}`);
      try {
        const replyText = await generateReply(from, incomingMsg, restaurant);
        await sendWhatsAppMeta(from, replyText, incomingPhoneNumberId || PHONE_NUMBER_ID, restaurant.accessToken || META_ACCESS_TOKEN);
      } catch (err) {
        console.error("Error handling Meta message:", err.message);
        await sendWhatsAppMeta(
          from,
          `Maaf, ada gangguan sekejap. Cuba lagi atau call kami di ${restaurant.phone} 😊`,
          incomingPhoneNumberId || PHONE_NUMBER_ID,
          restaurant.accessToken || META_ACCESS_TOKEN
        );
      }
    }
    return;
  }

  // --- Legacy Twilio format (deprecated — single-tenant only, always the
  //     fallback restaurant, since Twilio has no equivalent of Meta's
  //     phone_number_id to route by) ---
  res.status(200).send("<Response></Response>");
  const incomingMsg = (req.body.Body || "").trim();
  const from = (req.body.From || "").replace("whatsapp:", "");
  if (!incomingMsg || !from) return;

  console.log(`[IN-TWILIO] ${from}: ${incomingMsg}`);
  try {
    const replyText = await generateReply(from, incomingMsg, RESTAURANT);
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
