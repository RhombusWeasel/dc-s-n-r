/**
 * Shop migration — converts old shop data format to the new stock-based format.
 * Extracted from Deadlands-Classic system.
 */

import { shop } from "./shop.js";

async function migrate_shop_whitelist() {
	game.dc.system.migrations = game.dc.system.migrations || {};
	if (game.dc.system.migrations.shop_whitelist) {
		return;
	}
	for (const actor of game.actors) {
		if (actor.type !== 'npc') {
			continue;
		}
		const current = actor.system.shop; // read-only
		if (!current) {
			continue;
		}
		const needs_migration = current.excluded
			|| current.supply
			|| (current.stock && Object.values(current.stock).some(entry => entry && ("sold" in entry || "label" in entry)));
		if (!needs_migration) {
			continue;
		}
		const migrated = shop.migrate_old_shop(current);
		await game.dc.utils.save_actor(actor, {
			'system.shop.haggle_tn': migrated.haggle_tn,
			'system.shop.stock': migrated.stock,
			'system.shop.customers': migrated.customers,
			'system.shop.-=excluded': null,
			'system.shop.-=supply': null
		});
	}
	game.dc.system.migrations.shop_whitelist = true;
}

export { migrate_shop_whitelist };