# Smith & Robards

Shop and barter module for the Deadlands Classic Foundry VTT system. Extracted from the Deadlands-Classic system as a standalone module.

Named after the in-game store catalog — Smith & Robards.

## Dependencies

- **Deadlands-Classic** system (V14)

## Features

- **Player shop sheet** — opens when a non-GM player clicks an NPC token that has a configured shop
- **Barter system** — trade items + cash between player and merchant, with balance validation
- **Haggle** — Streetwise roll to adjust prices via opinion/price modifier per customer
- **GM shop config** — injects a Shop tab into NPC sheets for GMs to configure stock, supply, haggle TN, cash, sell ratio, and customer opinions
- **Region-based shop opening** — register `open_shop` boon on `dcBoonRegion` to open the shop sheet when a player token enters the region
- **GM-brokered data** — players don't need observer permission on NPC actors; the GM brokers shop data via the module's socket channel
- **Auto-migration** — migrates old shop whitelist data and `dcShop` region behaviors to the new format

## System APIs Consumed

| API | Usage |
|---|---|
| `game.dc.utils.*` | data_from_path, modify_path, delete_path, save_actor |
| `game.dc.act.items.*` | list_equipment_paths, modify, remove |
| `game.dc.gear_catalog.*` | iterate_catalog, get_catalog_item |
| `game.dc.scroll_preservation.*` | ScrollPreservationMixin for shop sheet |
| `game.dc.msg.*` | chat message helpers (haggle) |
| `game.dc.roll_utils.*` | build_roll_data (haggle rolls) |
| `game.dc.roll_report.*` | build_roll_report (haggle chat output) |
| `game.dc.roll_combat.*` | evaluate_ex_roll (haggle evaluation) |
| `game.dc.region.*` | get_tokens_in_region (boon handler) |
| `game.dc.boon_manager.*` | register_boon_type (open_shop) |
| `game.dc.register_boon_template()` | boon template for editor UI |

## Socket Channel

Uses its own socket channel: `module.smith-and-robards` (registered via `socket: true` in `module.json`).

## Boon Types

- `open_shop` — fires on `TOKEN_ENTER`, detects NPC in region, opens shop sheet

## Module API

```javascript
game.modules.get("smith-and-robards").api.shop
game.modules.get("smith-and-robards").api.barter
game.modules.get("smith-and-robards").api.npc_interaction
game.modules.get("smith-and-robards").api.open_shop(actor)
```