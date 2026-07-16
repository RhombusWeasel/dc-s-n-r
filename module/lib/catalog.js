import { shop } from "./shop.js";

const WEAPON_SECTIONS = [
	{ id: "melee", header_key: "dc.gear.melee", column_type: "melee" },
	{ id: "ranged", header_key: "dc.gear.ranged", column_type: "ranged" },
	{ id: "thrown", header_key: "dc.gear.thrown", column_type: "thrown" },
	{ id: "explosives", header_key: "dc.gear.explosives", column_type: "explosives" },
];

const TOP_SECTIONS = [
	{ id: "ammo", header_key: "dc.gear.ammo", column_type: "ammo" },
	{ id: "armour", header_key: "dc.gear.armour", column_type: "armour" },
	{ id: "goods", header_key: "dc.gear.goods", column_type: "goods" },
];

function get_owned_count(buyer, path) {
	if (!buyer) {
		return 0;
	}
	const gear = game.dc.utils.data_from_path(buyer, `system.char.gear.${path}`);
	return gear?.count ?? 0;
}

function build_catalog_item(entry, shop_data, buyer, order) {
	const item = entry.item;
	const unit_qty = item?.quantity ?? 1;
	const supply_boxes = shop.get_supply(shop_data, entry.path);
	const supply = supply_boxes === -1 ? -1 : supply_boxes * unit_qty;

	return {
		path: entry.path,
		label: item?.label || entry.key,
		rarity: item?.rarity,
		weight: item?.weight,
		price: item?.cost ?? 0,
		supply,
		owned_count: get_owned_count(buyer, entry.path),
		order_qty: get_order_qty(order, entry.path),
		quantity: unit_qty,
		damage_die: item?.damage_die,
		damage_sides: item?.damage_sides,
		damage_mod: item?.damage_mod,
		calibur: item?.calibur,
		armour_rating: item?.armour_rating,
	};
}

