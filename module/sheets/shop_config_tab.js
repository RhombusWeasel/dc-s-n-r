/**
 * GM Shop Config Tab — injects a Shop tab into NPC sheets for GMs.
 * Uses renderActorSheet hook (same pattern as dc-poker).
 */

import { shop } from "../lib/shop.js";

const TAB_ID = "shop";
const TAB_LABEL = "dc.shop.tab.label";
const PARTIAL_TEMPLATE = "modules/smith-and-robards/templates/partials/shop_config.hbs";

let _hook_registered = false;

function register_tab_injection() {
	if (_hook_registered) return;
	_hook_registered = true;

	Hooks.on("renderActorSheet", async (sheet, html, context) => {
		const actor = sheet.actor;
		if (!actor || actor.type !== "npc") return;
		if (!game.user.isGM) return;

		// Ensure shop data exists on the actor
		if (!actor.system.shop) {
			await game.dc.utils.save_actor(actor, {
				"system.shop": shop.default_shop()
			});
		}

		// Find the sheet's tab navigation
		const nav = html.querySelector(".sheet-tabs");
		if (!nav) return;

		// Check if our tab is already there
		if (nav.querySelector(`[data-tab="${TAB_ID}"]`)) return;

		// Add tab button
		const tab_btn = document.createElement("a");
		tab_btn.classList.add("item");
		tab_btn.dataset.tab = TAB_ID;
		tab_btn.textContent = game.i18n.localize(TAB_LABEL);
		nav.appendChild(tab_btn);

		// Build shop context
		const shop_data = shop.normalize_shop(actor.system.shop || shop.default_shop());
		const shop_catalog = shop.build_catalog_context(shop_data);
		const shop_customers = shop.build_customers_context(shop_data.customers || {});

		// Render the partial
		const partial_html = await renderTemplate(PARTIAL_TEMPLATE, {
			shop: shop_data,
			shop_catalog,
			shop_customers
		});

		// Find the tab content container (the last .tab section)
		const content_container = html.querySelector(".sheet-body") || html.querySelector(".sheet-content");
		if (!content_container) return;

		// Create our tab content div
		const tab_div = document.createElement("div");
		tab_div.classList.add("tab");
		tab_div.dataset.tab = TAB_ID;
		tab_div.innerHTML = partial_html;
		content_container.appendChild(tab_div);

		// Wire up event handlers on the tab content
		_wire_tab_events(tab_div, actor);
	});
}

function _wire_tab_events(container, actor) {
	// Toggle shop enabled
	container.addEventListener("click", async (event) => {
		const target = event.target.closest("[data-action]");
		if (!target) return;
		const action = target.dataset.action;

		switch (action) {
			case "shopToggleEnable": {
				const current = shop.normalize_shop(actor.system.shop || shop.default_shop());
				await game.dc.utils.save_actor(actor, {
					"system.shop.enabled": !current.enabled
				});
				break;
			}
			case "toggleShopStock": {
				const path = target.dataset.path;
				if (!path) return;
				const current = shop.normalize_shop(actor.system.shop || shop.default_shop());
				const new_stock = shop.toggle_stock(current, path);
				await game.dc.utils.save_actor(actor, {
					"system.shop.stock": new_stock
				});
				break;
			}
		}
	});

	// Handle change events (inputs)
	container.addEventListener("change", async (event) => {
		const target = event.target;
		const action_el = target.closest("[data-action]");
		if (!action_el) return;
		const action = action_el.dataset.action;

		switch (action) {
			case "modifyShopField": {
				const field = action_el.dataset.field;
				const value = parseFloat(target.value);
				if (!field || isNaN(value)) return;
				const update = {};
				update[`system.shop.${field}`] = value;
				await game.dc.utils.save_actor(actor, update);
				break;
			}
			case "modifyShopCustomer": {
				const actor_id = action_el.dataset.actorId;
				const field = action_el.dataset.field;
				const value = parseInt(target.value, 10);
				if (!actor_id || !field || isNaN(value)) return;
				const shop_data = shop.normalize_shop(actor.system.shop || shop.default_shop());
				const customer = shop.get_or_create_customer(shop_data, actor_id);
				customer[field] = value;
				await game.dc.utils.save_actor(actor, {
					[`system.shop.customers.${actor_id}`]: foundry.utils.deepClone(customer)
				});
				break;
			}
		}
	});

	// Handle supply input changes (no data-action, uses data-field="supply")
	container.addEventListener("input", async (event) => {
		const target = event.target;
		if (!target.classList.contains("shop-supply-input")) return;
		if (target.dataset.field !== "supply") return;
		const path = target.dataset.path;
		if (!path) return;
		const value = parseInt(target.value, 10);
		if (isNaN(value)) return;
		const current = shop.normalize_shop(actor.system.shop || shop.default_shop());
		const new_stock = shop.set_supply(current, path, value);
		await game.dc.utils.save_actor(actor, {
			"system.shop.stock": new_stock
		});
	});
}

export { register_tab_injection };