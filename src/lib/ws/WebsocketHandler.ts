import topicRouter from "@/routes/websocket";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { server } from "../../server";
import { getRetainedTopic } from "./RetainedTopics";

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
							ws.send(
								JSON.stringify({
									type: "response",
									topic: data.topic,
									message: "Subscribed successfully",
								}),
							);
							const retained = getRetainedTopic(data.topic);

							if (retained !== undefined) {
								ws.send(
									JSON.stringify({
										type: "response",
										topic: data.topic,
										message: retained,
									}),
								);
							} else if (typeof data.topic === "string" && /^field-veld\d+$/.test(data.topic)) {
								// No match has been discovered for this field yet.
								// Respond immediately rather than leaving the client waiting.
								const now = new Date();
								const idleStatus = now.getDay() >= 1 && now.getDay() <= 5 && now.getHours() >= 16 && now.getHours() < 22 ? "logo" : "off";
								ws.send(JSON.stringify({
									type: "response",
									topic: data.topic,
									message: { fieldId: data.topic.slice(6), matchId: null, status: idleStatus },
								}));
							}
							break;
						case "unsubscribe":
							if (data.topic === "all") {
								rawWs.close();
								console.log(
									`Client unsubscribed from all and connection closed`,
								);
								break;
							}
							if (data.topic === "match-*") {
								const matchTopics = rawWs.subscriptions.filter((topic) =>
									topic.startsWith("match-"),
								);

								for (const topic of matchTopics) {
									rawWs.unsubscribe(topic);
								}

								console.log(
									`Client unsubscribed from ${matchTopics.length} match topics`,
								);

								break;
							}

							rawWs.unsubscribe(data.topic);
							console.log(`Client unsubscribed from ${data.topic}`);
							break;
						case "publish":
							server.publish(
								data.topic,
								JSON.stringify({
									type: "response",
									topic: data.topic,
									message: data.message,
								}),
							);
							// retainTopic(data.topic, data.message); // this is placed in handelLiveMatches
							topicRouter.dispatch(
								c,
								data.topic,
								data.action ? data.action : "info",
								data.message,
							);
							break;
						// case "response":
						// 	console.log("Received response:", data);
						// 	break;
						case "ping":
							ws.send(
								JSON.stringify({
									type: "pong",
									timestamp: new Date().toISOString(),
								}),
							);
							break;
						default:
							ws.send("Unknown message type");
							break;
					}
				} catch (err) {
					console.error("Failed to parse message:", err);
					ws.send("Failed to parse message plz use JSON format");
				}
			},
		};
	}),
);

// { "type": "subscribe", "topic": "news" }

// { "type": "publish", "topic": "news", "message": "test" }

export default WebsocketHandler;