function build_section(section_def, items_by_category) {
	const items = items_by_category[section_def.id] || [];
	if (items.length === 0) {
		return null;
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return {
		id: section_def.id,
		header_key: section_def.header_key,
		column_type: section_def.column_type,
		items,
	};
}

function build_catalog_sections(shop_data, buyer, order = null) {
	const normalized = shop.normalize_shop(shop_data);
	const items_by_category = {};
	const normalized_order = normalize_order(order);

	for (const entry of game.dc.gear_catalog.iterate_catalog()) {
		if (!shop.is_for_sale(normalized, entry.path)) {
			continue;
		}
		const category = entry.category;
		items_by_category[category] = items_by_category[category] || [];
		items_by_category[category].push(build_catalog_item(entry, normalized, buyer, normalized_order));
	}

	const sections = [];
	const weapon_sections = WEAPON_SECTIONS
		.map((def) => build_section(def, items_by_category))
		.filter(Boolean);

	if (weapon_sections.length > 0) {
		sections.push({
			type: "group_header",
			header_key: "dc.gear.weapons",
		});
		sections.push(...weapon_sections);
	}

	for (const def of TOP_SECTIONS) {
		const section = build_section(def, items_by_category);
		if (section) {
			sections.push(section);
		}
	}

	return sections;
}

function empty_order() {
	return { items: {} };
}

function normalize_order(order = {}) {
	return {
		items: order.items ? { ...order.items } : {},
	};
}

function get_item_unit_qty(path) {
	const item = shop.get_catalog_item(path);
	const qty = item?.quantity ?? 1;
	return qty > 0 ? qty : 1;
}

function get_supply_pieces(shop_data, path) {
	const supply_boxes = shop.get_supply(shop_data, path);
	if (supply_boxes === -1) {
		return -1;
	}
	return supply_boxes * get_item_unit_qty(path);
}

function pieces_to_boxes(path, pieces) {
	const unit_qty = get_item_unit_qty(path);
	return pieces / unit_qty;
}

function get_order_qty(order, path) {
	return normalize_order(order).items[path] ?? 0;
}

function get_unit_price(path) {
	const item = shop.get_catalog_item(path);
	return item?.cost ?? 0;
}

function get_line_total(path, pieces) {
	return get_unit_price(path) * pieces_to_boxes(path, pieces);
}

function calc_order_total(order, shop_data) {
	const normalized = shop.normalize_shop(shop_data);
	let total = 0;
	for (const [path, pieces] of Object.entries(normalize_order(order).items)) {
		if (pieces <= 0 || !shop.is_for_sale(normalized, path)) {
			continue;
		}
		total += get_line_total(path, pieces);
	}
	return total;
}

function can_add_order_item(order, path, shop_data) {
	const normalized_shop = shop.normalize_shop(shop_data);
	if (!shop.is_for_sale(normalized_shop, path)) {
		return false;
	}
	const unit_qty = get_item_unit_qty(path);
	const supply_pieces = get_supply_pieces(normalized_shop, path);
	if (supply_pieces === 0) {
		return false;
	}
	if (supply_pieces === -1) {
		return true;
	}
	return get_order_qty(order, path) + unit_qty <= supply_pieces;
}

function add_order_item(order, path) {
	const next = normalize_order(order);
	const unit_qty = get_item_unit_qty(path);
	next.items[path] = (next.items[path] ?? 0) + unit_qty;
	return next;
}

function remove_order_item(order, path) {
	const next = normalize_order(order);
	const unit_qty = get_item_unit_qty(path);
	const qty = next.items[path] ?? 0;
	if (qty <= unit_qty) {
		delete next.items[path];
	} else {
		next.items[path] = qty - unit_qty;
	}
	return next;
}

function clear_order() {
	return empty_order();
}

function build_order_summary(order, shop_data) {
	const normalized = shop.normalize_shop(shop_data);
	const rows = [];
	for (const [path, pieces] of Object.entries(normalize_order(order).items)) {
		if (pieces <= 0 || !shop.is_for_sale(normalized, path)) {
			continue;
		}
		const item = shop.get_catalog_item(path);
		rows.push({
			path,
			label: item?.label || path,
			qty: pieces,
			unit_price: get_unit_price(path),
			line_total: get_line_total(path, pieces),
		});
	}
	rows.sort((a, b) => a.label.localeCompare(b.label));
	const total = rows.reduce((sum, row) => sum + row.line_total, 0);
	return { rows, total };
}

function validate_order(order, buyer, shop_data) {
	if (!shop.has_stock(shop_data)) {
		return { ok: false, error: "no_shop" };
	}
	if (shop_data.trade_mode !== "catalog") {
		return { ok: false, error: "no_shop" };
	}

	const normalized = normalize_order(order);
	const entries = Object.entries(normalized.items).filter(([, qty]) => qty > 0);
	if (entries.length === 0) {
		return { ok: false, error: "empty_order" };
	}

	let total = 0;
	for (const [path, pieces] of entries) {
		if (!shop.is_for_sale(shop_data, path)) {
			return { ok: false, error: "unavailable" };
		}
		const unit_qty = get_item_unit_qty(path);
		if (pieces % unit_qty !== 0) {
			return { ok: false, error: "unavailable" };
		}
		const boxes = pieces_to_boxes(path, pieces);
		const supply_boxes = shop.get_supply(shop_data, path);
		if (supply_boxes === 0 || (supply_boxes !== -1 && boxes > supply_boxes)) {
			return { ok: false, error: "unavailable" };
		}
		if (!shop.get_catalog_item(path)) {
			return { ok: false, error: "no_item" };
		}
		total += get_line_total(path, pieces);
	}

	const cash = buyer?.system?.char?.cash ?? 0;
	if (total > cash) {
		return { ok: false, error: "insufficient_cash" };
	}

	return { ok: true, total, order: normalized };
}

const catalog = {
	build_catalog_sections,
	empty_order,
	normalize_order,
	get_order_qty,
	can_add_order_item,
	add_order_item,
	remove_order_item,
	clear_order,
	build_order_summary,
	validate_order,
	calc_order_total,
};

export { catalog };
