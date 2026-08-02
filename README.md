# dc-s-n-r

Shop and barter module for the Deadlands Classic Foundry VTT system. Extracted from the Deadlands-Classic system as a standalone module.

Set up a shop by adding an `open_shop` boon to a region — players walk in, the shop sheet opens, and they can buy, sell, trade, or haggle with the shopkeeper. No NPC actor required.

---

## What Can This Module Do?

Here are some things you can set up:

| Scenario | How |
|----------|-----|
| **A general store** where players buy gear from the catalog with cash | Add an `open_shop` boon, set Trade Mode to **Catalog** — players pick items and confirm an order |
| **A trading post** where players swap items + cash with a merchant | Set Trade Mode to **Trade** — both sides add items and cash to a balanced trade |
| **A pure barter economy** with no cash on either side | Set Trade Mode to **Barter** (or disable cash) — items must balance without money |
| **A fickle merchant** who raises prices if you haggle badly | Set a Haggle TN — players roll Streetwise to reduce prices, but failure makes things worse |
| **A limited-stock shop** that depletes as players buy | Set per-item Supply values — stock decreases on purchase and restocks when players sell |
| **A dialog-triggered shop** that opens from an NPC conversation | Attach an `open_shop` boon to a dialog tree response — the shop opens when the player picks that line |

---

## Quick Start: Set Up a Shop

This takes about 2 minutes.

### Step 1: Draw a Region

1. Draw a region on your scene where the shop is located (Foundry → scene controls → Regions → Create Region).
2. Add a **dcBoonRegion** behavior to the region, set the event to **Token Enter**.

### Step 2: Add the Shop Boon

1. Add an **Open Shop** boon to the behavior's boon list.
2. Configure the boon:

| Field | Default | Description |
|------|---------|-------------|
| **Shopkeeper Name** | "Shopkeeper" | Display name shown on the shop sheet title |
| **Trade Mode** | Trade | `Trade` (items + cash), `Barter` (items only), or `Catalog` (buy-only with cash) |
| **Haggle TN** | 5 | Target number for the Streetwise haggle roll |
| **Sell Ratio** | 0.5 | Fraction of base cost the merchant pays when buying player items (0.5 = 50%) |
| **Merchant Cash** | -1 | Merchant's cash on hand in pennies. `-1` = unlimited. Used for making change in trades. |
| **Shop Stock** | — | Per-item for-sale toggle + supply count (see below) |

### Step 3: Configure Stock

The **Shop Stock** field in the boon editor shows the full gear catalog as a collapsible tree. For each item:

- Click the **✓ / ✗** toggle to mark it for sale or not for sale.
- Set a **Supply** number:
  - `-1` = unlimited (never depletes)
  - `0` = not for sale (same as unticking)
  - `N` = N boxes of stock (each box = one unit of the item; e.g. 1 box of ammo = 1 full box)

The summary line shows how many items are currently for sale.

### Step 4: Players Shop

When a player walks their token into the region, the shop sheet opens automatically. They see the shopkeeper name, their own cash, the merchant's inventory (or catalog), and trade controls.

---

## Trade Modes

The shop supports three modes, configured on the boon:

### Trade (default)

Full two-way trading. The sheet shows two inventory columns (player and merchant) with a trade panel in the middle:

1. **Add items** from either side by clicking the **+** icon next to each item.
2. **Add cash** to either side to balance the trade (click **Auto-Balance Cash** to calculate automatically).
3. The trade must be **balanced** — both sides must offer equal total value — before it can be accepted.
4. Click **Accept Trade** to finalize. The GM processes the trade: items and cash swap, merchant stock updates.

Prices are affected by the customer's **price modifier** (from haggling) and the **sell ratio** (for items the player sells to the merchant).

### Barter

Same as Trade but with **cash disabled**. Items must balance purely on value — no money changes hands. Set this by choosing Trade Mode = `Barter` or by disabling cash on the boon.

### Catalog

Buy-only mode. The sheet shows the full catalog of for-sale items with weapon/ammo/armour-specific columns (damage, weight, calibre, armour rating, etc.):

1. **Add items** to your order by clicking **+**.
2. Review the order summary at the bottom — item list, quantities, line totals, and order total.
3. Click **Confirm Order** — the GM deducts cash from the player, adds items to their inventory, and decrements merchant stock.

No selling or haggling in catalog mode.

---

