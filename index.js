require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const TOKEN = process.env.DISCORD_TOKEN;
const FREE_WEBHOOK = process.env.FREE_WEBHOOK;
const FREE_ROLE_ID = "1509514820913729557";

// Use a persistent volume path in production (set DATA_DIR=/data in Railway),
// falls back to the local folder when running on your machine.
const NOTIFIED_FILE = path.join(process.env.DATA_DIR || __dirname, "notified.json");

let notifiedItems = new Set();
let initialized = false;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
}).listen(process.env.PORT || 10000, () => {
  console.log(`HTTP server listening on port ${process.env.PORT || 10000}`);
});

function loadNotified() {
  try {
    if (fs.existsSync(NOTIFIED_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8"));
      notifiedItems = new Set(data);
      console.log(`Loaded ${notifiedItems.size} previously notified items from ${NOTIFIED_FILE}`);
    } else {
      console.log(`No existing notified file found at ${NOTIFIED_FILE}, starting fresh`);
    }
  } catch (e) {
    console.error("Error loading notified file:", e.message);
  }
}

function saveNotified() {
  try {
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notifiedItems]));
  } catch (e) {
    console.error("Error saving notified file:", e.message);
  }
}

async function checkFreeUGC() {
  try {
    const res = await axios
      .get("https://catalog.roblox.com/v1/search/items/details", {
        params: {
          salesTypeFilter: 1, // items currently for sale
          minPrice: 0,
          maxPrice: 0,
          limit: 30,
          sortType: 6 // RecentlyCreated
        },
        timeout: 10000
      })
      .catch((e) => {
        console.error("Error fetching catalog items:", e.message);
        return null;
      });

    if (!res?.data?.data) return;

    // Only genuinely limited items: free (price 0) AND a capped total quantity.
    // Ordinary permanent free items (e.g. default emotes) report totalQuantity: 0.
    const items = res.data.data.filter(
      (item) => item.price === 0 && item.totalQuantity > 0
    );

    let addedAny = false;

    for (const item of items) {
      const id = item.id.toString();
      if (notifiedItems.has(id)) continue;

      notifiedItems.add(id);
      addedAny = true;

      if (!initialized) continue;

      const img = `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png`;

      await axios
        .post(FREE_WEBHOOK, {
          content: `<@&${FREE_ROLE_ID}> **NEW FREE LIMITED UGC DETECTED!**`,
          embeds: [
            {
              title: item.name,
              url: `https://www.roblox.com/catalog/${id}`,
              color: 0x00ff00,
              fields: [
                { name: "Quantity", value: item.totalQuantity.toString(), inline: true },
                { name: "From", value: "Roblox Catalog", inline: true }
              ],
              image: { url: img },
              footer: { text: `ID: ${id}` },
              timestamp: new Date().toISOString()
            }
          ]
        })
        .then(() => console.log(`Notified about new item: ${item.name} (${id})`))
        .catch((e) => console.error(`Error posting webhook for item ${id}:`, e.message));

      await new Promise((r) => setTimeout(r, 1500));
    }

    if (addedAny) saveNotified();
    initialized = true;
  } catch (e) {
    console.error("checkFreeUGC error:", e.message);
  }
}

cron.schedule("* * * * *", checkFreeUGC);

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadNotified();
  await checkFreeUGC();
  console.log("Initial UGC check complete, cron scheduled to run every minute");
});

client.login(TOKEN).catch((e) => {
  console.error("Failed to log in to Discord:", e.message);
});
