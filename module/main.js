/**
 * Smith & Robards — Shop module for Deadlands Classic
 *
 * Extracted from the Deadlands-Classic system. Provides shop, barter,
 * and NPC interaction functionality via the module's own socket channel.
 */

import { register_socket } from "./socket.js";
import { shop } from "./lib/shop.js";
import { barter } from "./lib/barter.js";
import { npc_interaction } from "./lib/npc_interaction.js";
import { migrate_shop_whitelist } from "./lib/shop_migration.js";
import { register_tab_injection } from "./sheets/shop_config_tab.js";
import { register_boons } from "./boons/open_shop.js";

const MODULE_ID = "smith-and-robards";

// ─── Init: preload templates ──────────────────────────────────────────────

Hooks.once("init", () => {
	loadTemplates([
		"modules/smith-and-robards/templates/shop.hbs",
		"modules/smith-and-robards/templates/partials/shop_config.hbs",
		"modules/smith-and-robards/templates/partials/shop_barter_column.hbs",
		"modules/smith-and-robards/templates/partials/shop_barter_trade.hbs",
		"modules/smith-and-robards/templates/partials/shop_category.hbs",
	]);

	game.settings.register(MODULE_ID, "dcshop-region-migrated", {
		scope: "world",
		config: false,
		default: false,
	});
});

// ─── dcReady: register everything ─────────────────────────────────────────

Hooks.once("dcReady", () => {
	// Register socket listener on module channel
	register_socket();

	// Register GM shop config tab injection
	register_tab_injection();

	// Register open_shop boon type + template
	register_boons();

	// NPC sheet interception — open shop sheet for non-GM players
	_register_npc_interception();

	// Actor update sync — broadcast shop changes to players
	Hooks.on("updateActor", (actor, changed) => {
		if (actor.type !== "npc") return;
		if (foundry.utils.getProperty(changed, "system.shop") === undefined) return;
		shop.on_actor_update(actor, changed);
		// Invalidate NPC type cache for all clients
		npc_interaction.invalidate_cache(actor.id);
	});

	// Run shop data migration (GM only)
	if (game.user.isGM) {
		void migrate_shop_whitelist();
	}

	// Auto-migrate dcShop region behaviors to dcBoonRegion + open_shop boon
	if (game.user.isGM) {
		_migrate_dcshop_regions();
	}

	// Expose module API
	const module_api = game.modules.get(MODULE_ID);
	if (module_api) {
		module_api.api = {
			shop,
			barter,
			npc_interaction,
			open_shop: (actor) => shop.open_player_sheet(actor),
		};
	}

	console.log("Smith & Robards | Module ready.");
});

// ─── NPC sheet interception ───────────────────────────────────────────────

// Track NPCs we've already checked, to avoid re-checking on every render
const _checked_npcs = new Set();

function _register_npc_interception() {
	Hooks.on("renderActorSheet", async (sheet, html, context) => {
		const actor = sheet.actor;
		if (!actor || actor.type !== "npc") return;
		if (game.user.isGM) return;

		// Skip if we've already determined this NPC is not a shop
		if (_checked_npcs.has(actor.id)) {
			const cached_type = npc_interaction.get_cached_type(actor.id);
			if (cached_type === "shop") {
				// Close actor sheet and open shop sheet
				sheet.close();
				await shop.open_player_sheet(actor);
			}
			return;
		}

		// Request NPC type from GM
		const npc_type = await npc_interaction.request_npc_type(actor.id);
		_checked_npcs.add(actor.id);

		if (npc_type === "shop") {
			// Close actor sheet and open shop sheet
			sheet.close();
			await shop.open_player_sheet(actor);
		}
	});
}

// ─── dcShop region behavior migration ─────────────────────────────────────

async function _migrate_dcshop_regions() {
	if (game.settings.get(MODULE_ID, "dcshop-region-migrated")) return;

	for (const scene of game.scenes) {
		for (const region of scene.regions) {
			for (const behavior of region.behaviors) {
				if (behavior.type !== "dcShop") continue;

				// Create a dcBoonRegion behavior with open_shop boon
				const new_behavior = {
					type: "dcBoonRegion",
					system: {
						events: { token_enter: true },
						boons: [{
							type: "open_shop",
							data: {}
						}]
					}
				};

				await region.createEmbeddedDocuments("RegionBehavior", [new_behavior]);

				// Delete the old dcShop behavior
				await behavior.delete();

				console.log(`Smith & Robards | Migrated dcShop behavior on region "${region.name}" in scene "${scene.name}"`);
			}
		}
	}

	await game.settings.set(MODULE_ID, "dcshop-region-migrated", true);
	console.log("Smith & Robards | dcShop region migration complete.");
}