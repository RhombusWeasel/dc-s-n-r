/**
 * Smith & Robards — Shop module for Deadlands Classic
 *
 * Shop config lives on the open_shop boon (attached to dcBoonRegion behaviors).
 * Customer data lives in scene flags. No NPC actor is required.
 */

import { register_socket } from "./socket.js";
import { shop } from "./lib/shop.js";
import { barter } from "./lib/barter.js";
import { register_boons } from "./boons/open_shop.js";
import { register as register_shop_stock_field } from "./field_types/shop_stock.js";

const MODULE_ID = "smith-and-robards";

// ─── Init: preload templates ──────────────────────────────────────────────

Hooks.once("init", () => {
	loadTemplates([
		"modules/smith-and-robards/templates/shop.hbs",
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

	// Register custom shop_stock field type for boon editor
	register_shop_stock_field();

	// Register open_shop boon type + template
	register_boons();

	// Push shop updates to players when GM modifies the boon on a region behavior
	Hooks.on("updateRegionBehavior", (behavior, changed) => {
		if (behavior.type !== "dcBoonRegion") return;
		const boons = foundry.utils.getProperty(changed, "system.boons");
		if (boons === undefined) return;
		const has_shop = boons.some(b => b.type === "open_shop");
		if (!has_shop) return;
		// GM broadcasts updated shop data to players with the sheet open
		if (game.user.isGM) {
			const shop_boon = boons.find(b => b.type === "open_shop");
			const shop_data = shop.normalize_shop({
				haggle_tn: shop_boon.haggle_tn,
				sell_ratio: shop_boon.sell_ratio,
				cash: shop_boon.cash,
				stock: shop_boon.stock,
			});
			if (shop.has_stock(shop_data)) {
				const scene = behavior.parent;
				game.socket.emit("module.smith-and-robards", {
					event: "shop",
					msg: {
						operation: "shop_data",
						shop_id: behavior.uuid,
						shop: foundry.utils.deepClone(shop_data),
						customer: null,
					},
				});
			}
		}
	});

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
			open_shop: (shop_data, shop_id, scene, buyer) => shop.open_shop_sheet(shop_data, shop_id, scene, buyer),
		};
	}

	console.log("Smith & Robards | Module ready.");
});

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
							label: "Open Shop",
							trigger: "always",
							shopkeeper_name: "Shopkeeper",
							haggle_tn: 5,
							sell_ratio: 0.5,
							cash: -1,
							stock: {},
							is_permanent: true,
							target: "self",
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