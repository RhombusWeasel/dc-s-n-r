const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { shop, set_open_sheet, get_open_sheet } from "../lib/shop.js";
import { barter } from "../lib/barter.js";
import { get_cached_boon_entry, resolve_shop_boon } from "../lib/shop_boon_cache.js";

const ScrollPreservationMixin = game.dc.scroll_preservation.ScrollPreservationMixin;

class NpcShopSheet extends ScrollPreservationMixin(HandlebarsApplicationMixin(ApplicationV2)) {

	static DEFAULT_OPTIONS = {
		id: "npc-shop-{id}",
		classes: ["deadlands-classic", "npc-shop-sheet", "sheet", "themed", "theme-light"],
		tag: "form",
		position: { width: 960, height: 640 },
		window: {
			resizable: true,
		},
		form: {
			handler: async () => {},
			submitOnChange: false,
			closeOnSubmit: false,
		},
	};

	static PARTS = {
		main: {
			template: "modules/dc-s-n-r/templates/shop.hbs",
			root: true,
			scrollable: [".scroll"],
		},
	};

	/**
	 * Show the shop sheet.
	 * @param {object} shop_data — boon shop config { shopkeeper_name, haggle_tn, sell_ratio, cash, stock }
	 * @param {string} shop_id — region behavior UUID (unique identifier for this shop)
	 * @param {string} scene_id — scene ID for customer data lookups
	 * @param {object} options — { buyer_id }
	 */
	static show(shop_data, shop_id, scene_id, options = {}) {
		const sheet = new NpcShopSheet(shop_data, shop_id, scene_id, options);
		set_open_sheet(sheet);
		sheet.render(true);

		// For non-GM players, request fresh shop data from the GM
		if (!game.user.isGM) {
			const buyer_id = options.buyer_id
				|| game.user.character?.id
				|| shop.get_owned_characters()[0]?.id
				|| "";
			const cached = get_cached_boon_entry(shop_id);
			shop.emit_request_shop_data(shop_id, buyer_id, scene_id, cached?.boon);
		}

		return sheet;
	}

	constructor(shop_data, shop_id, scene_id, options = {}) {
		const shopkeeper_name = shop_data?.shopkeeper_name || "Shop";
		super({ window: { title: shopkeeper_name } });
		this.shop_id = shop_id;
		this.scene_id = scene_id;
		this.shopkeeper_name = shopkeeper_name;
		this._boon_shop_data = shop_data;
		this.buyer_id = options.buyer_id
			|| game.user.character?.id
			|| shop.get_owned_characters()[0]?.id
			|| "";
		this.trade = barter.empty_trade();
	}

	get shop_data() {
		if (game.user.isGM) {
			return this._current_shop_data || shop.normalize_shop(this._boon_shop_data || {});
		}
		// Player: prefer socket cache (has customer-driven updates), fall back to boon data
		const cached = shop.get_cached_shop_data(this.shop_id);
		if (cached?.shop) return cached.shop;
		return shop.normalize_shop(this._boon_shop_data || {});
	}

	get buyer() {
		return game.actors.get(this.buyer_id);
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		// GM: read shop data from cached boon or region behavior
		if (game.user.isGM) {
			const resolved = await resolve_shop_boon(this.shop_id);
			if (resolved?.boon) {
				const boon = resolved.boon;
				this._current_shop_data = shop.normalize_shop({
					haggle_tn: boon.haggle_tn,
					sell_ratio: boon.sell_ratio,
					enable_cash: boon.enable_cash,
					cash: boon.cash,
					stock: boon.stock,
				});
			}
		}

		// Player: use boon data as primary source; socket cache for customer updates
		// (boon data was passed to constructor when the sheet was opened)

		const buyer = this.buyer;
		const scene = game.scenes.get(this.scene_id);

		let customer;
		if (game.user.isGM) {
			customer = buyer
				? await shop.get_customer(scene, this.shop_id, buyer.id)
				: { opinion: 0, price_modifier_pct: 0 };
		} else {
			customer = shop.get_cached_shop_data(this.shop_id)?.customer || { opinion: 0, price_modifier_pct: 0 };
		}

		const shop_data = this.shop_data;
		const balance = barter.calc_balance(this.trade, buyer, shop_data, customer);

		context.shop_name = this.shopkeeper_name;
		context.shop_id = this.shop_id;
		context.buyer_id = this.buyer_id;
		context.buyers = shop.get_owned_characters().map(a => ({
			id: a.id,
			name: a.name,
			selected: a.id === this.buyer_id
		}));
		context.player_cash = buyer?.system.char.cash ?? 0;
		context.merchant_cash = shop_data.cash ?? -1;
		context.enable_cash = shop_data.enable_cash ?? true;
		context.price_modifier_pct = customer.price_modifier_pct ?? 0;
		context.opinion = customer.opinion ?? 0;
		context.haggle_tn = shop_data.haggle_tn ?? 5;
		context.player_items = barter.build_player_inventory(buyer, customer, shop_data);
		context.merchant_items = barter.build_merchant_inventory(shop_data, customer);
		context.trade_player = balance.player;
		context.trade_merchant = balance.merchant;
		context.balanced = balance.balanced;
		context.balance_diff = Math.abs(balance.diff);
		context.can_accept = balance.balanced && !balance.errors.includes("empty_trade");
		context.has_buyer = !!buyer;
		this._current_customer = customer;
		this._current_shop_data = shop_data;
		return context;
	}

