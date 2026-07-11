/**
 * Shop engine — manages shop data, purchases, haggling, and trade.
 *
 * In the boon-based architecture, shop config (shopkeeper_name, haggle_tn,
 * sell_ratio, cash, stock) lives on the boon attached to a dcBoonRegion
 * behavior. Customer data (per-player opinion + price modifier) lives in
 * scene flags. No NPC actor is required.
 */

const DEFAULT_SHOP = {
	enabled: true,
	haggle_tn: 5,
	sell_ratio: 0.5,
	cash: -1,
	stock: {},
};

function parse_sell_ratio(value) {
	if (value == null || value === "") {
		return 0.5;
	}
	const n = Number(value);
	return Number.isFinite(n) ? n : 0.5;
}

function normalize_shop(shop = {}) {
	return {
		enabled: shop.enabled ?? true,
		haggle_tn: shop.haggle_tn ?? 5,
		sell_ratio: parse_sell_ratio(shop.sell_ratio),
		enable_cash: shop.enable_cash ?? true,
		cash: shop.cash ?? -1,
		stock: shop.stock ? { ...shop.stock } : {},
	};
}

function get_stock_entry(shop, path) {
	return game.dc.utils.data_from_path(normalize_shop(shop).stock, path);
}

function get_supply(shop, path) {
	const entry = get_stock_entry(shop, path);
	if (!entry) {
		return -1;
	}
	return entry.supply ?? -1;
}

function is_for_sale(shop, path) {
	const entry = get_stock_entry(shop, path);
	if (!entry) {
		return false;
	}
	return (entry.supply ?? -1) !== 0;
}

function walk_stock(stock, fn, prefix = "") {
	if (!stock || typeof stock !== "object") {
		return;
	}
	for (const [key, value] of Object.entries(stock)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && "supply" in value) {
			fn(path, value);
		} else if (value && typeof value === "object") {
			walk_stock(value, fn, path);
		}
	}
}

function has_stock(shop) {
	let found = false;
	walk_stock(normalize_shop(shop).stock, (path, entry) => {
		if ((entry.supply ?? -1) !== 0) {
			found = true;
		}
	});
	return found;
}

function get_catalog_item(path) {
	return game.dc.gear_catalog.get_catalog_item(path);
}

// ─── Customer data (scene flags) ──────────────────────────────────────────

async function get_customer(scene, shop_id, customer_id) {
	const customers = scene?.getFlag("smith-and-robards", "customers") || {};
	return customers[shop_id]?.[customer_id] || { opinion: 0, price_modifier_pct: 0 };
}

async function get_or_create_customer(scene, shop_id, customer_id) {
	const customers = scene?.getFlag("smith-and-robards", "customers") || {};
	if (!customers[shop_id]) customers[shop_id] = {};
	if (!customers[shop_id][customer_id]) {
		customers[shop_id][customer_id] = { opinion: 0, price_modifier_pct: 0 };
		await scene.setFlag("smith-and-robards", "customers", customers);
	}
	return customers[shop_id][customer_id];
}

async function update_customer(scene, shop_id, customer_id, update_fn) {
	const customers = foundry.utils.deepClone(
		scene?.getFlag("smith-and-robards", "customers") || {}
	);
	if (!customers[shop_id]) customers[shop_id] = {};
	if (!customers[shop_id][customer_id]) {
		customers[shop_id][customer_id] = { opinion: 0, price_modifier_pct: 0 };
	}
	update_fn(customers[shop_id][customer_id]);
	await scene.setFlag("smith-and-robards", "customers", customers);
	return foundry.utils.deepClone(customers[shop_id][customer_id]);
}

async function build_customers_context(scene, shop_id) {
	const customers = scene?.getFlag("smith-and-robards", "customers") || {};
	const shop_customers = customers[shop_id] || {};
	const rows = [];
	for (const [actor_id, record] of Object.entries(shop_customers)) {
		const actor = game.actors.get(actor_id);
		rows.push({
			actor_id,
			name: actor?.name || actor_id,
			opinion: record.opinion ?? 0,
			price_modifier_pct: record.price_modifier_pct ?? 0
		});
	}
	rows.sort((a, b) => a.name.localeCompare(b.name));
	return rows;
}

function calc_price(base_cost, customer) {
	const pct = customer?.price_modifier_pct || 0;
	return Math.max(0, Math.round(base_cost * (1 + pct / 100)));
}