## Haggle

Players can haggle with the shopkeeper to get better prices. The haggle uses the Deadlands Classic **Streetwise** skill.

### How It Works

1. The player clicks the **Haggle** button (shown in Trade and Barter modes).
2. A Streetwise roll is made against the boon's **Haggle TN** (default 5).
3. The result modifies the player's **customer record** for this shop:

| Outcome | Effect |
|---------|--------|
| **Success** | Price modifier reduced by **5% per raise**. Opinion increased by 1. |
| **Failure** | Price modifier increased by **5%**. Opinion decreased by 1. |

The price modifier is a percentage applied to all buy prices for this customer at this shop. A negative modifier means discounts; a positive modifier means markups.

### Customer Records

Each player has a separate customer record per shop, stored in **scene flags** (`scene.flags["dc-s-n-r"].customers[shop_id][actor_id]`). The record tracks:

- **Opinion** — the shopkeeper's disposition toward this customer (affected by haggle outcomes).
- **Price Modifier %** — percentage adjustment applied to buy prices (affected by haggle outcomes).

Customer records persist across sessions and are scene-specific.

---

## Dialog Tree Shops

Shops can also be opened from NPC dialog trees (dc-npc-patrols module). When an `open_shop` boon is attached to a dialog response:

1. The player picks the dialog response.
2. The boon fires and opens the shop sheet.
3. The boon's `shop_id` field identifies the shop — if empty, one is generated automatically.
4. Stock and cash changes persist back to the dialog tree's boon data (via the `persist_boon` callback).

The `shop_boon_cache.js` module resolves shops in this priority order:
1. **In-memory cache** (dialog shops with a persist callback)
2. **Dialog trees** (scans dc-npc-patrols dialog tree settings for matching `open_shop` boons)
3. **Region behavior** (falls back to `fromUuid(shop_id)` for region-attached shops)

This means a single shop can be referenced from both regions and dialog trees, with changes persisting to the correct source.

---

## GM-Brokered Architecture

All shop mutations (trades, orders, haggles) run on the **GM client**. Players send requests via the module's socket channel; the GM processes them, updates the shop data and actor inventories, and broadcasts results back. This prevents cheating and ensures stock/cash stay synchronized across all clients.

### Socket Flow

| Direction | Operation | Description |
|-----------|-----------|-------------|
| **Player → GM** | `request_shop_data` | Player asks GM for current shop config + their customer record |
| **GM → Player** | `shop_data` | GM responds with sanitized shop data and customer info |
| **Player → GM** | `trade` | Player submits a trade for processing |
| **GM → Player** | `trade_result` | GM reports success/failure of the trade |
| **Player → GM** | `order` | Player submits a catalog order for processing |
| **GM → Player** | `order_result` | GM reports success/failure of the order |
| **Player → GM** | `haggle` | Player reports a haggle roll result for customer record update |
| **GM → All** | `shop_data` | GM broadcasts updated shop data when the boon changes (e.g. stock depletes) |

Players never need observer permission on NPC actors — the GM brokers all data. The only requirement is that the GM client is running.

### Stock Persistence

| Shop Source | Stock Stored On | Updates Persist To |
|-------------|-----------------|-------------------|
| **Region behavior** | Boon on `dcBoonRegion` | `behavior.update({ "system.boons": ... })` |
| **Dialog tree** | Boon on dialog response | `game.settings.set("dc-npc-patrols", "dialog_trees", ...)` |
| **In-memory** | Boon cache + persist callback | Via the `persist_boon` callback provided by the caller |

---

## The Shop Sheet

When a player enters a shop region, the shop sheet (`NpcShopSheet`) opens. Here's what they see:

### Trade / Barter Mode

- **Buyer selector** — dropdown to pick which owned character is shopping
- **Price modifier + opinion** — current haggle-derived modifiers
- **Haggle button** — roll Streetwise against the TN
- **Player column** — the player's sellable inventory with sell prices
- **Trade panel** — items + cash offered by each side, balance indicator, auto-balance, accept/clear buttons
- **Merchant column** — the merchant's for-sale inventory with buy prices

### Catalog Mode

- **Player cash** — displayed at top
- **Catalog sections** — weapons (melee, ranged, thrown, explosives), ammo, armour, goods — each with relevant stat columns
- **Order summary** — running list of items, quantities, and total cost
- **Confirm / Clear order** buttons