	close(options = {}) {
		if (get_open_sheet() === this) {
			set_open_sheet(null);
		}
		return super.close(options);
	}

	_onClickAction(event, target) {
		const action = target.dataset.action;
		const handlers = {
			addTradeItem: this._on_add_trade_item,
			removeTradeItem: this._on_remove_trade_item,
			acceptTrade: this._on_accept_trade,
			clearTrade: this._on_clear_trade,
			autoBalance: this._on_auto_balance,
			haggle: this._on_haggle,
			close: this._on_close,
		};
		const handler = handlers[action];
		if (handler) handler.call(this, event, target);
	}

	_onChangeEvent(event) {
		const target = event.target;
		if (target.classList.contains("shop-buyer-select")) {
			this.buyer_id = target.value;
			this.trade = barter.empty_trade();
			this.render(true);
			return;
		}
	}

	_onRender(context, options) {
		super._onRender(context, options);
		if (this._bound_on_change) {
			this.element.removeEventListener("change", this._bound_on_change);
		}
		this._bound_on_change = this._onChangeEvent.bind(this);
		this.element.addEventListener("change", this._bound_on_change);
		const font_size = game.settings.get("Deadlands-Classic", "font_size");
		this.element.classList.remove("typed-small", "typed-medium", "typed-large");
		this.element.classList.add(`typed-${font_size}`);
	}

	_on_add_trade_item(event, target) {
		event.preventDefault();
		const side = target.dataset.side;
		const path = target.dataset.path;
		if (!side || !path || !this.buyer) {
			return;
		}
		if (!barter.can_add_trade_item(this.trade, side, path, this.buyer, this.shop_data)) {
			return;
		}
		this.trade = barter.add_trade_item(this.trade, side, path);
		this.render(true);
	}

	_on_remove_trade_item(event, target) {
		event.preventDefault();
		const side = target.dataset.side;
		const path = target.dataset.path;
		if (!side || !path) {
			return;
		}
		this.trade = barter.remove_trade_item(this.trade, side, path);
		this.render(true);
	}

	_on_accept_trade(event, target) {
		event.preventDefault();
		const buyer = this.buyer;
		if (!buyer) {
			return;
		}
		const customer = this._current_customer || { opinion: 0, price_modifier_pct: 0 };
		const shop_data = this._current_shop_data || this.shop_data;
		const balance = barter.calc_balance(this.trade, buyer, shop_data, customer);
		if (!balance.balanced || balance.errors.includes("empty_trade")) {
			ui.notifications.warn(game.i18n.localize("dc.shop.errors.unbalanced"));
			return;
		}
		void shop.request_trade({
			shop_id: this.shop_id,
			scene_id: this.scene_id,
			buyer_id: buyer.id,
			trade: foundry.utils.deepClone(this.trade),
			user_id: game.user.id
		});
	}

	_on_clear_trade() {
		this.trade = barter.empty_trade();
		this.render(true);
	}

	_on_auto_balance(event, target) {
		event.preventDefault();
		const buyer = this.buyer;
		if (!buyer) return;
		const customer = this._current_customer || { opinion: 0, price_modifier_pct: 0 };
		const shop_data = this._current_shop_data || this.shop_data;
		this.trade = barter.auto_balance_cash(this.trade, buyer, shop_data, customer);
		this.render(true);
	}

	async _on_haggle(event, target) {
		const buyer = this.buyer;
		if (!buyer) {
			ui.notifications.warn(game.i18n.localize("dc.shop.errors.no_buyer"));
			return;
		}
		const formula = shop.build_streetwise_formula(buyer);
		if (!formula) {
			ui.notifications.warn(game.i18n.localize("dc.shop.errors.no_streetwise"));
			return;
		}
		const tn = this.shop_data.haggle_tn ?? 5;
		const haggle_label = `${game.i18n.localize("dc.skills.streetwise")} (${game.i18n.localize("dc.shop.haggle")})`;
		const r_data = await game.dc.roll_utils.build_roll_data(buyer, {
			formula,
			type: 'haggle',
			action_label: haggle_label,
			tn,
		});
		if (!r_data) {
			ui.notifications.warn(game.i18n.localize("dc.shop.errors.no_streetwise"));
			return;
		}
		const haggle_html = game.dc.roll_report.build_roll_report({
			type: 'haggle',
			actor_name: buyer.name,
			action_label: haggle_label,
			r_data,
		});
		game.dc.msg.chat(haggle_html, ChatMessage.getSpeaker({ actor: buyer }));
		shop.emit("haggle", {
			shop_id: this.shop_id,
			scene_id: this.scene_id,
			buyer_id: buyer.id,
			success: r_data.success,
			raises: r_data.raises,
			user_id: game.user.id
		});
	}

	_on_close() {
		this.close();
	}
}

export { NpcShopSheet };