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
//  TIER + ALERT RECIPIENTS:
//  Add `tier: "Starter" | "Growth" | "Pro"`. It now controls features:
//    - Starter: alerts go to the owner only (even if alertNumbers is set);
//               no table reservations (the bot politely declines them)
//    - Growth:  alerts go to everyone in alertNumbers (owner + staff)
//    - Pro:     same as Growth, PLUS `customTone: "<how the bot should sound>"`
//               is applied to the bot's replies (ignored on other tiers)
//  No tier set = old behavior (used by demo configs).
//  For Starter (order/complaint alert to owner only), set `ownerWhatsapp`
//  as above. For Growth ("owner + staff group" as pitched), set
//  `alertNumbers: ["<owner number>", "<staff number 1>", ...]` instead —
//  each person gets their own individual WhatsApp message, since the
//  Meta Cloud API cannot post into an actual WhatsApp group chat. If
//  `alertNumbers` is set it takes priority over `ownerWhatsapp`.
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

Drinks:
- Ham Leng Chat (signature house drink, refreshing, great for cutting through the spiciness of the sambal) – RM 9.90
- Salted Calamansi Soda – RM 9.90

Note: Free refill on Nasi Lemak Rice & Sambal Gajus, dine-in guests only. All prices exclude service charge.
    `.trim(),
  },

  // Demo for Secret Of Louisiana At The Lake (SS7, Petaling Jaya).
  // Details and dish names come from their Google Maps listing and the eat-all-you-can
  // pasta poster. No prices are listed on purpose (the poster may be out of date), so the
  // bot tells customers staff will confirm prices. Replace `menu` once the owner shares
  // the real menu. Demo config: no tier set, so reservations are allowed.
  secret_of_louisiana: {
    name: "Secret Of Louisiana At The Lake",
    // Order, reservation and complaint alerts for this demo go to this number
    // (+60 17-979 1132) so Ethan can screen-record the demo end to end.
    alertNumbers: ["60179791132"],
    noDelivery: true,
    languageStyle: "english",
    assistantName: "Hana",
    address: "D-01, 01, Jalan SS 7/13a, SS 7, 47301 Petaling Jaya, Selangor",
    phone: "014-698 0452",
    hours: "Staff will confirm opening hours (eat-all-you-can pasta is served 11:30 AM to 3:00 PM)",
    priceRange: "RM 20 – RM 40 per person",
    services: "Dine-in and takeaway only (no delivery). Lakeside American Cajun restaurant. Table reservations are taken through WhatsApp.",
    menu: `
Popular dishes:
- Fisherman Seafood Aglio Olio
- Seafood Gumbo
- Louisiana's Style Chicken Chop
- Fresh & Wild Mushroom Soup
- Fiesta Fillet Mignon
- French Quarter Escargot
- Clam & Mussel Risotto
- Jerky Jerk Chicken
- Mango & Smoked Duck Salad
- Fiery Soft Shell Crab Pasta
- Sweet Corn & Crab Soup
- Chip & Salsa
- Buffalo Wings
- Smoked Salmon Pizza
- Roasted Chili Smoked Duck Pizza
- Smoked Duck Chili Spaghetti
- Creole Grilled Seafood Platter
- Garlic Toast Bread

Eat-All-You-Can Pasta (11:30 AM to 3:00 PM). Choose from:
Mexican Aglio Olio, Chicken Smoked Sausage, Beef Bolognaise, Spinach Tortellini, Chicken Carbonara, Creamy Pesto Fish, Cajun Garlic Shrimp, Vongole Clam, Pasta Chicken Meatball, Chicken Gravy Lasagna, Chili Smoked Duck, Penne Baked Turkey Ham, Chicken Bolognaise, Broccoli Fettuccine, Macaroni & Cheese (new).
Free flow: ice lemon tea, soup of the day, garlic toast, garden green salad, brewed coffee and tea, potato salad, and one cup of ice cream.
Buffet rules: strictly no sharing; children are priced by height; a surcharge applies on weekends and public holidays; wastage is charged by weight; prices are subject to SST and service charge.

Prices are NOT listed here. Do not quote any price. If asked, say the team will confirm current prices.
    `.trim(),
  },

  // Demo for Nick's Grill & Kitchen (Putra Heights, Subang Jaya).
  // Address, phone, hours, menu and prices come from their Google Maps listing (menu
  // images, Jul 2026) and their lunch / office-delivery posters. Group reservation
  // requests are enabled for the demo (no tier set); staff confirm every booking.
  nicks_grill: {
    name: "Nick's Grill & Kitchen",
    languageStyle: "english",
    assistantName: "Hana",
    address: "17G, Jalan Putra Mahkota 7/6b, Putra Heights, 47650 Subang Jaya, Selangor",
    phone: "018-381 4255",
    hours: "Wednesday to Monday, lunch 12:00 PM to 3:00 PM and dinner 5:00 PM to 10:00 PM (Saturday dinner until 12:00 AM). Closed on Tuesdays.",
    priceRange: "RM 20 – RM 40 per person",
    services: "Dine-in and takeaway. Free office lunch delivery in Putra Heights only, for 5 orders and above (pre-order for your team). Serves both vegetarian and non-vegetarian food. Group and birthday reservations can be requested and staff will confirm.",
    menu: `
