import Fastify from "fastify";
import cors from "@fastify/cors";
import Anthropic from "@anthropic-ai/sdk";
import { OurGroceriesClient } from "./ourgroceries.mjs";

const PORT = parseInt(process.env.OG_PORT || "3456", 10);
const HOST = process.env.OG_HOST || "0.0.0.0";
const OG_USERNAME = process.env.OG_USERNAME;
const OG_PASSWORD = process.env.OG_PASSWORD;
const API_KEY = process.env.OG_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

if (!OG_USERNAME || !OG_PASSWORD) {
  console.error("OG_USERNAME and OG_PASSWORD env vars are required.");
  process.exit(1);
}

const og = new OurGroceriesClient(OG_USERNAME, OG_PASSWORD);
const app = Fastify({ logger: true });

await app.register(cors, { origin: true, methods: ["GET", "POST", "DELETE"] });

// Auth middleware — checks header, or ?apiKey, or ?key query param
app.addHook("onRequest", async (request, reply) => {
  if (API_KEY) {
    const url = new URL(request.url, "http://localhost");
    const provided = request.headers["x-api-key"] || url.searchParams.get("apiKey") || url.searchParams.get("key");
    if (provided !== API_KEY) {
      reply.code(401).send({ error: "Invalid or missing API key" });
    }
  }
});

// Health check
app.get("/health", async () => ({ status: "ok" }));

// GET /lists
app.get("/lists", async (_req, reply) => {
  try {
    return { lists: await og.getLists() };
  } catch (err) {
    reply.code(500).send({ error: String(err) });
  }
});

// GET /lists/:id/items
app.get("/lists/:id/items", async (req, reply) => {
  try {
    return { items: await og.getListItems(req.params.id) };
  } catch (err) {
    reply.code(500).send({ error: String(err) });
  }
});

// POST /lists/:id/items
app.post("/lists/:id/items", async (req, reply) => {
  try {
    const { items, autoCategory = true } = req.body;
    const listId = req.params.id;
    const results = [];
    for (const item of items) {
      const name = typeof item === "string" ? item : item.name;
      const note = typeof item === "string" ? undefined : item.note;
      await og.addItemToList(listId, name, { autoCategory, note });
      results.push(name);
    }
    return { added: results.length, items: results };
  } catch (err) {
    reply.code(500).send({ error: String(err) });
  }
});

// POST /lists/add-by-name
app.post("/lists/add-by-name", async (req, reply) => {
  try {
    const { listName, items, autoCategory = true } = req.body;
    const list = await og.findListByName(listName);
    if (!list) {
      const allLists = await og.getLists();
      return reply.code(404).send({
        error: "List \"" + listName + "\" not found",
        availableLists: allLists.map(l => l.name)
      });
    }
    const results = [];
    for (const item of items) {
      const name = typeof item === "string" ? item : item.name;
      const note = typeof item === "string" ? undefined : item.note;
      await og.addItemToList(list.id, name, { autoCategory, note });
      results.push(name);
    }
    return { list: { id: list.id, name: list.name }, added: results.length, items: results };
  } catch (err) {
    reply.code(500).send({ error: String(err) });
  }
});

// DELETE /lists/:id/items/:itemId
app.delete("/lists/:id/items/:itemId", async (req, reply) => {
  try {
    await og.removeItemFromList(req.params.id, req.params.itemId);
    return { removed: true };
  } catch (err) {
    reply.code(500).send({ error: String(err) });
  }
});

// POST /lists/:id/items/:itemId/toggle
app.post("/lists/:id/items/:itemId/toggle", async (req, reply) => {
  try {
    await og.toggleItemCrossedOff(req.params.id, req.params.itemId, req.body.crossedOff);
    return { toggled: true };
  } catch (err) {
    reply.code(500).send({ error: String(err) });
  }
});

