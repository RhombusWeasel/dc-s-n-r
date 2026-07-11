/**
 * shop_stock — custom field type for the boon editor.
 *
 * Renders the full gear catalog as a collapsible tree with a for_sale
 * checkbox and supply number input per item. The stock data is stored
 * as a nested object: { "category.item": { supply: N } }
 *
 * Registered with the system via game.dc.register_field_type().
 *
 * Handler interface:
 *   render(field, current_value, sub_id) → string  (HTML <td> pair)
 *   extract(field, element, boon_data)    → object  (stock data)
 *   on_render(field, container, boon_data, re_render) → void
 *   view(field, current_value)            → string  (read-only summary)
 */

// ─── Render ──────────────────────────────────────────────────────────────

function render(field, current_value, sub_id) {
	const stock = current_value || {};
	const sections = _build_catalog_tree(stock);

	let html = `<td class="left width-50"><label class="dl-label">${field.label || "Shop Stock"}</label></td>`;
	html += `<td class="left width-50">`;
	html += `<div class="${sub_id}${field.key} shop-stock-editor" data-field-value="${field.value}">`;
	html += `<div class="shop-stock-summary">${_count_for_sale(stock)} items for sale</div>`;
	html += `<div class="shop-stock-tree scroll" style="max-height:400px; overflow-y:auto;">`;
	html += sections;
	html += `</div>`;
	html += `</div>`;
	html += `</td>`;
	return html;
}

function _build_catalog_tree(stock) {
	const categories = {
		ammo: "dc.gear.ammo",
		armour: "dc.gear.armour",
		melee: "dc.gear.melee",
		ranged: "dc.gear.ranged",
		thrown: "dc.gear.thrown",
		explosives: "dc.gear.explosives",
		misc: "dc.gear.misc",
		goods: "dc.gear.goods",
		services: "dc.gear.services",
	};

	let html = "";
	for (const [cat_key, cat_label] of Object.entries(categories)) {
		const items = [];
		for (const entry of game.dc.gear_catalog.iterate_catalog()) {
			if (entry.category !== cat_key) continue;
			items.push(entry);
		}
		if (items.length === 0) continue;

		const localized_cat = game.i18n.localize(cat_label);
		html += `<h4 class="center dc-header">${localized_cat}</h4>`;
		html += `<table class="shop-gm-table">`;
		html += `<tr>`;
		html += `<th class="center width-5" title="${game.i18n.localize("dc.shop.for_sale")}"><i class="fas fa-check"></i></th>`;
		html += `<th class="center">${game.i18n.localize("dc.shop.supply")}</th>`;
		html += `<th>${game.i18n.localize("dc.shared.name")}</th>`;
		html += `<th>${game.i18n.localize("dc.shared.cost")}</th>`;
		html += `</tr>`;

		for (const entry of items) {
			const supply = _get_supply(stock, entry.path);
			const for_sale = supply !== 0;
			const label = entry.item?.label || entry.key;
			const cost = entry.item?.cost ?? 0;

			html += `<tr>`;
			html += `<td class="center shop-stock-toggle">`;
			if (for_sale) {
				html += `<a class="toggle-path fas fa-check" data-path="${entry.path}" title="${game.i18n.localize("dc.shop.for_sale")} ${label}"></a>`;
			} else {
				html += `<a class="toggle-path fas fa-times" data-path="${entry.path}" title="${game.i18n.localize("dc.shop.not_for_sale")} ${label}"></a>`;
			}
			html += `</td>`;
			html += `<td class="center">`;
			html += `<input type="number" class="shop-supply-input" data-path="${entry.path}" value="${supply}" min="-1" ${for_sale ? "" : "disabled"} />`;
			html += `</td>`;
			html += `<td class="left">${label}</td>`;
			html += `<td class="right">${_format_currency(cost)}</td>`;
			html += `</tr>`;
		}
		html += `</table>`;
	}
	return html;
}

