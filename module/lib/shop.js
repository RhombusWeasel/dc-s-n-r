import { roll_combat } from "./roll_combat.js";
import { gear_catalog } from "./gear_catalog.js";
import { socket_utils } from "./socket.js";

const DEFAULT_SHOP = {
	enabled: true,
	haggle_tn: 5,
	sell_ratio: 0.5,
	cash: -1,
	stock: {},
	customers: {}
};

function parse_sell_ratio(value) {
	if (value == null || value === "") {
		return 0.5;
	}
	const n = Number(value);
	return Number.isFinite(n) ? n : 0.5;
}

function default_shop() {
	return foundry.utils.deepClone(DEFAULT_SHOP);
}

function normalize_shop(shop = {}) {
	return {
		enabled: shop.enabled ?? true,
		haggle_tn: shop.haggle_tn ?? 5,
		sell_ratio: parse_sell_ratio(shop.sell_ratio),
		cash: shop.cash ?? -1,
		stock: shop.stock ? { ...shop.stock } : {},
		customers: shop.customers ? { ...shop.customers } : {}
	};
}

function migrate_old_shop(old_shop = {}) {
	const haggle_tn = old_shop.haggle_tn ?? 5;
	const customers = old_shop.customers || {};

	const stock = {};
	const add_stock = (path, supply = -1) => {
		game.dc.utils.modify_path(stock, path, { supply });
	};

	if (Array.isArray(old_shop.excluded) || (old_shop.supply && !old_shop.stock)) {
		for (const entry of gear_catalog.iterate_catalog()) {
			if (old_shop.excluded?.includes(entry.path)) {
				continue;
			}
			add_stock(entry.path, old_shop.supply?.[entry.path] ?? -1);
		}
		return { enabled: old_shop.enabled ?? true, haggle_tn, sell_ratio: old_shop.sell_ratio ?? 0.5, cash: old_shop.cash ?? -1, stock, customers };
	}

	const raw_stock = old_shop.stock;
	if (!raw_stock || typeof raw_stock !== "object") {
		return { enabled: old_shop.enabled ?? true, haggle_tn, sell_ratio: old_shop.sell_ratio ?? 0.5, cash: old_shop.cash ?? -1, stock: {}, customers };
	}

	for (const entry of gear_catalog.iterate_catalog()) {
		const existing = game.dc.utils.data_from_path(raw_stock, entry.path);
		if (!existing || typeof existing !== "object") {
			continue;
		}
		if ("label" in existing) {
			add_stock(entry.path, existing.supply ?? -1);
			continue;
		}
		if ("sold" in existing && !existing.sold) {
			continue;
		}
		if ("supply" in existing || !("sold" in existing)) {
			add_stock(entry.path, existing.supply ?? -1);
		}
	}

	return { enabled: old_shop.enabled ?? true, haggle_tn, sell_ratio: old_shop.sell_ratio ?? 0.5, cash: old_shop.cash ?? -1, stock, customers };
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

function toggle_stock(shop, path) {
	const stock = foundry.utils.deepClone(normalize_shop(shop).stock);
	if (game.dc.utils.data_from_path(stock, path) !== undefined) {
		game.dc.utils.delete_path(stock, path);
	} else {
		game.dc.utils.modify_path(stock, path, { supply: -1 });
	}
	return stock;
}

function set_supply(shop, path, value) {
	const stock = foundry.utils.deepClone(normalize_shop(shop).stock);
	if (game.dc.utils.data_from_path(stock, path) === undefined) {
		return stock;
	}
	game.dc.utils.modify_path(stock, path, { supply: value });
	return stock;
}

function get_catalog_item(path) {
	return gear_catalog.get_catalog_item(path);
}

function get_customer(shop, customer_id) {
	const normalized = normalize_shop(shop);
	return normalized.customers[customer_id] || { opinion: 0, price_modifier_pct: 0 };
}

function get_or_create_customer(shop, customer_id) {
	const normalized = normalize_shop(shop);
	if (!normalized.customers[customer_id]) {
		normalized.customers[customer_id] = { opinion: 0, price_modifier_pct: 0 };
	}
	return normalized.customers[customer_id];
}

function calc_price(base_cost, customer) {
	const pct = customer?.price_modifier_pct || 0;
	return Math.max(0, Math.round(base_cost * (1 + pct / 100)));
}

async function evaluate_haggle(roll, tn) {
	return roll_combat.evaluate_ex_roll(roll, tn);
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

function build_catalog_context(shop = {}) {
	const normalized = normalize_shop(shop);
	const sections = {
		ammo: [],
		armour: [],
		melee: [],
		ranged: [],
		thrown: [],
		explosives: [],
		misc: [],
		goods: [],
		services: []
	};
	for (const entry of gear_catalog.iterate_catalog()) {
		const for_sale = is_for_sale(normalized, entry.path);
		sections[entry.category].push({
			path: entry.path,
			key: entry.key,
			label: entry.item?.label || entry.key,
			cost: entry.item?.cost ?? 0,
			for_sale,
			supply: for_sale ? get_supply(normalized, entry.path) : -1
		});
	}
	return sections;
}

function build_customers_context(customers = {}) {
	const rows = [];
	for (const [actor_id, record] of Object.entries(customers)) {
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

function build_player_catalog(shop = {}, customer) {
	const normalized = normalize_shop(shop);
	const sections = {};
	for (const entry of gear_catalog.iterate_catalog()) {
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

function build_purchase(buyer, shop_actor, path, customer_id) {
	const shop = normalize_shop(shop_actor.system.shop);
	if (!shop_actor.system.shop || !has_stock(shop)) {
		return { ok: false, error: "no_shop" };
	}
	if (!is_for_sale(shop, path)) {
		return { ok: false, error: "unavailable" };
	}
	const item = get_catalog_item(path);
	if (!item) {
		return { ok: false, error: "no_item" };
	}
	const customer = get_customer(shop, customer_id);
	const price = calc_price(item.cost, customer);
	if ((buyer.system.char.cash ?? 0) < price) {
		return { ok: false, error: "insufficient_cash" };
	}
	return { ok: true, path, price, customer_id, item, shop };
}

async function apply_purchase(buyer_id, shop_id, path, customer_id, user_id) {
	if (!buyer_owned_by_user(buyer_id, user_id)) {
		return { ok: false, error: "missing_actor" };
	}
	const buyer = game.actors.get(buyer_id);
	const shop_actor = game.actors.get(shop_id);
	if (!buyer || !shop_actor) {
		return { ok: false, error: "missing_actor" };
	}
	const result = build_purchase(buyer, shop_actor, path, customer_id);
	if (!result.ok) {
		return result;
	}

	const qty = result.item.quantity ?? 1;
	const shop_data = normalize_shop(shop_actor.system.shop);
	get_or_create_customer(shop_data, customer_id);
	const supply = get_supply(shop_data, path);
	const stock_update = foundry.utils.deepClone(shop_data.stock);
	if (supply > 0) {
		game.dc.utils.modify_path(stock_update, path, { supply: supply - 1 });
	}

	await game.dc.utils.save_actor(buyer, (system) => {
		system.char.cash -= result.price;
		game.dc.act.items.modify({ system }, path, qty);
	});
	await game.dc.utils.save_actor(shop_actor, {
		"system.shop.stock": stock_update,
		"system.shop.customers": shop_data.customers
	});
	return { ok: true, price: result.price };
}

async function apply_haggle_update(shop_id, buyer_id, success, raises, user_id) {
	if (!buyer_owned_by_user(buyer_id, user_id)) {
		return { ok: false, error: "missing_actor" };
	}
	const shop_actor = game.actors.get(shop_id);
	if (!shop_actor) {
		return { ok: false, error: "missing_shop" };
	}
	const shop_data = normalize_shop(shop_actor.system.shop);
	const customer = get_or_create_customer(shop_data, buyer_id);
	apply_haggle(customer, success, raises);
	await game.dc.utils.save_actor(shop_actor, {
		[`system.shop.customers.${buyer_id}`]: foundry.utils.deepClone(customer)
	});
	return { ok: true, customer: foundry.utils.deepClone(customer) };
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
		if (sheet && sheet.shop_actor) {
			emit_open_shop(sheet.shop_actor.id, sheet.buyer_id);
		}
	}
	refresh_open_shop_sheet(data.shop_id);
}

function refresh_open_shop_sheet(shop_id) {
	const sheet = _open_sheet;
	if (!sheet || sheet.shop_actor?.id !== shop_id) {
		return;
	}
	sheet.shop_actor = game.actors.get(shop_id) || sheet.shop_actor;
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

function handle_socket(payload, options = {}) {
	const { operation, data, senderId } = payload;

	// Handle socket_utils.emit format (msg-based, from brokered flow)
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
		case "open_shop":
			handle_open_shop({ msg, sender: msg_sender });
			break;
		case "trade":
			if (senderId === game.user.id) {
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

// ─── GM-brokered shop data (no observer permission required) ──────────────────

/**
 * Player-side cache: npc_id → sanitized shop data.
 * Populated by the `shop_data` socket response from the GM.
 */
const shop_data_cache = new Map();

/**
 * Get cached shop data for an NPC (player-side).
 * @param {string} npc_id
 * @returns {object|null}
 */
function get_cached_shop_data(npc_id) {
	return shop_data_cache.get(npc_id) || null;
}

/**
 * GM-side: handle an open_shop request from a player.
 * Reads the NPC actor, builds a sanitized shop object + the buyer's customer
 * record, and sends it back via socket.
 * @param {object} data — socket packet { msg: { npc_id, buyer_id }, sender, ... }
 */
function handle_open_shop(data) {
	if (!game.user.isGM) return;

	const msg = data.msg;
	const npc_id = msg.npc_id;
	const buyer_id = msg.buyer_id;
	if (!npc_id) return;

	const shop_actor = game.actors.get(npc_id);

	let shop = null;
	let customer = null;

	if (shop_actor && shop_actor.type === 'npc') {
		const raw_shop = normalize_shop(shop_actor.system.shop);
		if (raw_shop.enabled && has_stock(raw_shop)) {
			shop = foundry.utils.deepClone(raw_shop);
			customer = buyer_id
				? foundry.utils.deepClone(get_customer(raw_shop, buyer_id))
				: { opinion: 0, price_modifier_pct: 0 };
		}
	}

	socket_utils_emit('shop', data.sender, {
		operation: 'shop_data',
		npc_id,
		shop,
		customer,
	});
}

/**
 * Player-side: handle a shop_data response from the GM.
 * Stores the data in the cache and re-renders the open sheet.
 * @param {object} payload — { data: { npc_id, shop, customer } }
 */
// fallow-ignore-next-line complexity
function handle_shop_data(payload) {
	if (game.user.isGM) return;

	const data = payload.msg || payload.data || payload;
	const npc_id = data.npc_id;
	if (!npc_id) return;

	if (!data.shop) {
		shop_data_cache.delete(npc_id);
		const sheet = _open_sheet;
		if (sheet && sheet.shop_actor?.id === npc_id) {
			sheet.close();
		}
		return;
	}

	const prev = shop_data_cache.get(npc_id);
	shop_data_cache.set(npc_id, {
		shop: data.shop,
		customer: data.customer ?? prev?.customer ?? { opinion: 0, price_modifier_pct: 0 },
	});

	const sheet = _open_sheet;
	if (sheet && sheet.shop_actor?.id === npc_id) {
		sheet.render(true);
	}
}

/**
 * Request shop data from the GM (player-side).
 * @param {string} npc_id
 * @param {string} buyer_id
 */
function emit_open_shop(npc_id, buyer_id) {
	socket_utils_emit('shop', 'gm', {
		operation: 'open_shop',
		npc_id,
		buyer_id,
	});
}

/**
 * GM-side: broadcast current shop data for an NPC to all clients.
 * Called when the GM modifies the shop so players with the sheet open see updates.
 * @param {Actor} shop_actor
 */
// fallow-ignore-next-line complexity
function broadcast_shop_update(shop_actor) {
	if (!game.user.isGM) return;
	if (!shop_actor || shop_actor.type !== 'npc') return;
	if (!shop_actor.system?.shop) return;

	const raw_shop = normalize_shop(shop_actor.system.shop);
	if (!raw_shop.enabled || !has_stock(raw_shop)) return;

	socket_utils_emit('shop', 'all', {
		operation: 'shop_data',
		npc_id: shop_actor.id,
		shop: foundry.utils.deepClone(raw_shop),
		customer: null,
	});
}

/**
 * Called from the updateActor hook to detect shop changes and push
 * fresh data to players with the shop sheet open.
 * @param {Actor} actor
 * @param {object} changed — the diff object from Foundry's update
 */
// fallow-ignore-next-line complexity
function on_actor_update(actor, changed) {
	if (!game.user.isGM) return;
	if (actor.type !== 'npc') return;
	if (foundry.utils.getProperty(changed, 'system.shop') === undefined) return;
	console.debug('Smith & Robards | shop sync: detected shop update on', actor.name);
	broadcast_shop_update(actor);
}

// fallow-ignore-next-line complexity
async function open_player_sheet(shop_actor) {
	if (game.user.isGM) {
		const shop = normalize_shop(shop_actor.system.shop);
		if (!shop_actor.system.shop || !shop.enabled || !has_stock(shop)) {
			return false;
		}
	}
	if (_open_sheet?.shop_actor?.id === shop_actor.id) {
		if (!game.user.isGM) {
			emit_open_shop(shop_actor.id, _open_sheet.buyer_id);
		} else {
			_open_sheet.render(true);
		}
		return true;
	}
	const { NpcShopSheet } = await import("../sheets/shop_sheet.js");
	NpcShopSheet.show(shop_actor);
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
	default_shop,
	normalize_shop,
	migrate_old_shop,
	get_supply,
	is_for_sale,
	has_stock,
	toggle_stock,
	set_supply,
	get_catalog_item,
	get_customer,
	get_or_create_customer,
	calc_price,
	evaluate_haggle,
	apply_haggle,
	build_streetwise_formula,
	build_catalog_context,
	build_customers_context,
	build_player_catalog,
	get_owned_characters,
	buyer_owned_by_user,
	build_purchase,
	apply_purchase,
	apply_haggle_update,
	request_trade,
	emit: shop_emit,
	handle_socket,
	open_player_sheet,
	_open_sheet: null, // kept for backwards compat — use get_open_sheet/set_open_sheet
	get_cached_shop_data,
	emit_open_shop,
	broadcast_shop_update,
	on_actor_update,
	set_open_sheet,
	get_open_sheet,
};

export { shop, set_open_sheet, get_open_sheet, SOCKET_CHANNEL };