/**
 * open_shop boon — opens the shop sheet using data stored on the boon itself.
 * Works from region entry, dialog responses, or any other boon execution context.
 *
 * Boon handler signature: (boon, context) => void
 * context: { region?, target, actor, scene?, behavior?, behavior_uuid? }
 *   - region: the region document when fired from a region (region.parent = scene)
 *   - actor: the player's actor (the buyer)
 */

import { shop } from "../lib/shop.js";

export default async function open_shop_boon(boon, context) {
	const { region, actor } = context;

	if (!actor) {
		ui.notifications.warn("No buyer actor for shop.");
		return;
	}

	const scene = region?.parent ?? context.scene ?? canvas.scene;

	// Build shop data from the boon
	const shop_data = {
		shopkeeper_name: boon.shopkeeper_name || "Shopkeeper",
		haggle_tn: boon.haggle_tn ?? 5,
		sell_ratio: boon.sell_ratio || 0.5,
		trade_mode: boon.trade_mode,
		enable_cash: boon.enable_cash,
		cash: boon.cash ?? -1,
		stock: boon.stock || {},
	};

	// Region shops use behavior UUID; embedded/dialog shops use boon.shop_id
	let shop_id = context.behavior_uuid || context.behavior?.uuid || boon.shop_id;
	if (!shop_id) {
		boon.shop_id = foundry.utils.randomID();
		shop_id = boon.shop_id;
	}

	try {
		await shop.open_shop_sheet(shop_data, shop_id, scene, actor, {
			boon,
			persist_boon: context.persist_boon,
		});
	} catch (err) {
		console.error("dc-s-n-r | open_shop_boon failed", err);
		ui.notifications.error("Failed to open shop.");
	}
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
			shop_id: "",
			haggle_tn: 5,
			sell_ratio: 0.5,
			trade_mode: "trade",
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
			sell_ratio:       { key: 'boon-sell_ratio',      type: 'number',     value: 'sell_ratio',       label: 'Sell Ratio', step: 0.05 },
			trade_mode:       { key: 'boon-trade_mode',      type: 'dropdown',   value: 'trade_mode',        options: { trade: 'Trade', barter: 'Barter', catalog: 'Catalog' }, translation_path: 'dc.shop.trade_mode', label: 'Trade Mode' },
			cash:             { key: 'boon-cash',            type: 'number',     value: 'cash',             label: 'Merchant Cash (-1 = unlimited)' },
			stock:            { key: 'boon-stock',           type: 'shop_stock', value: 'stock',            label: 'Shop Stock' },
		},
	});
}

export { register_boons };
