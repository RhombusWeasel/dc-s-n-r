/**
 * open_shop boon — fires when a player token enters a region with this boon.
 * Opens the shop sheet using data stored on the boon itself (no NPC actor required).
 *
 * Boon handler signature: (boon, context) => void
 * context: { region, target, actor }
 *   - region: the region document (region.parent = scene)
 *   - actor: the entering player's actor (the buyer)
 */

import { shop } from "../lib/shop.js";

export default function open_shop_boon(boon, context) {
	const { region, actor } = context;
	const scene = region?.parent;

	// Build shop data from the boon
	const shop_data = {
		shopkeeper_name: boon.shopkeeper_name || "Shopkeeper",
		haggle_tn: boon.haggle_tn ?? 5,
		sell_ratio: boon.sell_ratio ?? 0.5,
		cash: boon.cash ?? -1,
		stock: boon.stock || {},
	};

	// Determine the shop ID from the region behavior UUID
	// (passed via context if available, otherwise use region.id as fallback)
	const shop_id = context.behavior?.uuid || region.id;

	shop.open_shop_sheet(shop_data, shop_id, scene, actor);
}

// ─── Registration ─────────────────────────────────────────────────────────

function register_boons() {
	game.dc.boon_manager.register_boon_type("open_shop", open_shop_boon);

	const triggers = game.dc.system.triggers;

	game.dc.register_boon_template("open_shop", {
		label: "Open Shop",
		description: "Opens a shop sheet when a player token enters the region.",
		new_object: {
			label: "Open Shop",
			type: "open_shop",
			trigger: "always",
			shopkeeper_name: "Shopkeeper",
			haggle_tn: 5,
			sell_ratio: 0.5,
			cash: -1,
			stock: {},
			scaling: null,
			is_permanent: true,
			target: "self",
		},
		data: {
			label:           { key: 'boon-label',           type: 'text',       value: 'label',           label: 'Label' },
			trigger:         { key: 'boon-trigger',         type: 'dropdown',   value: 'trigger',         options: triggers, translation_path: 'dc.triggers', label: 'Trigger' },
			shopkeeper_name:  { key: 'boon-shopkeeper_name', type: 'text',       value: 'shopkeeper_name',  label: 'Shopkeeper Name' },
			haggle_tn:        { key: 'boon-haggle_tn',       type: 'number',     value: 'haggle_tn',        label: 'Haggle TN' },
			sell_ratio:       { key: 'boon-sell_ratio',      type: 'number',     value: 'sell_ratio',       label: 'Sell Ratio' },
			cash:             { key: 'boon-cash',            type: 'number',     value: 'cash',             label: 'Merchant Cash (-1 = unlimited)' },
			stock:            { key: 'boon-stock',           type: 'shop_stock', value: 'stock',            label: 'Shop Stock' },
		},
	});
}

export { register_boons };