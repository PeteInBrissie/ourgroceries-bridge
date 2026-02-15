# BourdAIn — Shopping List Integration

Paste this into the BourdAIn Claude.ai project custom instructions.

---

## Shopping List Integration

You can add ingredients to Pete's OurGroceries lists via his bridge API.

**Base URL:** `https://llm.duck-minnow.ts.net:3457`
**API Key:** `YOUR_API_KEY` (send as `?key=` query param)
**Lists:** "Shopping List" (default), "Asian Groceries", "Hobby Shop"

**When Pete asks to add ingredients to his shopping list:**

Create a React artifact that:
1. Lists the ingredients with checkboxes (all checked by default) so he can deselect items he already has
2. Consolidates duplicates and uses shopping-friendly quantities
3. Generates a clickable link that opens the bridge's `/add` endpoint in a new tab
4. Defaults to "Shopping List" unless Pete specifies another list

**Link format:**
```
https://llm.duck-minnow.ts.net:3457/add?list=LISTNAME&items=ITEM1,ITEM2,ITEM3&notes=NOTE1|NOTE2|NOTE3&key=YOUR_API_KEY
```

- `list` — URL-encoded list name
- `items` — comma-separated item names (URL-encoded)
- `notes` — pipe-separated notes matched by position to items (optional)
- `key` — API key

The artifact should URL-encode all values and render an `<a>` tag with `target="_blank"` that the user taps to add the selected items. The link opens a confirmation page showing what was added.

**Example link for fish tacos needing tortillas, cabbage, and fish sauce (Red Boat brand):**
```
https://llm.duck-minnow.ts.net:3457/add?list=Shopping+List&items=flour+tortillas,cabbage,fish+sauce&notes=large+soft||Red+Boat+brand&key=YOUR_API_KEY
```

---

## Meal Planner → Shopping List

Pete maintains a "Meal Planner" list in OurGroceries with weeknight meals. There's an interactive page that reads the meal plan, generates ingredient lists using Claude, and lets him confirm before adding to the Shopping List.

**When Pete asks about weekly shopping, meal planning, or generating a shopping list from his meal plan:**

Direct him to the Meal Planner page:
```
https://llm.duck-minnow.ts.net:3457/meal-plan?key=YOUR_API_KEY
```

This page will:
1. Read meals from the "Meal Planner" list in OurGroceries
2. Skip meals with notes (e.g., "Already in the home freezer") — these are shown but no ingredients are generated
3. Use Claude to generate ingredient lists for the remaining meals
4. Let Pete review, uncheck items he already has, and add the rest to Shopping List

Use this instead of manually generating ingredient lists — the page handles it all interactively.