async function evaluate_haggle(roll, tn) {
	return game.dc.roll_combat.evaluate_ex_roll(roll, tn);
}

function apply_haggle(customer, success, raises) {
	if (success) {
		customer.price_modifier_pct = (customer.price_modifier_pct || 0) - 5 * (raises || 0);
		customer.opinion = (customer.opinion || 0) + 1;
	} else {
		customer.price_modifier_pct = (customer.price_modifier_pct || 0) + 5;
		customer.opinion = (customer.opinion || 0) - 1;
	}
}

function build_streetwise_formula(buyer) {
	const sk = buyer.system.char.skills?.streetwise;
	const trait = buyer.system.char.attributes?.smarts;
	if (!sk || !trait) {
		return null;
	}
	if (sk.value === 0) {
		const revised = game.settings.get("Deadlands-Classic", "updated_unskilled_checks");
		if (revised) {
			return `1d${trait.sides}ex - 4`;
		}
		return `${trait.value}d${trait.sides}ex - 4`;
	}
	return `${sk.value}d${trait.sides}ex + ${sk.mod + trait.mod}`;
}

function build_player_catalog(shop = {}, customer) {
	const normalized = normalize_shop(shop);
	const sections = {};
	for (const entry of game.dc.gear_catalog.iterate_catalog()) {
		if (!is_for_sale(normalized, entry.path)) {
			continue;
		}
		const category = entry.category;
		sections[category] = sections[category] || [];
		sections[category].push({
			path: entry.path,
			key: entry.key,
			label: entry.item?.label || entry.key,
			base_cost: entry.item?.cost ?? 0,
			price: calc_price(entry.item?.cost ?? 0, customer),
			supply: get_supply(normalized, entry.path)
		});
	}
	return sections;
}

function get_owned_characters() {
	return game.actors.filter(a => a.type === "character" && a.isOwner);
}

function buyer_owned_by_user(buyer_id, user_id) {
	if (!user_id) {
		return true;
	}
	const user = game.users.get(user_id);
	if (user?.isGM) {
		return true;
	}
	const buyer = game.actors.get(buyer_id);
	if (!buyer || !user) {
		return false;
	}
	return buyer.testUserPermission(user, "OWNER");
}

// ─── Socket: module.smith-and-robards channel ─────────────────────────────

const SOCKET_CHANNEL = "module.smith-and-robards";

function shop_emit(operation, data) {
	const payload = { event: "shop", operation, data, senderId: game.user.id };
	game.socket.emit(SOCKET_CHANNEL, payload);
	if (game.user.isGM) {
		handle_socket(payload, { local: true });
	}
}

function handle_socket(payload, options = {}) {
	const { operation, data, senderId } = payload;

	const msg = payload.msg || payload.data;
	const msg_op = msg?.operation || operation;
	const msg_sender = payload.sender || senderId;

	// shop_data response (player-side — handled before GM check)
	if (msg_op === "shop_data") {
		handle_shop_data(payload);
		return;
	}

	if (operation === "trade_result") {
		handle_trade_result(data);
		return;
	}

	if (!game.user.isGM) {
		return;
	}

	switch (msg_op) {
		case "request_shop_data":
			handle_request_shop_data({ msg, sender: msg_sender });
			break;
		case "trade":
			if (senderId === game.user.id && !options.local) {
				return;
			}
			void apply_trade_request(data);
			break;
		case "haggle":
			if (!options.local && senderId === game.user.id) {
				return;
			}
			void apply_haggle_update(
				data.shop_id,
				data.scene_id,
				data.buyer_id,
				data.success,
				data.raises,
				data.user_id
			).then(result => {
				if (result.ok && data.user_id) {
					_notify_buyer(data.user_id, "haggle_ok");
				}
			});
			break;
	}
}

function _notify_buyer(user_id, key) {
	if (user_id !== game.user.id) {
		return;
	}
	ui.notifications.info(game.i18n.localize(`dc.shop.${key}`));
	if (_open_sheet) {
		_open_sheet.render(true);
	}
}

// ─── GM-brokered shop data ─────────────────────────────────────────────────

const shop_data_cache = new Map();

function get_cached_shop_data(shop_id) {
	return shop_data_cache.get(shop_id) || null;
}

/**
 * GM-side: handle a request_shop_data from a player.
 * Reads the boon from the region behavior, builds a sanitized shop object +
 * the buyer's customer record (from scene flags), and sends it back.
 */