LUNCH SETS (Wednesday to Monday, 12:00 PM to 2:30 PM, free drink with every set):
- Local Favourites RM12.90: Nasi Goreng Ayam / Vegetarian Fried Rice / Spicy Masala Sausages & Egg
- Pasta Favourites RM16.90 (veg or non-veg): Aglio e Olio / Spicy Arrabbiata / Creamy Tomato Pasta
- Chicken Perattal RM18.90 (with rice or toasties)
- Grilled Chicken Chop RM23.90 (original or BBQ)
- Mutton Masala Fried Rice RM23.90 (veg or non-veg)
Lunch set prices are nett, inclusive of 10% service charge, no SST.
Do NOT call any dish popular, a bestseller, a favourite or a crowd pleaser. The menu does not say which dishes sell best. When asked for recommendations, suggest a few dishes neutrally by taste or type (for example spicy, mild, vegetarian, good to share) and ask what the group likes.
FREE OFFICE LUNCH DELIVERY: Putra Heights only, for 5 orders and above, pre-order for your team, free drink with every set. Delivery is ONLY for this. Otherwise it is dine-in or takeaway.
If the customer has already said it is an office or team pre-order in Putra Heights for 5 or more orders, treat the order as FREE DELIVERY. Do NOT ask "dine-in or takeaway". Instead ask for the delivery address and the delivery time, then confirm.
Use plain English only. Say "spicy or not spicy", never "tak pedas" or other Malay words.

STARTERS: S1 Spicy Anchovies with Onions RM15.90; S2 Spicy Masala Sausage with Eggs RM13.90; S3 Chicken 65 RM15.90; S4 Spicy Chicken Perattal with Toasties RM21.90; S5 Spicy Mutton Perattal with Toasties RM27.90; S6 Chicken Popcorn (spicy or original) RM15.90; S7 Chicken Nuggets RM12.90; S8 French Fries RM9.00; S9 Fried Enoki Mushroom (spicy or original) RM12.90; S10 Fish Fingers RM20.90; S11 Chicken Wings RM15.90

CHOPS (choice of blackpepper or mushroom sauce): C1 Crispy Chicken Chop RM25.90; C2 Grilled Chicken Chop (original or BBQ) RM27.90; C3 Grilled Lamb Chop RM33.90
BURGERS: B1 Crispy Chicken Burger (original or BBQ) RM25.90; B2 Grilled Chicken Burger RM24.90; B3 Fish and Chips RM30.90

INDIAN MASALA MOSAIC: I1 Chicken Masala Fried Rice RM21.90; I2 Mutton Masala Fried Rice RM26.90; I3 Chicken Satti Soru (claypot) RM22.90; I4 Mutton Satti Soru (claypot) RM26.90; I5 Spicy Chicken Perattal with Rice RM20.90; I6 Spicy Mutton Perattal with Rice RM27.90

PASTA: Q1 Chicken Alfredo RM21.90; Q2 Chicken Spicy Arrabbiata RM19.90; Q3 Chicken Creamy Tomato RM16.00; Q4 Chicken Buttermilk RM18.90; Q5 Chicken Creamy Salted Egg RM19.90; Q6 Chicken Aglio e Olio RM18.00
PIZZA: P1 Hawaiian Chicken RM23.90; P2 Mutton Varuval RM26.90; P3 Chicken BBQ RM24.90; V6 Margherita (vegetarian) RM21.90

VEGETARIAN: V1 Vege Alfredo Pasta RM19.90; V2 Vege Aglio e Olio RM17.00; V3 Vege Buttermilk Pasta RM19.90; V4 Vege Creamy Salted Egg Pasta RM19.90; V5 Vege Spicy Arrabbiata RM19.90; V6 Margherita Pizza RM21.90; V7 Vege Creamy Salted Egg with Rice RM19.90; V8 Vege Chicken Buttermilk with Rice RM19.90; V9 Vegetarian Fried Rice RM13.00; V10 Vege Mutton Masala Fried Rice RM22.90; V11 Vege Chicken Masala Fried Rice RM22.90; V12 Spicy Vege Chicken Perattal with Toasties or Rice RM21.00; V13 Spicy Vege Mutton Perattal with Toasties or Rice RM25.00; V14 Vege Burger RM16.00

KID'S MEAL RM9.90 (served with a drink, Yakult or chocolate milk): K1 Mac & Cheese; K2 Alfredo Pasta; K3 Creamy Tomato Pasta; K4 Nuggets with Fries; K5 Sausages with Fries

