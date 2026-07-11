/**
 * open_shop boon — fires when a player token enters a region with this boon.
 * Detects the NPC in the region and opens the shop sheet.
 */

import { shop } from "../lib/shop.js";
import { npc_interaction } from "../lib/npc_interaction.js";

function handle_open_shop_boon(context) {
	const { region, target, actor } = context;

	// Only fire for the entering player's own client
	if (!target) return;

	// If we already have an actor from auto-detection, use it directly
	if (actor && actor.type === "npc") {
		shop.open_player_sheet(actor);
		return;
	}

	// Otherwise, detect NPCs in the region
	const tokens = game.dc.region.get_tokens_in_region(region);
	for (const token of tokens) {
		const token_actor = token.actor;
		if (!token_actor || token_actor.type !== "npc") continue;
		// Only open for the player who entered
		if (!game.user.isGM && !game.user.character) continue;
		shop.open_player_sheet(token_actor);
		return;
	}
}

// ─── Registration ─────────────────────────────────────────────────────────

function register_boons() {
	game.dc.boon_manager.register_boon_type("open_shop", {
		label: "Open Shop",
		on_token_enter: handle_open_shop_boon,
	});

	game.dc.register_boon_template("open_shop", {
		label: "Open Shop",
		description: "Opens a shop sheet when a player token enters the region.",
		fields: [],
	});
}

export { register_boons };