async function handle_request_shop_data(data) {
	if (!game.user.isGM) return;

	const msg = data.msg;
	const shop_id = msg.shop_id;
	const buyer_id = msg.buyer_id;
	const scene_id = msg.scene_id;
	if (!shop_id) return;

	const scene = game.scenes.get(scene_id);
	if (!scene) return;

	// Find the region behavior by UUID
	const behavior = await fromUuid(shop_id);
	if (!behavior) return;

	// Read the open_shop boon from the behavior
	const boons = foundry.utils.getProperty(behavior, "system.boons") || [];
	const boon = boons.find(b => b.type === "open_shop");
	if (!boon) return;

	const shop = normalize_shop({
		haggle_tn: boon.haggle_tn,
		sell_ratio: boon.sell_ratio,
		enable_cash: boon.enable_cash,
		cash: boon.cash,
		stock: boon.stock,
	});

	if (!has_stock(shop)) return;

	const customer = buyer_id
		? foundry.utils.deepClone(await get_customer(scene, shop_id, buyer_id))
		: { opinion: 0, price_modifier_pct: 0 };

	socket_utils_emit("shop", data.sender, {
		operation: "shop_data",
		shop_id,
		shop,
		customer,
	});
}

/**
 * Player-side: handle a shop_data response from the GM.
 */
function handle_shop_data(payload) {
	if (game.user.isGM) return;

	const data = payload.msg || payload.data || payload;
	const shop_id = data.shop_id;
	if (!shop_id) return;

	if (!data.shop) {
		shop_data_cache.delete(shop_id);
		const sheet = _open_sheet;
		if (sheet && sheet.shop_id === shop_id) {
			sheet.close();
		}
		return;
	}

	const prev = shop_data_cache.get(shop_id);
	shop_data_cache.set(shop_id, {
		shop: data.shop,
		customer: data.customer ?? prev?.customer ?? { opinion: 0, price_modifier_pct: 0 },
	});

	const sheet = _open_sheet;
	if (sheet && sheet.shop_id === shop_id) {
		sheet.render(true);
	}
}

/**
 * Player-side: request shop data from the GM.
 */
function emit_request_shop_data(shop_id, buyer_id, scene_id) {
	socket_utils_emit("shop", "gm", {
		operation: "request_shop_data",
		shop_id,
		buyer_id,
		scene_id,
	});
}

// ─── Boon stock update (GM-side) ──────────────────────────────────────────

/**
 * GM-side: update the boon stock on a region behavior.
 * @param {string} behavior_uuid — the region behavior UUID
 * @param {Function} update_fn — (stock) => void, mutates the stock object
 */
async function update_boon_stock(behavior_uuid, update_fn) {
	const behavior = await fromUuid(behavior_uuid);
	if (!behavior) return;

	const boons = foundry.utils.deepClone(
		foundry.utils.getProperty(behavior, "system.boons") || []
	);
	const boon = boons.find(b => b.type === "open_shop");
	if (!boon) return;

	const stock = boon.stock || {};
	update_fn(stock);
	boon.stock = stock;

	const idx = boons.indexOf(boon);
	boons[idx] = boon;
	await behavior.update({ "system.boons": boons });
}

// ─── Purchase ──────────────────────────────────────────────────────────────

function build_purchase(buyer, shop_data, path, customer) {
	if (!has_stock(shop_data)) {
		return { ok: false, error: "no_shop" };
	}
	if (!is_for_sale(shop_data, path)) {
		return { ok: false, error: "unavailable" };
	}
	const item = get_catalog_item(path);
	if (!item) {
		return { ok: false, error: "no_item" };
	}
	const price = calc_price(item.cost, customer);
	if ((buyer.system.char.cash ?? 0) < price) {
		return { ok: false, error: "insufficient_cash" };
	}
	return { ok: true, path, price, customer, item, shop_data };
}

// ─── Haggle ─────────────────────────────────────────────────────────────────

async function apply_haggle_update(shop_id, scene_id, buyer_id, success, raises, user_id) {
	if (!buyer_owned_by_user(buyer_id, user_id)) {
		return { ok: false, error: "missing_actor" };
	}
	const scene = game.scenes.get(scene_id);
	if (!scene) {
		return { ok: false, error: "missing_scene" };
	}
	const customer = await update_customer(scene, shop_id, buyer_id, (c) => {
		apply_haggle(c, success, raises);
	});
	return { ok: true, customer: foundry.utils.deepClone(customer) };
}