BEVERAGES: W1 Honey Lemon RM5.90; W2 Lemon Juice RM3.00; W3 Ice Water RM1.00; W4 Warm Water RM0.50; W5 Infused Water RM2.00; Fresh Juices RM14.90 each (J1 Apple, J2 Orange, J3 Watermelon); Milkshakes RM16.90 each (M1 Vanilla, M2 Strawberry, M3 Chocolate, M4 Oreo)
    `.trim(),
  },

  // Catering demo for Golden Food Caterer (Taman Perindustrian Jaya, PJ).
  // businessType: "catering" switches the bot from meal ordering to EVENT ordering:
  // no spicy/dine-in questions, collects event date/pax/venue/dietary needs, never
  // quotes prices or holds dates, and skips the 30-minute "was the food okay?" follow-up.
  // NOTE: address, phone and the one named dish come from their Google Maps listing and
  // flyer. Replace `menu` with the owner's real packages/prices once he shares them.
  golden_caterer: {
    name: "Golden Food Caterer",
    businessType: "catering",
    languageStyle: "english", // English-first replies, English alerts and fallbacks
    assistantName: "Hana",
    address: "26, Jalan TPJ 10, Taman Perindustrian Jaya, 47200 Petaling Jaya, Selangor",
    phone: "019-649 2944",
    hours: "Office opens 9:00 AM (staff will confirm exact hours and any public holiday changes)",
    priceRange: "Quoted per event, depending on number of pax and menu",
    services: "Event catering with 40 years of experience, for celebrations and corporate or family events, including Indian and temple weddings (lunch or dinner). Buffet setup available.",
    menu: `
Known favourite:
- Keema Chicken Balls

TEMPLE WEDDING / INDIAN WEDDING MENU (lunch or dinner). The customer chooses dishes from each line below:
- Rice: Biryani Rice / White Rice
- Gravy and curry: Sambar / Veg Dalcha / Veg Kurma
- Tahu Sambal / Kicap / Varuval
- Cabbage Koothu / Parangikai Perattal
- Brinjal Sweet & Sour / Thimin Raita
- Inji Puli / Manga Sambal
- Appalam / Payasam
- Drinks: Lemon juice / Plain water
When a customer mentions a temple wedding, Indian wedding or similar, offer this menu, ask whether it is lunch or dinner, and ask which dishes they prefer from each line. Do NOT quote any per-pax price or promo for it, even if the customer has seen one on a flyer or online; say staff will confirm current pricing in the quotation.

Menu and packages are customised for each event. Staff will suggest dishes and prepare a quotation based on the number of pax, the type of event and the customer's budget.
Do not invent dishes, packages or prices that are not listed here. If a customer asks for specific dishes or prices, say staff will send the menu and quotation.
    `.trim(),
  },

  // Demo config for The Qiū Dining (Bukit Tinggi, Bentong, Pahang), linked to the Shizuku Coffee / Q Dining owner.
  // Menu transcribed from photos of the printed "AM Picks" and beverage cards. Some other menu photos show
  // higher prices on handwritten stickers (pizzas, sourdoughs, cheese toast), so confirm current prices
  // with the owner before showing this to him. noDelivery: Google lists dine-in and takeaway only.
  qiu_dining: {
    name: "The Qiū Dining",
    noDelivery: true,
    languageStyle: "english", // English-first replies with a little Malay mixed in
    assistantName: "Hana",
    address: "Geran Mukim 7509, No. Lot 28208, Bukit Tinggi, 28750 Bentong, Pahang",
    phone: "012-945 9455",
    hours: "Closes at 7:00 PM (staff will confirm opening hours)",
    priceRange: "RM 20 – RM 40 per person",
    services: "Dine-in and takeaway only (no delivery). Cafe in a nature setting in Bukit Tinggi.",
    menu: `
Malaysian Love:
- Nasi Lemak Fried Chicken (coconut rice, crispy spiced fried chicken, ikan bilis, kacang tanah, cucumber, sambal, egg) – RM 20
- Nasi Lemak Fried Sotong (golden fried sotong, coconut rice, ikan bilis, kacang tanah, cucumber, sambal, egg) – RM 26
- Nasi Lemak Fried Prawn (fried prawn meat, coconut rice, ikan bilis, kacang tanah, cucumber, sambal, egg) – RM 20

