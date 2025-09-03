import topicRouter from "@/routes/websocket";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { server } from "../../server";

const WebsocketHandler = new Hono();

WebsocketHandler.get(
	"/",
	upgradeWebSocket((c) => {
		return {
			onOpen: (_, ws) => {
				const rawWs = ws.raw as ServerWebSocket;
				console.log("New WebSocket connection: " + rawWs.remoteAddress);
				ws.send("Success");
			},

			onClose: (_, ws) => {
				const rawWs = ws.raw as ServerWebSocket;
				console.log("WebSocket closed: " + rawWs.remoteAddress);
			},
			onMessage: (event, ws) => {
				const rawWs = ws.raw as ServerWebSocket;
				const msg = event.data.toString();

				try {
					const data = JSON.parse(msg);

					switch (data.type) {
						case "subscribe":
							rawWs.subscribe(data.topic);
							console.log(`Client subscribed to ${data.topic}`);
							break;
						case "unsubscribe":
							rawWs.unsubscribe(data.topic);
							console.log(`Client unsubscribed from ${data.topic}`);
							break;
						case "publish":
							server.publish(data.topic, data.message);
							topicRouter.dispatch(
								data.topic,
								data.action ? data.action : "info",
								data.message
							);
							break;
					}
				} catch (err) {
					console.error("Failed to parse message:", err);
					ws.send("Failed to parse message plz use JSON format");
				}
			},
		};
	})
);

// { "type": "subscribe", "topic": "news" }

// { "type": "publish", "topic": "news", "message": "test" }

export default WebsocketHandler;