function _get_supply(stock, path) {
	const entry = game.dc.utils.data_from_path(stock, path);
	if (!entry) return 0;
	return entry.supply ?? -1;
}

function _count_for_sale(stock) {
	let count = 0;
	_walk_stock(stock, (path, entry) => {
		if ((entry.supply ?? -1) !== 0) count++;
	});
	return count;
}

function _walk_stock(stock, fn, prefix = "") {
	if (!stock || typeof stock !== "object") return;
	for (const [key, value] of Object.entries(stock)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && "supply" in value) {
			fn(path, value);
		} else if (value && typeof value === "object") {
			_walk_stock(value, fn, path);
		}
	}
}

function _format_currency(value) {
	const dollars = Math.floor(value / 100);
	const cents = Math.floor(value % 100);
	return cents < 10 ? `$${dollars}.0${cents}` : `$${dollars}.${cents}`;
}

// ─── Extract ──────────────────────────────────────────────────────────────

function extract(field, element, boon_data) {
	const stock = {};

	if (!element) {
		console.warn("shop_stock.extract: element is null");
		return stock;
	}

	// Read all toggle links — any item with fa-check is for sale
	const toggles = element.querySelectorAll(".toggle-path");
	for (const toggle of toggles) {
		const path = toggle.dataset.path;
		if (!path) continue;
		const is_for_sale = toggle.classList.contains("fa-check");
		if (is_for_sale) {
			const row = toggle.closest("tr");
			const input = row?.querySelector(".shop-supply-input");
			let supply = input ? parseInt(input.value, 10) : -1;
			if (isNaN(supply)) supply = -1;
			// Supply 0 means "not for sale" — default to -1 (unlimited) if 0
			if (supply === 0) supply = -1;
			game.dc.utils.modify_path(stock, path, { supply });
		}
	}

	return stock;
}

// ─── on_render — wire up toggle + supply events ────────────────────────────

function on_render(field, container, boon_data, re_render) {
	const field_value = container.dataset.fieldValue;

	// Toggle for_sale on click
	container.querySelectorAll(".toggle-path").forEach((toggle) => {
		toggle.addEventListener("click", (event) => {
			event.preventDefault();
			const path = toggle.dataset.path;
			if (!path) return;

			// Toggle the visual state
			const is_for_sale = toggle.classList.contains("fa-check");
			if (is_for_sale) {
				toggle.classList.remove("fa-check");
				toggle.classList.add("fa-times");
				toggle.title = game.i18n.localize("dc.shop.not_for_sale");
			} else {
				toggle.classList.remove("fa-times");
				toggle.classList.add("fa-check");
				toggle.title = game.i18n.localize("dc.shop.for_sale");
			}

			// Enable/disable the supply input
			const row = toggle.closest("tr");
			const input = row?.querySelector(".shop-supply-input");
			if (input) {
				input.disabled = is_for_sale; // was for_sale → now disabled
				if (!is_for_sale && input.value === "0") {
					input.value = "-1"; // default to unlimited when enabling
				}
			}

			// Update summary
			_update_summary(container);
		});
	});

	// Update summary on supply change
	container.querySelectorAll(".shop-supply-input").forEach((input) => {
		input.addEventListener("input", () => {
			_update_summary(container);
		});
	});
}

function _update_summary(container) {
	let count = 0;
	container.querySelectorAll(".toggle-path.fa-check").forEach((toggle) => {
		count++;
	});
	const summary = container.querySelector(".shop-stock-summary");
	if (summary) {
		summary.textContent = `${count} items for sale`;
	}
}

// ─── View — read-only summary ──────────────────────────────────────────────

function view(field, current_value) {
	const stock = current_value || {};
	const count = _count_for_sale(stock);
	return `${count} item${count === 1 ? "" : "s"} for sale`;
}

// ─── Registration ──────────────────────────────────────────────────────────

function register() {
	game.dc.register_field_type("shop_stock", {
		render,
		extract,
		on_render,
		view,
	});
}

export { register };