import { shop } from "./shop.js";

function empty_trade() {
	return {
		player: { items: {}, cash: 0 },
		merchant: { items: {}, cash: 0 }
	};
}

function normalize_trade(trade = {}) {
	return {
		player: {
			items: trade.player?.items ? { ...trade.player.items } : {},
			cash: trade.player?.cash ?? 0
		},
		merchant: {
			items: trade.merchant?.items ? { ...trade.merchant.items } : {},
			cash: trade.merchant?.cash ?? 0
		}
	};
}

function calc_sell_price(base_cost, customer, sell_ratio = 0.5) {
	const pct = customer?.price_modifier_pct || 0;
	const ratio = shop.parse_sell_ratio(sell_ratio);
	return Math.max(0, Math.round(base_cost * ratio * (1 - pct / 100)));
}

function get_catalog_item(path) {
	return game.dc.gear_catalog.get_catalog_item(path);
}

function get_player_item(buyer, path) {
	return game.dc.utils.data_from_path(buyer, `system.char.gear.${path}`);
}

function get_item_unit_qty(path, gear = null) {
	const template = get_catalog_item(path);
	const qty = template?.quantity ?? gear?.quantity ?? 1;
	return qty > 0 ? qty : 1;
}

function get_catalog_unit_cost(path, gear = null) {
	const catalog = get_catalog_item(path);
	if (catalog?.cost != null) {
		return catalog.cost;
	}
	if (gear?.cost != null) {
		return gear.cost;
	}
	return 0;
}

function get_piece_cost(path, gear = null) {
	const unit_qty = get_item_unit_qty(path, gear);
	return get_catalog_unit_cost(path, gear) / unit_qty;
}

function get_buy_price(path, customer, shop_data) {
	return shop.calc_price(get_piece_cost(path), customer);
}

function get_sell_price(path, customer, shop_data, gear = null) {
	return calc_sell_price(
		get_piece_cost(path, gear),
		customer,
		shop_data?.sell_ratio
	);
}

function get_player_item_count(gear) {
	return gear?.count ?? 0;
}

function get_merchant_piece_supply(shop_data, path) {
	const supply = shop.get_supply(shop_data, path);
	if (supply === -1) {
		return -1;
	}
	return supply * get_item_unit_qty(path);
}

function boxes_for_pieces(qty, unit_qty) {
	if (qty <= 0) {
		return 0;
	}
	return Math.ceil(qty / unit_qty);
}

function build_player_inventory(buyer, customer, shop_data) {
	if (!buyer) {
		return [];
	}
	const rows = [];
	for (const path of game.dc.act.items.list_equipment_paths(buyer)) {
		const gear = get_player_item(buyer, path);
		if (!gear) {
			continue;
		}
		const count = get_player_item_count(gear);
		if (count <= 0) {
			continue;
		}
		const catalog = get_catalog_item(path);
		rows.push({
			path,
			label: gear.label || catalog?.label || path,
			count,
			unit_qty: get_item_unit_qty(path, gear),
			sell_price: get_sell_price(path, customer, shop_data, gear)
		});
	}
	rows.sort((a, b) => a.label.localeCompare(b.label));
	return rows;
}

function build_merchant_inventory(shop_data, customer) {
	const catalog = shop.build_player_catalog(shop_data, customer);
	const rows = [];
	for (const items of Object.values(catalog)) {
		for (const item of items) {
			const unit_qty = get_item_unit_qty(item.path);
			rows.push({
				path: item.path,
				label: item.label,
				count: item.supply === -1 ? null : item.supply * unit_qty,
				buy_price: get_buy_price(item.path, customer, shop_data),
				unit_qty
			});
		}
	}
	rows.sort((a, b) => a.label.localeCompare(b.label));
	return rows;
}

function calc_side_total(side, side_name, customer, shop_data, buyer = null) {
	let items_total = 0;
	const rows = [];
	for (const [path, qty] of Object.entries(side.items || {})) {
		if (qty <= 0) {
			continue;
		}
		const gear = side_name === "player" ? get_player_item(buyer, path) : null;
		const unit_price = side_name === "player"
			? get_sell_price(path, customer, shop_data, gear)
			: get_buy_price(path, customer, shop_data);
		const line_total = unit_price * qty;
		items_total += line_total;
		const catalog = get_catalog_item(path);
		rows.push({
			path,
			qty,
			label: gear?.label || catalog?.label || path,
			unit_price,
			line_total
		});
	}
	rows.sort((a, b) => a.label.localeCompare(b.label));
	return {
		items_total,
		cash: side.cash ?? 0,
		total: items_total + (side.cash ?? 0),
		rows
	};
}