// GET /add — browser-friendly endpoint for adding items via clickable link
// Used by Claude.ai artifacts since sandboxed iframes can't make fetch() calls
// Format: /add?list=Shopping+List&items=milk,eggs,flour&notes=|free+range|&key=API_KEY
app.get("/add", async (req, reply) => {
  const { list, items, notes } = req.query;
  if (!list || !items) {
    reply.type("text/html").send("<h2>❌ Missing list or items parameter</h2>");
    return;
  }
  try {
    const itemList = items.split(",").map(i => i.trim()).filter(Boolean);
    const noteList = notes ? notes.split("|") : [];
    const found = await og.findListByName(list);
    if (!found) {
      const all = await og.getLists();
      reply.type("text/html").send(
        "<h2>❌ List not found: " + list + "</h2>" +
        "<p>Available: " + all.map(l => l.name).join(", ") + "</p>"
      );
      return;
    }
    for (let i = 0; i < itemList.length; i++) {
      const note = noteList[i] || undefined;
      await og.addItemToList(found.id, itemList[i], { autoCategory: true, note });
    }
    reply.type("text/html").send(
      "<div style='font-family:system-ui;max-width:400px;margin:40px auto;text-align:center'>" +
      "<h2>✅ Added " + itemList.length + " item" + (itemList.length > 1 ? "s" : "") + " to " + found.name + "</h2>" +
      "<ul style='text-align:left;list-style:none;padding:0'>" +
      itemList.map((item, i) =>
        "<li style='padding:6px 0;border-bottom:1px solid #eee'>🛒 " + item +
        (noteList[i] ? " <span style='color:#888'>(" + noteList[i] + ")</span>" : "") +
        "</li>"
      ).join("") +
      "</ul><p style='margin-top:20px'><a href='javascript:window.close()'>Close this tab</a></p></div>"
    );
  } catch (err) {
    reply.type("text/html").send("<h2>❌ Error</h2><p>" + String(err) + "</p>");
  }
});