Oven-Loved Pizzas (10"):
- Classic Cheesy Delight (generous layer of gooey, melty cheese) – RM 22
- Chicken & Mushroom Medley (juicy chicken and earthy mushrooms on rich tomato sauce and cheese) – RM 28
- Ocean's Harvest Pizza (seafood toppings) – RM 30
- The Hawaiian's (sweet pineapple and savory ham) – RM 28

Flavors From The Wok:
- Tomyum Shrimp Fried Rice (fried rice with prawn meat, spring onions, tomyum flavors, egg) – RM 20
- Thai Basil Fried Rice (minced chicken, Thai basil, chilli padi, sunny-side-up egg) – RM 18

Bold N Spicy (each served with mashed potato, Pataje Joppie, cherry tomatoes, cucumber and purple cabbage cream):
- Chilli Lime Chicken Chop – RM 26
- Cumin Chicken Chop – RM 26
- Spicy Mala Chicken Chop – RM 26

Street Tacos:
- Crispy Chick Taco (golden fried chicken, cucumber, sambal mayo, soft taco) – RM 22
- Smokin' Quack Taco (smokey duck, cucumber, spicy sambal mayo, soft taco shell) – RM 20
- Sizzling Sausage Taco (juicy sausage, cucumber, creamy sambal mayo, soft taco) – RM 20

Artisanal Sourdoughs:
- Mushroom Melt Sourdough (shiitake mushrooms, mozzarella, cheddar, with straight-cut fries) – RM 26
- Smoky Peach Sourdough (smoked duck, scrambled egg, peach, honey mustard sauce) – RM 22
- Prawn & Peach Delight (scrambled egg, prawns, sweet peach, honey mustard sauce) – RM 26
- Sunny Sourdough (scrambled eggs on toasted sourdough, with straight-cut fries) – RM 24
- Ultimate Cheese Toast (sourdough stuffed with mozzarella and cheddar, with crispy fries) – RM 18

Morning Fix:
- The AM Spread (sourdough, scrambled eggs, chicken sausage, hashbrown, shiitake mushrooms) – RM 30
- Classic Kaya Toast Set (Hainan toast with butter and kaya, soft-boiled eggs) – RM 14

Sides:
- Arabiata Chicken Skewers (with red onion, capsicum, Beijing cabbage, Pataje Joppie sauce) – RM 22
- Crispy Sweet Potato Fries (with zesty Pataje Joppie sauce) – RM 20
- Breaded Scallop Bites (6 pcs, with Pataje Joppie sauce) – RM 22
- Classic Fries (with Pataje Joppie sauce) – RM 18

Classic Coffee (iced or hot): White – RM 13, Black – RM 11, Rose Latte – RM 14, Caramel Latte – RM 14, Mocha – RM 14
Chocolate / Matcha (iced or hot): Chocolate – RM 15, Matcha Latte – RM 15, Matcha Tea – RM 15
Soda: Peach Mango – RM 13, Passion Peach – RM 13, Strawberry Lychee – RM 13, Lychee Passion – RM 13
Juice: Orange – RM 15, Lemonade – RM 15, Apple – RM 15
Iced Tea: Lychee Rose – RM 16, Lemon – RM 16, Passion Strawberry – RM 16, Peach Orange Plum – RM 16
Hot Tea: English Breakfast – RM 14, Kiwiberry Oolong – RM 14, Lemongrass Ginger – RM 14, Earl Grey – RM 14
Curated Drinks: Autumn Leaves – RM 18, Matcha Cloud – RM 18, Fireworks – RM 22, Coffee Zest – RM 18

Desserts: Cakes of the month (customers can ask the servers or check the counter for this month's special cakes).
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

// Demo is pinned to Golden Food Caterer (was qiu_dining). To switch demos again, change this key (or use
// process.env.DEMO_RESTAURANT_ID || "generic" to go back to the env-var setup).
const DEMO_ID = "secret_of_louisiana";
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

// ── Demo routing by sender ─────────────────────────────────
// The demo number is shared, so a prospect who is trying it must not see another
// prospect's restaurant. Map a prospect's WhatsApp number (digits only, with country
// code) to the restaurant key they should see. Anyone not listed gets DEMO_ID.
const DEMO_SENDER_ROUTES = {
  "60146980452": "secret_of_louisiana", // Secret Of Louisiana At The Lake (manager)
  "60183814255": "nicks_grill",         // Nick's Grill & Kitchen (restaurant line)
  "60146458225": "nicks_grill",         // Nick's Grill & Kitchen (Pravinah, owner)
  "60196492944": "golden_caterer",      // Golden Food Caterer (Mr. Nuresh)
  "60129459455": "qiu_dining",          // The Qiu Dining (owner)
};

function getDemoRestaurantForSender(from) {
  const key = DEMO_SENDER_ROUTES[String(from || "").replace(/\D/g, "")];
  return key && RESTAURANTS[key] ? RESTAURANTS[key] : null;
}

function getRestaurantForIncoming(incomingPhoneNumberId) {
  if (incomingPhoneNumberId && PHONE_ID_TO_RESTAURANT[incomingPhoneNumberId]) {
    return PHONE_ID_TO_RESTAURANT[incomingPhoneNumberId];
  }
  // No match (demo number, or a client not yet given a dedicated number) — use fallback.
  return RESTAURANT;
}

// ── System prompt builder ───────────────────────────────────
function buildSystemPrompt(r) {
  const isCatering = r.businessType === "catering";
  const englishFirst = isCatering || r.languageStyle === "english";

  const spicyRule = englishFirst
    ? 'Always ask for spicy preference: "Would you like it spicy or not spicy?"'
    : 'Always ask for spicy preference: "Nak pedas tak, atau tak pedas?"';
  const noSpicyRule = englishFirst
    ? 'If customer says "no spicy" or "tak pedas" — acknowledge it clearly: "Okay, noted — not spicy! 👍"'
    : 'If customer says "no spicy" or "tak pedas" — acknowledge it clearly: "Okay, noted — tak pedas ye! 👍"';
  const stockEx = englishFirst
    ? "I can't check stock live, but you can still order and staff will confirm when preparing 😊"
    : "Stock tak sure real-time, tapi boleh order — nanti staff confirm bila prepare ye";
  const resDeclineEx = englishFirst
    ? "Sorry, we can't take reservations through this chat. You're welcome to drop by or contact the restaurant directly 😊"
    : "Maaf ye, kami tak boleh handle reservation kat chat ni — boleh datang terus atau contact restaurant terus 😊";
  const resConfirmEx = englishFirst
    ? "Okay, just to confirm: reservation for [name], [pax] people, [date] at [time]. Is that right?"
    : "Okay, confirm ye: Reservation untuk [name], [pax] orang, [date] jam [time]. Betul?";
  const resNotedEx = englishFirst
    ? "Noted! Our staff will confirm your table and WhatsApp you back 😊"
    : "Noted! Staff kami akan confirm meja untuk you, nanti kami WhatsApp balik ye 😊";

  const askType = r.noDelivery
    ? (englishFirst ? 'Always ask: "Dine-in or takeaway?" (we do not offer delivery)' : 'Always ask: "Dine-in atau takeaway?" (we do not offer delivery)')
    : (englishFirst ? 'Always ask: "Dine-in, takeaway, or delivery?"' : 'Always ask: "Dine-in, takeaway, atau delivery?"');
  const deliveryRule = r.noDelivery
    ? "We do not offer delivery. If a customer asks for delivery, politely tell them it is dine-in and takeaway only"
    : "For delivery: ask for full address";

  const orderingBlock = isCatering
    ? `ORDERING RULES — VERY IMPORTANT (CATERING / EVENT ORDERS):
This is a catering business, not a restaurant. Customers are booking food for an event, not ordering a single meal. Do NOT ask about spicy level or dine-in/takeaway.
1. Collect these event details, asking naturally a couple at a time (not a long form): customer name, type of event (wedding, corporate, family gathering, etc.), event date and time, venue or address, and number of pax
2. Ask about food preferences: veg, non-veg or both, any halal requirement, and any allergies or special requests
3. Ask what they have in mind for the menu or budget per pax. If they are unsure, offer to have staff suggest options
4. Ask if they need delivery only, or delivery with buffet setup and service staff
5. Never quote prices, packages or availability that are not in the MENU section. Say staff will prepare a quotation, e.g. "Our team will prepare a quotation based on pax and menu, then WhatsApp you back"
6. Repeat the full event details back and confirm before closing. This is critical
7. Never say the date is free, booked or confirmed. Only say the enquiry has been passed to staff to confirm

AFTER EVENT DETAILS ARE CONFIRMED:
- End your message with exactly this line on its own:
  [ORDER_CONFIRMED: <summary of the event order in one line>]
- Example: [ORDER_CONFIRMED: Wedding lunch buffet, 150 pax, 14 Dec 2026 12:00 PM, Shah Alam hall, veg + non-veg, halal, delivery + setup — Ravi]`
    : `ORDERING RULES — VERY IMPORTANT:
1. ${spicyRule}
2. Always confirm the full order back before closing: repeat items + special requests
3. ${askType}
4. ${deliveryRule}
5. ${noSpicyRule}
6. Never skip confirming special requests — this is critical
7. KEEP A RUNNING ORDER — critical. Remember EVERY dish and drink the customer has asked for since the start of this chat, with its quantity and choices (spicy or not, rice or toasties, sauce, size). When the customer adds something ("add...", "and...", "another..."), ADD it to the order and never drop what was already there. "Another X" means one more X on top of what they already have. Only change or remove an item if the customer clearly says so ("change", "remove", "cancel", "instead"). Every time you confirm, list the WHOLE order so far, one line per item with quantity and choices, not just the newest item. If a choice for an earlier item is already given (for example "toasties"), keep it and do not ask again. If you are unsure whether two mentions are the same dish or two different dishes, ask once, but never list the same dish twice unless the customer wants two. The final [ORDER_CONFIRMED: ...] line must contain every item.

AFTER ORDER IS CONFIRMED:
- End your message with exactly this line on its own:
  [ORDER_CONFIRMED: <summary of order in one line>]
- Example: [ORDER_CONFIRMED: Nasi Goreng Ayam x1 (tak pedas), Teh Tarik x1 — Takeaway]`;

  const unknownTail = isCatering
    ? `- Don't redirect the customer to call anyone. Be upfront but keep it simple: say you can't confirm that yourself, but take their event details anyway so staff can check and confirm
- Example: "I can't confirm the date myself, but I'll pass your details to our team and they'll confirm with you"
- Still follow the ORDERING RULES and end with [ORDER_CONFIRMED: ...] so staff sees exactly what the customer asked for — that's what saves them time, not a phone number`
    : `- Don't redirect the customer to call anyone. Instead, be upfront but keep it simple: say you can't confirm live stock, but take their order anyway so staff can check and confirm it
- Example: "${stockEx}"
- Still follow the normal ORDERING RULES below and end with [ORDER_CONFIRMED: ...] so staff sees exactly what was ordered and can quickly check/prepare it — that's what saves them time, not a phone number`;

  const cateringDateBlock = `DATE HOLDING / AVAILABILITY:
- You cannot check calendars, hold a date or confirm a booking. Only staff can
- If a customer asks whether a date is free or wants to book it, collect the event details above, then say the enquiry has been passed to staff who will confirm availability and send a quotation
- Never say a date is confirmed, booked or reserved, and never output a [RESERVATION_REQUESTED: ...] line
`;

  return `
You are ${r.assistantName}, the friendly WhatsApp assistant for ${r.name}${isCatering ? "" : " restaurant"}.

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
- ${englishFirst ? "Default to friendly, clear English with a little Malay mixed in (Manglish)" : "Default to friendly Bahasa Malaysia mixed with English (Manglish)"}
- Keep replies short, warm, and clear — like a friendly staff member texting on their phone, NOT like a formal AI assistant
- Use 😊 occasionally but don't overdo emojis
- Write like a real person casually texting: short sentences, natural contractions (takde, kot, jugak, ye)
- NEVER use bold headers, section titles, or emoji bullet icons (e.g. don't write "🍚 *Nasi:*" or "*Minuman:*") — just write it as normal flowing text or a simple plain list
- Don't over-explain or add unnecessary scripted closing lines (e.g. avoid stiff phrases like "Boleh saya tolong semak semula order you!") — just ask naturally, like "Nak order tak?" or "Confirm ke?"
- Avoid sounding overly polite or robotic — a little casual and imperfect is more natural than a perfectly structured message
${r.tier === "Pro" && r.customTone ? `
BRAND VOICE (this restaurant's own style — follow it for wording and personality):
${r.customTone}
- The brand voice only changes HOW you sound. It never overrides the ORDERING RULES, RESERVATION rules, or honesty rules below — never invent menu items, prices, or availability.
` : ""}
${orderingBlock}

COMPLAINTS:
- If a customer complains about food quality, wrong order, or bad experience:
  - Apologize sincerely and warmly first
  - Do NOT be defensive
  - End your message with: [COMPLAINT_FLAGGED: <one-line summary of complaint>]
  - Example: [COMPLAINT_FLAGGED: Customer received spicy food despite requesting tak pedas]

THINGS YOU DON'T KNOW:
- Real-time wait times or stock availability — you can't confirm these live${isCatering ? ", and also whether an event date is free, final prices or kitchen capacity (staff confirm these in the quotation)" : ""}
${unknownTail}

${isCatering ? cateringDateBlock : r.tier === "Starter" ? `TABLE RESERVATIONS — NOT AVAILABLE:
- This restaurant's plan does not include taking table reservations through this chat
- If a customer asks to book or reserve a table, politely say you can't take reservations here and suggest they come by directly or contact the restaurant directly, e.g. "${resDeclineEx}"
- Never collect reservation details, never promise or hint that a table is being held, and never output a [RESERVATION_REQUESTED: ...] line
` : `TABLE RESERVATION REQUESTS — VERY IMPORTANT:
- If a customer asks to book/reserve a table, collect: name, date, time, and number of pax (ask one by one or together, whichever flows naturally)
- Be honest: you cannot guarantee or confirm a table yourself — you can only pass the request to staff
- Once you have all the details, confirm them back in one message, e.g.:
  "${resConfirmEx}"
- After the customer confirms, reply warmly (e.g. "${resNotedEx}") and end your message with exactly this line on its own:
  [RESERVATION_REQUESTED: <name>, <pax> pax, <date> <time>]
- Example: [RESERVATION_REQUESTED: Ming, 4 pax, 6 Oct 8:00 PM]
- Never say the reservation is "confirmed" or "booked" — only that the request has been passed to staff
`}

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

// ── Notify owner/staff (uses Meta API — Twilio path is deprecated) ──
// Alert recipients come from restaurant.alertNumbers (array — supports
// Growth-tier "owner + staff", each gets their own individual WhatsApp
// message, since Meta Cloud API cannot message a WhatsApp group).
// Falls back to restaurant.ownerWhatsapp (single number, Starter tier),
// then to the global OWNER_WHATSAPP_NUMBER env var (demo fallback).
// Tier rule: Starter = owner only (ownerWhatsapp, or the first alertNumbers
// entry if only that is set). Growth / Pro / no tier set = every number in
// alertNumbers (existing behavior, so demo configs are unaffected).
async function notifyOwner(type, detail, customerNumber, restaurant) {
  let recipients = [];
  if (restaurant.tier === "Starter" && (restaurant.ownerWhatsapp || (Array.isArray(restaurant.alertNumbers) && restaurant.alertNumbers.length))) {
    recipients = [restaurant.ownerWhatsapp || restaurant.alertNumbers[0]];
  } else if (Array.isArray(restaurant.alertNumbers) && restaurant.alertNumbers.length) {
    recipients = restaurant.alertNumbers;
  } else if (restaurant.ownerWhatsapp) {
    recipients = [restaurant.ownerWhatsapp];
  } else if (process.env.OWNER_WHATSAPP_NUMBER) {
    recipients = [process.env.OWNER_WHATSAPP_NUMBER];
  }
  if (!recipients.length) return;

  let msg = "";
  if (type === "ORDER") {
    const isCatering = restaurant.businessType === "catering";
    msg =
      `🛎️ *${restaurant.languageStyle === "english" ? (isCatering ? "New Catering Order!" : "New Order!") : (isCatering ? "Order Catering Baru!" : "Pesanan Baru!")}*\n` +
      `Customer: wa.me/${customerNumber.replace("+", "")}\n` +
      `${isCatering ? "Event" : "Order"}: ${detail}\n` +
      `${restaurant.languageStyle === "english" ? "Time" : "Masa"}: ${new Date().toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}`;
  } else if (type === "COMPLAINT") {
    msg = restaurant.languageStyle === "english"
      ? `⚠️ *Customer Complaint*\n` +
        `Customer: wa.me/${customerNumber.replace("+", "")}\n` +
        `Issue: ${detail}\n` +
        `Please follow up as soon as possible!`
      : `⚠️ *Aduan Customer*\n` +
        `Customer: wa.me/${customerNumber.replace("+", "")}\n` +
        `Isu: ${detail}\n` +
        `Sila follow up segera!`;
  } else if (type === "RESERVATION") {
    msg = restaurant.languageStyle === "english"
      ? `📅 *New Reservation Request!*\n` +
        `Customer: wa.me/${customerNumber.replace("+", "")}\n` +
        `Detail: ${detail}\n` +
        `Please confirm the table and reply to the customer directly.`
      : `📅 *Reservation Baru!*\n` +
        `Customer: wa.me/${customerNumber.replace("+", "")}\n` +
        `Detail: ${detail}\n` +
        `Sila confirm meja & reply customer terus ye.`;
  }

  // NOTE: previously used the Twilio-based sendWhatsApp(), which throws
  // because Twilio credentials are no longer valid post Meta-migration.
  // That uncaught error was bubbling up and causing the CUSTOMER to see
  // a fallback "ada gangguan" message instead of their real order
  // confirmation. Switched to the working Meta sender + wrapped in
  // try/catch (per recipient) so one bad number, or a notify failure,
  // can never break the customer's reply or block other recipients.
  for (const number of recipients) {
    try {
      await sendWhatsAppMeta(number, msg, restaurant.phoneNumberId || PHONE_NUMBER_ID, restaurant.accessToken || META_ACCESS_TOKEN);
    } catch (err) {
      console.error(`❌ Failed to notify ${number}:`, err.message);
    }
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

// ── Log reservation request to the same sheet as orders, tagged
// distinctly (status: "New Reservation") so it's filterable. A proper
// separate "Reservations" tab would need its own Zapier Sheet action —
// not something settable from code, so this reuses the existing one. ──
async function logReservationToSheet(reservationSummary, customerNumber, restaurant) {
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
        order_summary: `[RESERVATION] ${reservationSummary}`,
        status: "New Reservation",
      }),
    });
  } catch (err) {
    console.error("❌ Failed to log reservation to sheet:", err.message);
  }
}

// ── Detect which language the customer is actually writing in ──
// Looks only at the customer's own messages. Defaults to English; switches to
// Malay only if the customer used clear Malay words.
const MALAY_WORDS = /\b(nak|tak|boleh|saya|sy|aku|kami|korang|awak|kita|dan|dengan|untuk|tolong|terima kasih|tq|makan|minum|pesan|pesanan|tempah|berapa|harga|sila|ye|je|lah|kah|tak nak|ada|apa|macam|mana|bila|pukul|malam|petang|hantar|ambil|bungkus|sedap|banyak|lagi|dah|belum|sekarang|esok|hari ini|boleh tak)\b/i;

function detectCustomerLanguage(customerNumber) {
  const history = getHistory(customerNumber) || [];
  const customerMsgs = history
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .slice(-6)
    .map((m) => m.content);
  const malayHits = customerMsgs.filter((m) => MALAY_WORDS.test(m)).length;
  return malayHits > customerMsgs.length / 2 ? "ms" : "en";
}

// ── Schedule follow-up after 30 minutes ───────────────────
function scheduleFollowUp(customerNumber, orderSummary, restaurant) {
  pendingFollowUps[customerNumber] = { orderedAt: Date.now(), items: orderSummary };

  // Decide language NOW (conversation history may expire before the timer fires)
  const lang = detectCustomerLanguage(customerNumber);

  setTimeout(async () => {
    if (!pendingFollowUps[customerNumber]) return;
    delete pendingFollowUps[customerNumber];

    const followUpMsg = lang === "ms"
      ? `Hi! Makanan dari ${restaurant.name} tadi okay tak? 😊\n\n` +
        `Kami harap semua sedap dan mengikut pesanan korang. ` +
        `Kalau ada apa-apa yang tak kena, bagitahu kami ye — ` +
        `kami nak pastikan korang puas hati! 🙏`
      : `Hi! How was your meal from ${restaurant.name}? 😊\n\n` +
        `We hope everything was delicious and exactly as you ordered. ` +
        `If anything wasn't right, just let us know — ` +
        `we want to make sure you're happy! 🙏`;

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
  const reservationMatch = replyText.match(/\[RESERVATION_REQUESTED:\s*(.+?)\]/);

  if (orderMatch) {
    const orderSummary = orderMatch[1].trim();
    replyText = replyText.replace(orderMatch[0], "").trim();
    await notifyOwner("ORDER", orderSummary, from, restaurant);
    await logOrderToSheet(orderSummary, from, restaurant);
    // Catering orders are for a future event, so the "was the food okay?" check-in does not apply
    if (restaurant.businessType !== "catering") scheduleFollowUp(from, orderSummary, restaurant);
  }

  if (complaintMatch) {
    const complaintDetail = complaintMatch[1].trim();
    replyText = replyText.replace(complaintMatch[0], "").trim();
    await notifyOwner("COMPLAINT", complaintDetail, from, restaurant);
  }

  if (reservationMatch) {
    const reservationSummary = reservationMatch[1].trim();
    replyText = replyText.replace(reservationMatch[0], "").trim();
    if (restaurant.tier === "Starter" || restaurant.businessType === "catering") {
      // Starter plan has no reservations (and catering uses event orders instead). The prompt already tells the bot not
      // to emit this tag; if it slips through, drop it rather than alert staff.
      console.warn(`⚠️ Reservation tag ignored for Starter-tier restaurant: ${restaurant.name}`);
    } else {
      await notifyOwner("RESERVATION", reservationSummary, from, restaurant);
      await logReservationToSheet(reservationSummary, from, restaurant);
    }
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
    const incomingRestaurant = getRestaurantForIncoming(incomingPhoneNumberId);

    for (const message of messages) {
      const from = message.from;
      const incomingMsg = message.text?.body;
      if (!from || !incomingMsg) continue;

      // Shared demo number only: show this sender their own restaurant if they are mapped.
      const restaurant = (incomingRestaurant === RESTAURANT && getDemoRestaurantForSender(from)) || incomingRestaurant;

      console.log(`[IN-META] (${restaurant.name}) ${from}: ${incomingMsg}`);
      try {
        const replyText = await generateReply(from, incomingMsg, restaurant);
        await sendWhatsAppMeta(from, replyText, incomingPhoneNumberId || PHONE_NUMBER_ID, restaurant.accessToken || META_ACCESS_TOKEN);
      } catch (err) {
        console.error("Error handling Meta message:", err.message);
        await sendWhatsAppMeta(
          from,
          (restaurant.languageStyle === "english" ? `Sorry, we had a small hiccup. Please try again or call us at ${restaurant.phone} 😊` : `Maaf, ada gangguan sekejap. Cuba lagi atau call kami di ${restaurant.phone} 😊`),
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
    await sendWhatsApp(from, (RESTAURANT.languageStyle === "english" ? `Sorry, we had a small hiccup. Please try again or call us at ${RESTAURANT.phone} 😊` : `Maaf, ada gangguan sekejap. Cuba lagi atau call kami di ${RESTAURANT.phone} 😊`));
  }
});

// ── Health check ───────────────────────────────────────────
app.get("/", (req, res) => res.send(`${RESTAURANT.name} bot is running ✅`));

// ── Start server ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