function calc_balance(trade, buyer, shop_data, customer) {
	const normalized = normalize_trade(trade);
	// When cash is disabled, ignore any cash values
	if (shop_data && shop_data.enable_cash === false) {
		normalized.player.cash = 0;
		normalized.merchant.cash = 0;
	}
	const player = calc_side_total(normalized.player, "player", customer, shop_data, buyer);
	const merchant = calc_side_total(normalized.merchant, "merchant", customer, shop_data, buyer);
	const balanced = player.total === merchant.total;
	const errors = [];
	if (!balanced) {
		errors.push("unbalanced");
	}
	if (player.total === 0 && merchant.total === 0) {
		errors.push("empty_trade");
	}
	return {
		player,
		merchant,
		balanced,
		errors,
		diff: player.total - merchant.total
	};
}

function get_staged_qty(trade, side, path) {
	return normalize_trade(trade)[side].items[path] ?? 0;
}

function can_add_trade_item(trade, side, path, buyer, shop_data) {
	const staged = get_staged_qty(trade, side, path);
	if (side === "player") {
		const gear = get_player_item(buyer, path);
		return staged < get_player_item_count(gear);
	}
	if (!shop.is_for_sale(shop_data, path)) {
		return false;
	}
	const available = get_merchant_piece_supply(shop_data, path);
	if (available === -1) {
		return true;
	}
	return staged < available;
}

function add_trade_item(trade, side, path) {
	const next = normalize_trade(trade);
	next[side].items[path] = (next[side].items[path] ?? 0) + 1;
	return next;
}

function remove_trade_item(trade, side, path) {
	const next = normalize_trade(trade);
	const qty = next[side].items[path] ?? 0;
	if (qty <= 1) {
		delete next[side].items[path];
	} else {
		next[side].items[path] = qty - 1;
	}
	return next;
}

function set_trade_cash(trade, side, value) {
	const next = normalize_trade(trade);
	next[side].cash = Math.max(0, value);
	return next;
}

/**
 * Auto-balance the trade by adding cash to the side that's short.
 * If player total < merchant total, player needs to add cash.
 * If merchant total < player total, merchant needs to add cash.
 * If already balanced, no change.
 * Returns a new trade object with cash adjusted.
 */
function auto_balance_cash(trade, buyer, shop_data, customer) {
	const next = normalize_trade(trade);

	if (shop_data && shop_data.enable_cash === false) {
		next.player.cash = 0;
		next.merchant.cash = 0;
		return next;
	}

	// Calculate the balance from items only (excluding current cash)
	const items_only = normalize_trade(trade);
	items_only.player.cash = 0;
	items_only.merchant.cash = 0;
	const balance = calc_balance(items_only, buyer, shop_data, customer);

	if (balance.balanced) {
		next.player.cash = 0;
		next.merchant.cash = 0;
		return next;
	}

	const diff = balance.diff; // player.items - merchant.items

	if (diff < 0) {
		// Player's items are worth less — player needs to add cash
		next.player.cash = Math.max(0, -diff);
		next.merchant.cash = 0;
	} else {
		// Merchant's items are worth less — merchant needs to add cash
		const merchant_cash = shop_data.cash ?? -1;
		if (merchant_cash !== -1 && diff > merchant_cash) {
			next.merchant.cash = merchant_cash;
			next.player.cash = Math.max(0, diff - merchant_cash);
		} else {
			next.merchant.cash = Math.max(0, diff);
			next.player.cash = 0;
		}
	}

	return next;
}

function validate_trade(trade, buyer, shop_data, customer) {
	if (!shop.has_stock(shop_data)) {
		return { ok: false, error: "no_shop" };
	}
	const balance = calc_balance(trade, buyer, shop_data, customer);
	if (balance.errors.includes("empty_trade")) {
		return { ok: false, error: "empty_trade" };
	}
	if (balance.errors.includes("unbalanced")) {
		return { ok: false, error: "unbalanced" };
	}

	const normalized = normalize_trade(trade);
	const player_cash = buyer.system.char.cash ?? 0;
	if (normalized.player.cash > player_cash) {
		return { ok: false, error: "insufficient_cash" };
	}

	for (const [path, qty] of Object.entries(normalized.player.items)) {
		const gear = get_player_item(buyer, path);
		if (get_player_item_count(gear) < qty) {
			return { ok: false, error: "insufficient_player_items" };
		}
		if (!get_catalog_item(path) && !gear) {
			return { ok: false, error: "no_item" };
		}
	}

	for (const [path, qty] of Object.entries(normalized.merchant.items)) {
		if (!shop.is_for_sale(shop_data, path)) {
			return { ok: false, error: "unavailable" };
		}
		const available = get_merchant_piece_supply(shop_data, path);
		if (available !== -1 && qty > available) {
			return { ok: false, error: "unavailable" };
		}
		if (!get_catalog_item(path)) {
			return { ok: false, error: "no_item" };
		}
	}

	const merchant_cash = shop_data.cash ?? -1;
	if (merchant_cash !== -1 && normalized.merchant.cash > merchant_cash) {
		return { ok: false, error: "insufficient_merchant_cash" };
	}

	return { ok: true, shop_data, customer, balance };
}