// ─── Trade ──────────────────────────────────────────────────────────────────

function notify_trade_client(user_id, shop_id, ok, error = null) {
	game.socket.emit(SOCKET_CHANNEL, {
		event: "shop",
		operation: "trade_result",
		data: { user_id, shop_id, ok, error }
	});
}

function handle_trade_result(data) {
	if (data.user_id !== game.user.id) {
		return;
	}
	if (!data.ok) {
		const key = data.error ? `dc.shop.errors.${data.error}` : "dc.shop.errors.unbalanced";
		ui.notifications.warn(game.i18n.localize(key));
		return;
	}
	ui.notifications.info(game.i18n.localize("dc.shop.trade_ok"));
	if (!game.user.isGM) {
		const sheet = _open_sheet;
		if (sheet && sheet.shop_id) {
			emit_request_shop_data(sheet.shop_id, sheet.buyer_id, sheet.scene_id);
		}
	}
	refresh_open_shop_sheet(data.shop_id);
}

function refresh_open_shop_sheet(shop_id) {
	const sheet = _open_sheet;
	if (!sheet || sheet.shop_id !== shop_id) {
		return;
	}
	sheet.trade = game.dc.barter.empty_trade();
	sheet.render(true);
}

async function apply_trade_request(data) {
	if (!game.user.isGM) {
		return { ok: false, error: "missing_actor" };
	}
	const result = await game.dc.barter.apply_trade(
		data.buyer_id,
		data.shop_id,
		data.scene_id,
		data.trade
	);
	if (result.ok) {
		refresh_open_shop_sheet(data.shop_id);
	}
	notify_trade_client(data.user_id, data.shop_id, result.ok, result.error ?? null);
	if (data.user_id === game.user.id) {
		handle_trade_result({
			user_id: data.user_id,
			shop_id: data.shop_id,
			ok: result.ok,
			error: result.error ?? null
		});
	}
	return result;
}

function request_trade(data) {
	const payload = { event: "shop", operation: "trade", data, senderId: game.user.id };
	game.socket.emit(SOCKET_CHANNEL, payload);
	if (game.user.isGM) {
		void apply_trade_request(data);
	}
}

// ─── Open shop sheet ─────────────────────────────────────────────────────────

async function open_shop_sheet(shop_data, shop_id, scene, buyer_actor) {
	const buyer_id = buyer_actor?.id
		|| game.user.character?.id
		|| get_owned_characters()[0]?.id
		|| "";
	const scene_id = scene?.id || "";

	if (_open_sheet?.shop_id === shop_id) {
		if (!game.user.isGM) {
			emit_request_shop_data(shop_id, buyer_id, scene_id);
		} else {
			_open_sheet.render(true);
		}
		return true;
	}

	const { NpcShopSheet } = await import("../sheets/shop_sheet.js");
	NpcShopSheet.show(shop_data, shop_id, scene_id, buyer_id);
	return true;
}

// ─── Internal: socket emit on module channel ──────────────────────────────

function socket_utils_emit(event, target, data) {
	if (game.socket) {
		game.socket.emit(SOCKET_CHANNEL, {
			event: event,
			msg: data,
			sender: game.user.id,
			target: target,
			character: game.user.character,
			timestamp: Date.now(),
		});
	}
}

// ─── Module state ─────────────────────────────────────────────────────────

let _open_sheet = null;

function set_open_sheet(sheet) {
	_open_sheet = sheet;
}

function get_open_sheet() {
	return _open_sheet;
}

const shop = {
	DEFAULT_SHOP,
	parse_sell_ratio,
	normalize_shop,
	get_supply,
	is_for_sale,
	has_stock,
	get_catalog_item,
	get_customer,
	get_or_create_customer,
	update_customer,
	build_customers_context,
	calc_price,
	evaluate_haggle,
	apply_haggle,
	build_streetwise_formula,
	build_player_catalog,
	get_owned_characters,
	buyer_owned_by_user,
	build_purchase,
	apply_haggle_update,
	update_boon_stock,
	request_trade,
	emit: shop_emit,
	handle_socket,
	open_shop_sheet,
	get_cached_shop_data,
	emit_request_shop_data,
	set_open_sheet,
	get_open_sheet,
};

export { shop, set_open_sheet, get_open_sheet, SOCKET_CHANNEL };