/**
 * open_shop boon — fires when a player token enters a region with this boon.
 * Detects the NPC in the region and opens the shop sheet.
 *
 * Boon handler signature: (boon, context) => void
 * context: { region, target, actor }
 */

import { shop } from "../lib/shop.js";

export default function open_shop_boon(boon, context) {
	const { region, target, actor } = context;

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
		shop.open_player_sheet(token_actor);
		return;
	}
}

// ─── Registration ─────────────────────────────────────────────────────────

function register_boons() {
	game.dc.boon_manager.register_boon_type("open_shop", open_shop_boon);

	game.dc.register_boon_template("open_shop", {
		label: "Open Shop",
		description: "Opens a shop sheet when a player token enters the region.",
		fields: [],
	});
}

export { register_boons };