### GM View

The GM can open the shop sheet to spectate. They see the full shop data (including unlimited stock details) and can process trades/orders directly. When the GM modifies the boon on a region behavior, updated shop data is automatically broadcast to players with the sheet open.

---

## Boon Configuration

The `open_shop` boon is the source of truth for the shop. All configuration lives on the boon.

### Boon Fields

| Field | Type | Default | Description |
|------|------|---------|-------------|
| **Label** | text | "Open Shop" | Display name in the boon editor |
| **Trigger** | dropdown | Always | When the boon fires (use "Always" for region entry) |
| **Shopkeeper Name** | text | "Shopkeeper" | Display name on the shop sheet |
| **Haggle TN** | number | 5 | Target number for Streetwise haggle rolls |
| **Sell Ratio** | number | 0.5 | Fraction of base cost paid for player items (step 0.05) |
| **Trade Mode** | dropdown | Trade | `Trade`, `Barter`, or `Catalog` |
| **Merchant Cash** | number | -1 | Merchant cash in pennies (`-1` = unlimited) |
| **Shop Stock** | shop_stock | — | Custom field type: gear catalog tree with for-sale toggle + supply input |

### Shop Stock Field Type

The `shop_stock` custom field type (registered via `game.dc.register_field_type()`) renders the full gear catalog as a categorized tree. Each item row has:

- A **for-sale toggle** (✓ / ✗ icon — click to toggle)
- A **supply input** (number, min -1, disabled when not for sale)
- The item **name** and **cost** (display only)

When extracted, the field produces a nested stock object: `{ "category.item": { supply: N } }` where `supply` is `-1` (unlimited), `0` (not for sale), or a positive number (limited stock in boxes).

---

## How It Works Under the Hood

For those who want to understand the architecture.

### Component Overview

| Component | File | Description |
|-----------|------|-------------|
| Module Init | `module/main.js` | Entry point. Registers socket, boon type, field type, hooks. Exposes module API. |
| Shop Engine | `module/lib/shop.js` | Shop data management, customer records, haggle, socket handling, shop data cache, GM-brokered data flow. |
| Barter Engine | `module/lib/barter.js` | Trade calculation, balance validation, auto-balance, stock deltas, trade application. |
| Catalog Engine | `module/lib/catalog.js` | Catalog mode: order building, validation, supply checks, order summary. |
| Boon Cache | `module/lib/shop_boon_cache.js` | In-memory boon registry. Resolves shops from cache → dialog trees → region behaviors. Handles persistence to each source. |
| Boon Handler | `module/boons/open_shop.js` | Fires when a player enters a shop region or picks a dialog response. Opens the shop sheet. Registers boon type + template. |
| Field Type | `module/field_types/shop_stock.js` | Custom boon editor field: gear catalog tree with for-sale toggle + supply input. |
| Shop Sheet | `module/sheets/shop_sheet.js` | Player-facing ApplicationV2 sheet. Reads from boon data + socket cache. Handles all UI interactions. |
| Socket Layer | `module/socket.js` | Registers the `module.dc-s-n-r` socket channel listener. Routes packets to the shop handler. |

### Module API

For module developers and the [dc-agent-bridge](../dc-agent-bridge/README.md) tool pack.

```js
const api = game.modules.get('dc-s-n-r').api;

// Shop engine — data management, haggle, socket flow
api.shop;

// Barter engine — trade calculation, validation, application
api.barter;

// Open a shop sheet programmatically
api.open_shop(shop_data, shop_id, scene, buyer);
```

The `shop` object exposes: `normalize_shop`, `shop_data_from_boon`, `get_customer`, `update_customer`, `calc_price`, `apply_haggle`, `build_streetwise_formula`, `build_player_catalog`, `get_owned_characters`, `request_order`, `request_trade`, `open_shop_sheet`, `emit`, `handle_socket`, and more.

The `barter` object exposes: `empty_trade`, `normalize_trade`, `calc_balance`, `can_add_trade_item`, `add_trade_item`, `remove_trade_item`, `auto_balance_cash`, `validate_trade`, `apply_trade`, `apply_stock_delta`, and more.

### Boon Registration

The module registers the `open_shop` boon type with the system's boon manager:

```js
game.dc.boon_manager.register_boon_type('open_shop', open_shop_boon);
game.dc.register_boon_template('open_shop', { /* template fields */ });
```

