# 🛒 OurGroceries Bridge

An HTTP bridge that connects AI assistants to your [OurGroceries](https://www.ourgroceries.com) shopping lists — featuring an interactive **Meal Planner** that generates ingredient lists with Claude and adds them to your shopping list in one tap.

Built to run on a home server over [Tailscale](https://tailscale.com), so your credentials never touch the public internet.

```
┌─────────────────────────────────────────────────────────┐
│  🍽️ Meal Planner Page                                  │
│                                                         │
│  ┌─────────────────────────────────┐                    │
│  │ 🥩 Steak Frites                │                    │
│  │ ☑ Beef steak    2 x 250g       │                    │
│  │ ☑ Potatoes      800g           │                    │
│  │ ☑ Garlic        1 bulb         │                    │
│  └─────────────────────────────────┘                    │
│  ┌─────────────────────────────────┐                    │
│  │ 🧀 Mac & Cheese                │                    │
│  │ 📝 Already in the home freezer │                    │
│  └─────────────────────────────────┘                    │
│                                                         │
│  ┌─────────────────────────────────┐                    │
│  │  🛒 Add to Shopping List       │                    │
│  └─────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

## ✨ Features

### Meal Planner → Shopping List
An interactive page that reads your **Meal Planner** list from OurGroceries, sends the meals to **Claude Haiku** to generate ingredient lists, and lets you review and confirm before adding to your Shopping List.

- 🤖 **AI-powered ingredient generation** — Claude suggests practical ingredients, skipping pantry staples
- 🇦🇺 **Australian grocery items** — quantities and brands you'd actually find at Coles or Woolies
- 📝 **Smart note handling** — meals with notes (e.g., "Already in the home freezer") are shown but skipped for ingredients
- ✅ **Checkbox review** — uncheck items you already have before adding
- 🎨 **Polished UI** — turquoise-themed design with staggered animations and emoji-matched meal cards

### REST API for AI Assistants
A full REST API for managing OurGroceries lists, designed for [Claude.ai](https://claude.ai) artifacts (the **[ai-cooking-assistant](https://github.com/PeteInBrissie/ai-prompts/blob/main/prompts/ai-cooking-assistant.md)** project).

- 🔗 **Browser-friendly `/add` endpoint** — clickable links that work from sandboxed iframes
- 📋 **List management** — read lists, add/remove items, toggle crossed-off status
- 🏷️ **Auto-categorisation** — items automatically sorted into OurGroceries categories
- 📝 **Notes support** — attach notes to items (brand preferences, quantities, etc.)

## 🏗️ Architecture

```
Browser ──GET /meal-plan──→ Interactive HTML page
                              │
                              ├── POST /meal-plan/ingredients
                              │     ├── Reads "Meal Planner" list from OurGroceries
                              │     ├── Sends meals to Claude Haiku API
                              │     └── Returns structured ingredient suggestions
                              │
                              └── POST /lists/add-by-name
                                    └── Adds confirmed items to "Shopping List"

Claude.ai ──clickable link──→ GET /add?list=...&items=...
                                └── Adds items directly to OurGroceries
```

**Infrastructure:**
- **Fastify** HTTP server (Node.js 22)
- **Caddy** reverse proxy for TLS termination
- **Docker Compose** for deployment
- **Tailscale** for secure networking (no public exposure)

## 🚀 Setup

### 1. Clone and configure

```bash
git clone https://github.com/PeteInBrissie/ourgroceries-bridge.git
cd ourgroceries-bridge
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
OG_USERNAME=your-email@example.com
OG_PASSWORD=your-password
OG_API_KEY=some-random-secret        # Protects the bridge API
OG_PORT=3456
ANTHROPIC_API_KEY=sk-ant-...         # For meal plan ingredient generation
```

### 2. Set up Tailscale HTTPS certs

```bash
mkdir certs
tailscale cert --cert-file certs/your-hostname.crt --key-file certs/your-hostname.key your-hostname.ts.net
```

Update `Caddyfile` with your hostname and cert paths.

### 3. Deploy

```bash
docker compose build && docker compose up -d
```

### 4. Verify

```bash
curl https://your-hostname.ts.net:3457/health?key=YOUR_API_KEY
# → {"status":"ok"}
```

## 📖 API Reference

All endpoints require authentication via `X-API-Key` header or `?key=` query parameter.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/meal-plan` | Interactive meal planner page |
| `POST` | `/meal-plan/ingredients` | Generate ingredients for meal plan |
| `GET` | `/lists` | Get all lists |
| `GET` | `/lists/:id/items` | Get items for a list |
| `POST` | `/lists/:id/items` | Add items to a list by ID |
| `POST` | `/lists/add-by-name` | Add items to a list by name |
| `DELETE` | `/lists/:id/items/:itemId` | Remove an item |
| `POST` | `/lists/:id/items/:itemId/toggle` | Toggle crossed-off status |
| `GET` | `/add` | Browser-friendly add (for Claude.ai artifact links) |

### Key Endpoints

#### `GET /meal-plan?key=API_KEY`

Opens the interactive Meal Planner page. Reads meals from your "Meal Planner" list, generates ingredients via Claude, and lets you add selected items to your Shopping List.

#### `POST /lists/add-by-name`

```json
{
  "listName": "Shopping List",
  "items": [
    "chicken thighs",
    { "name": "fish sauce", "note": "Red Boat brand" }
  ]
}
```

#### `GET /add?list=Shopping+List&items=flour+tortillas,cabbage&notes=large+soft|&key=API_KEY`

Browser-friendly endpoint for Claude.ai artifacts. Items are comma-separated, notes are pipe-separated and position-matched.

## 🤖 AI Cooking Assistant Integration

This bridge is designed to work with a Claude.ai cooking assistant project. See [`AI_COOKING_ASSISTANT_INSTRUCTIONS.md`](AI_COOKING_ASSISTANT_INSTRUCTIONS.md) for the custom instructions to paste into your Claude.ai project.

The cooking assistant can:
- Generate clickable links that add recipe ingredients to your shopping list
- Direct you to the Meal Planner page for weekly shopping

## 🔒 Security

- Runs exclusively over **Tailscale** — never exposed to the public internet
- **API key authentication** on all endpoints
- **TLS** via Caddy with Tailscale-issued certificates
- Container runs as non-root `node` user
- OurGroceries credentials stored in `.env` (gitignored)

## 🛠️ Troubleshooting

**Login fails:** OurGroceries uses an unofficial web API. If they change their login flow, auth may break. Check https://www.ourgroceries.com/sign-in for changes.

**Session expires:** The client re-authenticates automatically when the session cookie expires (401 retry logic).

**Meal plan empty:** Make sure you have a list called "Meal Planner" in OurGroceries with uncrossed-off items.

**Ingredients too generic:** The Claude prompt targets Australian grocery items. Edit the prompt in `server.mjs` if you're in a different region.