// POST /meal-plan/ingredients — read Meal Planner list, generate ingredients via Claude
app.post("/meal-plan/ingredients", async (req, reply) => {
  if (!ANTHROPIC_API_KEY) {
    return reply.code(500).send({ error: "ANTHROPIC_API_KEY not configured" });
  }
  try {
    const mealPlanList = await og.findListByName("Meal Planner");
    if (!mealPlanList) {
      return reply.code(404).send({ error: "\"Meal Planner\" list not found in OurGroceries" });
    }
    const items = await og.getListItems(mealPlanList.id);
    const activeMeals = items.filter(i => !i.crossedOff);

    const mealsNeedingIngredients = activeMeals.filter(m => !m.note);
    const mealsWithNotes = activeMeals.filter(m => m.note);

    const results = [];

    // Add meals with notes first (no ingredients needed)
    for (const m of mealsWithNotes) {
      results.push({ name: m.value, note: m.note, ingredients: [] });
    }

    if (mealsNeedingIngredients.length > 0) {
      const mealNames = mealsNeedingIngredients.map(m => m.value);
      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: `For each of the following meals, list the ingredients needed as a shopping list. Use common Australian grocery items. Be practical — skip pantry staples that most people have (salt, pepper, oil, butter, common dried herbs and spices, flour, sugar, soy sauce, stock cubes). Focus on fresh produce, proteins, dairy, and specialty items they'd need to buy.

Each ingredient should have a clean "name" (what you'd look for in the shop) and a "note" with quantity or other detail (e.g. brand, variety).

Return ONLY valid JSON, no markdown fencing. Use this exact format:
[{"meal":"Meal Name","ingredients":[{"name":"Chicken breast","note":"600g, 4 fillets"}]}]

Meals:
${mealNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
        }]
      });

      const text = message.content[0].text.trim();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Try extracting JSON from markdown fencing
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          throw new Error("Failed to parse Claude response as JSON");
        }
      }

      for (const entry of parsed) {
        results.push({
          name: entry.meal,
          ingredients: (entry.ingredients || []).map(ing =>
            typeof ing === "string" ? { name: ing } : ing
          )
        });
      }
    }

    return { meals: results };
  } catch (err) {
    app.log.error(err);
    reply.code(500).send({ error: String(err) });
  }
});

// GET /meal-plan — serves the interactive meal planner HTML page
app.get("/meal-plan", async (req, reply) => {
  const url = new URL(req.url, "http://localhost");
  const apiKey = url.searchParams.get("key") || "";
  reply.type("text/html").send(getMealPlanHTML(apiKey));
});

function getMealPlanHTML(apiKey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🍽️ Meal Planner → Shopping List</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --tq: #2bb5b2;
    --tq-dark: #1a8f8c;
    --tq-deep: #147573;
    --tq-glow: rgba(43,181,178,0.15);
    --tq-glass: rgba(43,181,178,0.08);
    --sand: #faf6f1;
    --sand-dark: #f0ebe4;
    --ink: #2d3436;
    --ink-soft: #636e72;
    --ink-faint: #b2bec3;
    --amber: #f0c75e;
    --amber-bg: #fdf6e3;
    --green: #27ae60;
    --green-bg: #eafaf1;
    --red: #e74c3c;
    --card: #ffffff;
    --radius: 16px;
    --radius-sm: 10px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--sand);
    color: var(--ink);
    min-height: 100vh;
  }
  body::before {
    content: '';
    position: fixed; top: 0; left: 0; right: 0; height: 280px;
    background: linear-gradient(135deg, var(--tq) 0%, var(--tq-dark) 50%, var(--tq-deep) 100%);
    z-index: 0;
  }
  .container {
    position: relative; z-index: 1;
    max-width: 540px; margin: 0 auto; padding: 0 16px 32px;
  }
  header {
    text-align: center; padding: 28px 0 24px;
  }
  header h1 {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 1.75rem; font-weight: 400; color: #fff;
    letter-spacing: -0.01em;
  }
  header p {
    font-size: 0.85rem; color: rgba(255,255,255,0.7);
    margin-top: 4px; font-weight: 500;
  }

  /* Loading */
  .loading {
    background: var(--card); border-radius: var(--radius);
    padding: 60px 20px; text-align: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    animation: fadeUp 0.4s ease;
  }
  .spinner-wrap { position: relative; width: 48px; height: 48px; margin: 0 auto; }
  .spinner {
    width: 48px; height: 48px;
    border: 3px solid var(--sand-dark);
    border-top-color: var(--tq);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .spinner-emoji {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    font-size: 1.2rem; line-height: 1;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading p {
    margin-top: 20px; color: var(--ink-soft);
    font-size: 0.9rem; font-weight: 500;
  }
  .loading .sub { font-size: 0.8rem; color: var(--ink-faint); margin-top: 4px; }

  /* Cards */
  .meal-card {
    background: var(--card); border-radius: var(--radius);
    padding: 20px; margin-bottom: 14px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.05);
    opacity: 0; animation: fadeUp 0.45s ease forwards;
    border: 1px solid rgba(0,0,0,0.04);
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .meal-card h2 {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 1.15rem; font-weight: 400;
    margin-bottom: 12px; color: var(--ink);
    display: flex; align-items: center; gap: 8px;
  }
  .meal-emoji { font-size: 1.3rem; line-height: 1; }

  /* Note card */
  .meal-note {
    background: var(--amber-bg);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    font-size: 0.85rem;
    color: #8b7034;
    border-left: 3px solid var(--amber);
    line-height: 1.5;
  }
  .meal-note .note-label { font-weight: 600; }

  /* Ingredient list */
  .ingredient-list { list-style: none; }
  .ingredient-list li {
    padding: 10px 0;
    border-bottom: 1px solid rgba(0,0,0,0.05);
    display: flex; align-items: flex-start; gap: 10px;
    transition: opacity 0.2s;
  }
  .ingredient-list li:last-child { border-bottom: none; }
  .ingredient-list li.unchecked { opacity: 0.45; }

  /* Custom checkbox */
  .ingredient-list input[type="checkbox"] {
    -webkit-appearance: none; appearance: none;
    width: 22px; height: 22px; flex-shrink: 0;
    border: 2px solid var(--ink-faint);
    border-radius: 6px; cursor: pointer;
    position: relative; top: 1px;
    transition: all 0.2s ease;
    background: var(--card);
  }
  .ingredient-list input[type="checkbox"]:checked {
    background: var(--tq); border-color: var(--tq);
  }
  .ingredient-list input[type="checkbox"]:checked::after {
    content: '';
    position: absolute; top: 3px; left: 6px;
    width: 5px; height: 10px;
    border: solid #fff; border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .ingredient-list label {
    flex: 1; cursor: pointer;
    font-size: 0.92rem; line-height: 1.4;
    font-weight: 500; color: var(--ink);
  }
  .ing-note {
    display: block;
    font-size: 0.78rem; font-weight: 400;
    color: var(--ink-soft); margin-top: 1px;
  }

  /* Select controls */
  .select-controls {
    display: flex; gap: 4px; margin-bottom: 10px;
  }
  .select-controls button {
    background: var(--tq-glass); border: none;
    color: var(--tq-dark); cursor: pointer;
    font-size: 0.75rem; font-weight: 600;
    padding: 4px 10px; border-radius: 20px;
    transition: background 0.2s;
    font-family: inherit;
  }
  .select-controls button:hover { background: var(--tq-glow); }

  /* Sticky footer */
  .footer {
    position: sticky; bottom: 0;
    background: linear-gradient(to top, var(--sand) 60%, transparent);
    padding: 20px 0 8px; margin-top: 4px;
  }
  .item-count {
    text-align: center; color: var(--ink-soft);
    margin-bottom: 10px; font-size: 0.82rem; font-weight: 500;
  }
  .btn {
    display: block; width: 100%; border: none;
    border-radius: var(--radius);
    font-size: 1.05rem; font-weight: 600;
    cursor: pointer; text-align: center;
    font-family: inherit;
    transition: all 0.25s ease;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--tq) 0%, var(--tq-dark) 100%);
    color: #fff; padding: 16px;
    box-shadow: 0 4px 16px rgba(43,181,178,0.35);
  }
  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(43,181,178,0.45);
  }
  .btn-primary:active { transform: translateY(0); }
  .btn-primary:disabled {
    background: var(--ink-faint);
    box-shadow: none; cursor: not-allowed;
    transform: none;
  }
  .btn-secondary {
    background: var(--card); color: var(--ink);
    padding: 14px; margin-top: 10px;
    border: 1.5px solid rgba(0,0,0,0.08);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .btn-secondary:hover { border-color: var(--tq); color: var(--tq-dark); }

  /* Summary */
  .summary {
    background: var(--card); border-radius: var(--radius);
    padding: 32px 24px; text-align: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    animation: fadeUp 0.4s ease;
  }
  .summary-icon {
    font-size: 3rem; margin-bottom: 12px;
    animation: popIn 0.5s cubic-bezier(0.175,0.885,0.32,1.275);
  }
  @keyframes popIn {
    0% { transform: scale(0); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
  .summary h2 {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 1.3rem; font-weight: 400;
    color: var(--green); margin-bottom: 16px;
  }
  .summary ul {
    list-style: none; text-align: left;
    max-width: 320px; margin: 0 auto;
  }
  .summary li {
    padding: 6px 0; font-size: 0.88rem;
    color: var(--ink-soft); font-weight: 500;
    display: flex; align-items: center; gap: 8px;
  }
  .summary li .check {
    color: var(--green); font-size: 0.8rem; flex-shrink: 0;
  }

  /* Error */
  .error {
    background: var(--card); border-radius: var(--radius);
    padding: 40px 24px; text-align: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    animation: fadeUp 0.4s ease;
  }
  .error h2 { color: var(--red); font-family: 'DM Serif Display', Georgia, serif; margin-bottom: 8px; }
  .error p { color: var(--ink-soft); font-size: 0.9rem; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🍽️ Meal Planner</h1>
    <p>Review ingredients & add to your shopping list</p>
  </header>
  <div id="app">
    <div class="loading">
      <div class="spinner-wrap">
        <div class="spinner"></div>
        <span class="spinner-emoji">🧑‍🍳</span>
      </div>
      <p>Generating your ingredient list...</p>
      <p class="sub">Reading meals & asking Claude for suggestions</p>
    </div>
  </div>
</div>
<script>
const API_KEY = ${JSON.stringify(apiKey)};
const BASE = location.origin;

function headers() {
  return { "Content-Type": "application/json", "X-API-Key": API_KEY };
}

function mealEmoji(name) {
  const n = name.toLowerCase();
  const map = [
    [['pizza'], '🍕'], [['pasta', 'spaghetti', 'penne', 'linguine', 'carbonara', 'bolognese', 'lasagna', 'lasagne'], '🍝'],
    [['taco', 'burrito', 'nacho', 'enchilada', 'quesadilla', 'mexican'], '🌮'],
    [['curry', 'korma', 'tikka', 'masala', 'vindaloo', 'dhal', 'dal'], '🍛'],
    [['steak', 'beef', 'rump', 'sirloin', 'rib eye', 'fillet'], '🥩'],
    [['chicken', 'katsu', 'schnitzel', 'poultry'], '🍗'],
    [['fish', 'salmon', 'barramundi', 'prawn', 'shrimp', 'seafood', 'cod', 'tuna'], '🐟'],
    [['burger', 'hamburger'], '🍔'], [['soup', 'broth', 'chowder', 'minestrone', 'laksa'], '🍲'],
    [['salad', 'bowl'], '🥗'], [['sushi', 'japanese', 'ramen', 'udon', 'teriyaki', 'miso'], '🍜'],
    [['rice', 'risotto', 'fried rice', 'biryani', 'pilaf'], '🍚'],
    [['sandwich', 'wrap', 'toastie', 'panini'], '🥪'], [['pie', 'pastry', 'quiche'], '🥧'],
    [['roast', 'lamb', 'pork'], '🥘'], [['stir fry', 'stir-fry', 'wok', 'noodle', 'pad thai', 'chow mein'], '🥡'],
    [['mac', 'cheese', 'mac & cheese', 'mac and cheese'], '🧀'],
    [['sausage', 'banger', 'bratwurst', 'hot dog'], '🌭'],
    [['bbq', 'barbecue', 'grill'], '🔥'], [['thai', 'green curry', 'red curry'], '🇹🇭'],
    [['korean', 'bibimbap', 'kimchi', 'bulgogi'], '🇰🇷'],
    [['chinese', 'dumpling', 'dim sim', 'spring roll'], '🥟'],
  ];
  for (const [keywords, emoji] of map) {
    if (keywords.some(k => n.includes(k))) return emoji;
  }
  return '🍽️';
}

async function load() {
  const app = document.getElementById("app");
  try {
    const res = await fetch(BASE + "/meal-plan/ingredients?key=" + encodeURIComponent(API_KEY), {
      method: "POST", headers: headers(), body: JSON.stringify({})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const data = await res.json();
    render(data.meals);
  } catch (err) {
    app.innerHTML = '<div class="error"><h2>Something went wrong</h2><p>' + escapeHtml(err.message) + '</p></div>';
  }
}

function escapeHtml(s) {
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}

function render(meals) {
  const app = document.getElementById("app");
  if (!meals || meals.length === 0) {
    app.innerHTML = '<div class="error"><p>No meals found in your Meal Planner list.</p></div>';
    return;
  }

  let html = "";
  let checkboxId = 0;
  let cardIdx = 0;

  for (const meal of meals) {
    const emoji = mealEmoji(meal.name);
    const delay = cardIdx * 0.08;
    html += '<div class="meal-card" style="animation-delay:' + delay + 's">';
    html += '<h2><span class="meal-emoji">' + emoji + '</span> ' + escapeHtml(meal.name) + '</h2>';

    if (meal.note) {
      html += '<div class="meal-note"><span class="note-label">📝 ' + escapeHtml(meal.note) + '</span> — no ingredients needed</div>';
    } else if (meal.ingredients && meal.ingredients.length > 0) {
      const cardId = 'card-' + checkboxId;
      html += '<div class="select-controls">';
      html += '<button onclick="toggleAll(\\'' + cardId + '\\', true)">Select all</button>';
      html += '<button onclick="toggleAll(\\'' + cardId + '\\', false)">Select none</button>';
      html += '</div>';
      html += '<ul class="ingredient-list" id="' + cardId + '">';
      for (const ing of meal.ingredients) {
        const id = 'cb-' + (checkboxId++);
        const name = typeof ing === "string" ? ing : ing.name;
        const note = (typeof ing === "object" && ing.note) ? ing.note : "";
        html += '<li><input type="checkbox" id="' + id + '" checked data-ingredient="' + escapeHtml(name) + '" data-note="' + escapeHtml(note) + '">';
        html += '<label for="' + id + '">' + escapeHtml(name) + (note ? '<span class="ing-note">' + escapeHtml(note) + '</span>' : '') + '</label></li>';
      }
      html += '</ul>';
    }
    html += '</div>';
    cardIdx++;
  }

  html += '<div class="footer">';
  html += '<div class="item-count" id="item-count"></div>';
  html += '<button class="btn btn-primary" id="add-btn" onclick="addToList()">🛒 Add to Shopping List</button>';
  html += '</div>';

  app.innerHTML = html;
  updateCount();
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", function() {
      this.closest("li").classList.toggle("unchecked", !this.checked);
      updateCount();
    });
  });
}

function toggleAll(cardId, checked) {
  document.querySelectorAll("#" + cardId + ' input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
    cb.closest("li").classList.toggle("unchecked", !checked);
  });
  updateCount();
}

function updateCount() {
  const checked = document.querySelectorAll('input[type="checkbox"]:checked');
  const el = document.getElementById("item-count");
  if (el) el.textContent = checked.length + " item" + (checked.length !== 1 ? "s" : "") + " selected";
}

async function addToList() {
  const btn = document.getElementById("add-btn");
  const checked = document.querySelectorAll('input[type="checkbox"]:checked');
  if (checked.length === 0) { alert("No items selected!"); return; }

  const items = Array.from(checked).map(cb => {
    const item = { name: cb.dataset.ingredient };
    if (cb.dataset.note) item.note = cb.dataset.note;
    return item;
  });
  btn.disabled = true;
  btn.textContent = "Adding...";

  try {
    const res = await fetch(BASE + "/lists/add-by-name?key=" + encodeURIComponent(API_KEY), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ listName: "Shopping List", items })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const data = await res.json();
    document.getElementById("app").innerHTML =
      '<div class="summary"><div class="summary-icon">✅</div>' +
      '<h2>Added ' + data.added + ' item' + (data.added !== 1 ? 's' : '') + ' to ' + escapeHtml(data.list.name) + '</h2>' +
      '<ul>' + data.items.map(i => '<li><span class="check">✓</span> ' + escapeHtml(i) + '</li>').join('') + '</ul>' +
      '<button class="btn btn-secondary" onclick="location.reload()">↩️ Back to meal plan</button></div>';
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "🛒 Add to Shopping List";
    alert("Error: " + err.message);
  }
}

load();
</script>
</div>
</body>
</html>`;
}

try {
  await app.listen({ port: PORT, host: HOST });
  console.log("OurGroceries bridge listening on " + HOST + ":" + PORT);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