The boon fires when a player token enters a region with a `dcBoonRegion` behavior containing the boon. It builds shop data from the boon fields, resolves a shop ID (from the behavior UUID or a generated ID), and opens the shop sheet.

### Custom Field Type Registration

```js
game.dc.register_field_type('shop_stock', {
  render,     // field, current_value, sub_id → HTML string
  extract,    // field, element, boon_data → stock object
  on_render,  // field, container, boon_data, re_render → wire up events
  view,       // field, current_value → read-only summary string
});
```

### System APIs Consumed

| API | Used For |
|-----|---------|
| `game.dc.utils.data_from_path()` | Reading gear paths from stock objects and actor data |
| `game.dc.utils.modify_path()` | Writing stock entries |
| `game.dc.utils.delete_path()` | Removing depleted stock entries |
| `game.dc.utils.save_actor()` | Persisting cash/item changes to buyer actors |
| `game.dc.act.items.list_equipment_paths()` | Enumerating player's sellable inventory |
| `game.dc.act.items.modify()` | Adding items to buyer inventory |
| `game.dc.act.items.remove()` | Removing items from buyer inventory |
| `game.dc.gear_catalog.iterate_catalog()` | Walking the full gear catalog for shop stock / catalog mode |
| `game.dc.gear_catalog.get_catalog_item()` | Looking up individual catalog items by path |
| `game.dc.scroll_preservation.ScrollPreservationMixin` | Preserving scroll position on sheet rerenders |
| `game.dc.msg.*` | Chat message helpers for haggle output |
| `game.dc.report_context.post()` / `.haggle()` | Unified roll report builder for haggle chat output |
| `game.dc.roll_utils.build_roll_data()` | Building haggle roll data |
| `game.dc.roll_combat.evaluate_ex_roll()` | Evaluating haggle roll results (success/raises) |
| `game.dc.flow.run_sync('roll.unskilled')` | Unskilled Streetwise penalty calculation |
| `game.dc.region.get_tokens_in_region()` | Region token detection (boon handler) |
| `game.dc.boon_manager.register_boon_type()` | Boon type registration |
| `game.dc.register_boon_template()` | Boon editor UI template |
| `game.dc.register_field_type()` | Custom `shop_stock` field type for boon editor |
| `game.dc.register_localization()` | Runtime localization key for boon label |
| `game.dc.trigger_manager.*` | Firing immediate triggers on newly purchased items with boons |
| `game.socket` (Foundry) | Module socket channel `module.dc-s-n-r` for inter-client communication |

---

## Troubleshooting

**The shop sheet doesn't open when I enter the region.**
- Check that the region has a `dcBoonRegion` behavior with the `open_shop` boon
- Check that the behavior event is set to **Token Enter**
- Check that the GM client is running (all shop logic runs on the GM client)
- Check that at least one item is marked for sale in the boon's Shop Stock field
- Check the console (F12) for errors

**Players see "Nothing for sale right now."**
- The boon's Shop Stock field has no items marked for sale (✓ icon)
- All for-sale items have supply set to `0`
- The GM needs to open the boon editor and mark items for sale with a supply value

**The trade won't accept — it says "unbalanced".**
- Both sides of the trade must have equal total value
- Click **Auto-Balance Cash** to automatically add cash to the short side
- In Barter mode, cash is disabled — you must adjust items to balance

**Haggle says "This character cannot roll Streetwise."**
- The character doesn't have a Smarts attribute or Streetwise skill defined
- Unskilled characters can still roll (using Smarts die type with a penalty), but both attribute and skill data must exist on the actor

**Stock isn't depleting after purchases.**
- Check that the item's supply is set to a positive number (not `-1` which means unlimited)
- The GM client must be running — stock updates are processed GM-side
- If the shop is on a dialog tree, ensure the persist callback is wired (the dialog system provides this automatically)

**The merchant ran out of cash.**
- Set Merchant Cash to `-1` for unlimited, or increase the value
- In Trade mode, the merchant needs cash to make change — if they run out, the auto-balance will try to cover the difference from the player's side

**A dialog-triggered shop doesn't persist stock changes.**
- The boon must have a `shop_id` set (or be left empty for auto-generation)
- The dialog tree must be saved via the dc-npc-patrols dialog editor (not just edited in-memory)
- Check that the `persist_boon` callback is being passed from the dialog boon firing context

---

## License

MIT