function apply_stock_delta(stock, path, delta) {
	const entry = game.dc.utils.data_from_path(stock, path);
	if (delta > 0) {
		if (!entry) {
			game.dc.utils.modify_path(stock, path, { supply: delta });
			return;
		}
		const supply = entry.supply ?? -1;
		if (supply === -1) {
			return;
		}
		game.dc.utils.modify_path(stock, path, { supply: supply + delta });
		return;
	}
	if (!entry) {
		return;
	}
	const supply = entry.supply ?? -1;
	if (supply === -1) {
		return;
	}
	const next = supply + delta;
	if (next <= 0) {
		game.dc.utils.delete_path(stock, path);
	} else {
		game.dc.utils.modify_path(stock, path, { supply: next });
	}
}

async function apply_trade(buyer_id, shop_id, scene_id, trade) {
	const buyer = game.actors.get(buyer_id);
	if (!buyer) {
		return { ok: false, error: "missing_actor" };
	}

	const scene = game.scenes.get(scene_id);
	if (!scene) {
		return { ok: false, error: "missing_scene" };
	}

	// Read shop data from the boon on the region behavior
	const behavior = await fromUuid(shop_id);
	if (!behavior) {
		return { ok: false, error: "missing_shop" };
	}

	const boons = foundry.utils.getProperty(behavior, "system.boons") || [];
	const boon = boons.find(b => b.type === "open_shop");
	if (!boon) {
		return { ok: false, error: "missing_shop" };
	}

	const shop_data = shop.normalize_shop({
		haggle_tn: boon.haggle_tn,
		sell_ratio: boon.sell_ratio,
		enable_cash: boon.enable_cash,
		cash: boon.cash,
		stock: boon.stock,
	});

	const customer = await shop.get_customer(scene, shop_id, buyer_id);
	const result = validate_trade(trade, buyer, shop_data, customer);
	if (!result.ok) {
		return result;
	}

	const normalized = normalize_trade(trade);
	const stock_update = foundry.utils.deepClone(shop_data.stock);
	for (const [path, qty] of Object.entries(normalized.merchant.items)) {
		const unit_qty = get_item_unit_qty(path);
		const boxes = boxes_for_pieces(qty, unit_qty);
		if (boxes > 0) {
			apply_stock_delta(stock_update, path, -boxes);
		}
	}
	for (const [path, qty] of Object.entries(normalized.player.items)) {
		const gear = get_player_item(buyer, path);
		const unit_qty = get_item_unit_qty(path, gear);
		const boxes = Math.floor(qty / unit_qty);
		if (boxes > 0) {
			apply_stock_delta(stock_update, path, boxes);
		}
	}

	// Update the boon stock on the region behavior
	await shop.update_boon_stock(shop_id, (stock) => {
		// Replace the stock with the updated version
		Object.keys(stock).forEach(k => delete stock[k]);
		Object.assign(stock, stock_update);
	});

	// Update merchant cash on the boon if limited
	const merchant_cash = shop_data.cash ?? -1;
	if (merchant_cash !== -1) {
		const new_cash = merchant_cash - normalized.merchant.cash + normalized.player.cash;
		const boons2 = foundry.utils.deepClone(
			foundry.utils.getProperty(behavior, "system.boons") || []
		);
		const boon2 = boons2.find(b => b.type === "open_shop");
		if (boon2) {
			boon2.cash = new_cash;
			const idx = boons2.indexOf(boon2);
			boons2[idx] = boon2;
			await behavior.update({ "system.boons": boons2 });
		}
	}

	// Update buyer
	await game.dc.utils.save_actor(buyer, (system) => {
		system.char.cash = (system.char.cash ?? 0) - normalized.player.cash + normalized.merchant.cash;
		for (const [path, qty] of Object.entries(normalized.player.items)) {
			game.dc.act.items.remove({ system }, path, qty);
		}
		for (const [path, qty] of Object.entries(normalized.merchant.items)) {
			game.dc.act.items.modify({ system }, path, qty);
		}
	});

	return { ok: true };
}

const barter = {
	empty_trade,
	normalize_trade,
	calc_sell_price,
	build_player_inventory,
	build_merchant_inventory,
	calc_balance,
	can_add_trade_item,
	add_trade_item,
	remove_trade_item,
	set_trade_cash,
	auto_balance_cash,
	validate_trade,
	apply_trade
};

export { barter };