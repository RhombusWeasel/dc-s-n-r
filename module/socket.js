/**
 * Socket handler for smith-and-robards module.
 * Routes incoming socket packets on the `module.smith-and-robards` channel
 * to the appropriate handler (shop or npc_interaction).
 */

import { shop } from "./lib/shop.js";
import { npc_interaction } from "./lib/npc_interaction.js";

const SOCKET_CHANNEL = "module.smith-and-robards";

function register_socket() {
	if (!game.socket) return;
	game.socket.on(SOCKET_CHANNEL, (data) => {
		console.log("Smith & Robards | Socket message received:", data);

		// Determine the event type
		const event = data.event;

		switch (event) {
			case "shop":
				shop.handle_socket(data);
				break;
			case "npc_interaction":
				npc_interaction.handle_socket(data);
				break;
		}
	});
}

export { register_socket, SOCKET_CHANNEL };