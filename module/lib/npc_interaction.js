/**
 * NPC Interaction — GM-brokered token interaction.
 *
 * Allows players to interact with NPC tokens (shops) without
 * observer permission on the actor. The GM acts as a data broker:
 *
 *   Player clicks token → socket request to GM → GM sends type/data back
 *
 * Events (all under socket event 'npc_interaction'):
 *   request_npc_type  — Player → GM: { npc_id } — "Is this NPC a shop?"
 *   npc_type          — GM → Player: { npc_id, type } — 'shop' | null
 */

import { shop } from "./shop.js";

const SOCKET_CHANNEL = "module.smith-and-robards";

// ─── Player-side cache: npc_id → 'shop' | null ─────────────────────────────
const npc_type_cache = new Map();

// Pending requests: npc_id → resolve callback (for awaiting GM response)
const pending_requests = new Map();

/**
 * Get the cached NPC type for an actor ID.
 * @param {string} npc_id
 * @returns {string|null|undefined} — 'shop' | null (cached), or undefined if not cached
 */
function get_cached_type(npc_id) {
	return npc_type_cache.get(npc_id);
}

/**
 * Request the NPC type from the GM via socket. Returns a promise that resolves
 * with 'shop' | null. If the GM doesn't respond within 5 seconds,
 * resolves with null.
 * @param {string} npc_id
 * @returns {Promise<string|null>}
 */
function request_npc_type(npc_id) {
	console.log('Smith & Robards | request_npc_type for', npc_id, 'isGM:', game.user.isGM);
	// Return cached value immediately if available
	if (npc_type_cache.has(npc_id)) {
		console.log('Smith & Robards | request_npc_type: cached =', npc_type_cache.get(npc_id));
		return Promise.resolve(npc_type_cache.get(npc_id));
	}

	// GM always reads directly
	if (game.user.isGM) {
		const type = resolve_npc_type(npc_id);
		npc_type_cache.set(npc_id, type);
		return Promise.resolve(type);
	}

	// Already pending? Return the existing promise
	if (pending_requests.has(npc_id)) {
		return pending_requests.get(npc_id);
	}

	// Create a new promise + timeout
	const promise = new Promise((resolve) => {
		const timeout = setTimeout(() => {
			pending_requests.delete(npc_id);
			resolve(null);
		}, 5000);

		pending_requests.set(npc_id, (type) => {
			clearTimeout(timeout);
			pending_requests.delete(npc_id);
			npc_type_cache.set(npc_id, type);
			resolve(type);
		});
	});

	// Emit the request to GM
	emit_npc_interaction('gm', {
		type: 'request_npc_type',
		npc_id,
	});

	return promise;
}

/**
 * Resolve the type of an NPC actor (GM-side).
 * @param {string} npc_id
 * @returns {string|null} — 'shop' | null
 */
function resolve_npc_type(npc_id) {
	const actor = game.actors.get(npc_id);
	if (!actor || actor.type !== 'npc') {
		console.log('Smith & Robards | resolve_npc_type: actor not found or not NPC:', npc_id);
		return null;
	}

	// Check shop
	const shop_data = actor.system?.shop;
	if (shop_data) {
		const normalized = shop.normalize_shop(shop_data);
		console.log('Smith & Robards | resolve_npc_type: shop =', { enabled: normalized.enabled, has_stock: shop.has_stock(normalized) });
		if (normalized.enabled && shop.has_stock(normalized)) return 'shop';
	}

	console.log('Smith & Robards | resolve_npc_type: returning null');
	return null;
}

/**
 * Handle incoming npc_interaction socket events.
 * @param {object} data — socket packet
 */
function handle_socket(data) {
	const msg = data.msg;
	if (!msg || !msg.type) return;
	console.log('Smith & Robards | npc_interaction socket:', msg.type, msg);

	switch (msg.type) {
		case 'request_npc_type':
			handle_request_npc_type(data);
			break;
		case 'npc_type':
			handle_npc_type_response(msg);
			break;
	}
}

/**
 * GM-side: handle a request_npc_type from a player.
 * @param {object} data — full socket packet
 */
function handle_request_npc_type(data) {
	if (!game.user.isGM) return;

	const msg = data.msg;
	const npc_id = msg.npc_id;
	if (!npc_id) return;

	const type = resolve_npc_type(npc_id);
	console.log('Smith & Robards | GM resolving npc_type for', npc_id, '→', type);

	// Send the response back to the requesting player
	emit_npc_interaction(data.sender, {
		type: 'npc_type',
		npc_id,
		npc_type: type,
	});
}

/**
 * Player-side: handle a npc_type response from the GM.
 * @param {object} msg — { npc_id, npc_type }
 */
function handle_npc_type_response(msg) {
	if (game.user.isGM) return;
	console.log('Smith & Robards | Player received npc_type:', msg.npc_type, 'for', msg.npc_id);

	const npc_id = msg.npc_id;
	const type = msg.npc_type;

	// Cache the result
	npc_type_cache.set(npc_id, type);

	// Resolve the pending promise if any
	const resolve = pending_requests.get(npc_id);
	if (resolve) {
		resolve(type);
	}
}

/**
 * Invalidate the cached type for an NPC (e.g. when the GM toggles enabled).
 * @param {string} npc_id
 */
function invalidate_cache(npc_id) {
	npc_type_cache.delete(npc_id);
}

// ─── Internal: socket emit on module channel ──────────────────────────────

function emit_npc_interaction(target, data) {
	if (game.socket) {
		game.socket.emit(SOCKET_CHANNEL, {
			event: 'npc_interaction',
			msg: data,
			sender: game.user.id,
			target: target,
			character: game.user.character,
			timestamp: Date.now(),
		});
	}
}

const npc_interaction = {
	get_cached_type,
	request_npc_type,
	resolve_npc_type,
	handle_socket,
	invalidate_cache,
	_npc_type_cache: npc_type_cache,
};

export { npc_interaction, SOCKET_CHANNEL };