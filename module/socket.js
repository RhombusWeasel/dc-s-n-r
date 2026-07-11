/**
 * Socket handler for smith-and-robards module.
 * Routes incoming socket packets on the `module.smith-and-robards` channel
 * to the shop handler.
 */

import { shop } from "./lib/shop.js";

const SOCKET_CHANNEL = "module.smith-and-robards";

function register_socket() {
	if (!game.socket) return;
	game.socket.on(SOCKET_CHANNEL, (data) => {
		shop.handle_socket(data);
	});
}

export { register_socket, SOCKET_CHANNEL };