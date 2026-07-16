/**
 * dc-s-n-r — Shop module for Deadlands Classic
 *
 * Shop config lives on the open_shop boon (attached to dcBoonRegion behaviors).
 * Customer data lives in scene flags. No NPC actor is required.
 */

import { register_socket, SOCKET_CHANNEL } from "./socket.js";
import { shop } from "./lib/shop.js";
import { barter } from "./lib/barter.js";
import { register_boons } from "./boons/open_shop.js";
import { register as register_shop_stock_field } from "./field_types/shop_stock.js";

const MODULE_ID = "dc-s-n-r";

// ─── Init: preload templates ──────────────────────────────────────────────

Hooks.once("init", () => {
	foundry.applications.handlebars.loadTemplates([
		"modules/dc-s-n-r/templates/shop.hbs",
		"modules/dc-s-n-r/templates/partials/shop_barter_column.hbs",
		"modules/dc-s-n-r/templates/partials/shop_barter_trade.hbs",
		"modules/dc-s-n-r/templates/partials/shop_catalog.hbs",
		"modules/dc-s-n-r/templates/partials/shop_category.hbs",
	]);
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
			const shop_data = shop.shop_data_from_boon(shop_boon);
			if (shop.has_stock(shop_data)) {
				game.socket.emit(SOCKET_CHANNEL, {
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

	// Expose module API
	const module_api = game.modules.get(MODULE_ID);
	if (module_api) {
		module_api.api = {
			shop,
			barter,
			open_shop: (shop_data, shop_id, scene, buyer) => shop.open_shop_sheet(shop_data, shop_id, scene, buyer),
		};
	}

	console.log("dc-s-n-r | Module ready.");
});
