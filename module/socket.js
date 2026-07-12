/**
 * Socket handler for dc-s-n-r module.
 * Routes incoming socket packets on the `module.dc-s-n-r` channel
 * to the shop handler.
 */

import { shop } from "./lib/shop.js";

const SOCKET_CHANNEL = "module.dc-s-n-r";

function register_socket() {
	if (!game.socket) return;
	game.socket.on(SOCKET_CHANNEL, (data) => {
		shop.handle_socket(data);
	});
}

export { register_socket, SOCKET_CHANNEL };
