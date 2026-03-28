import ReconnectingWebSocket from "@/lib/ws/WebSocketClient";
import { Hono } from "hono";
import { serveStatic, websocket } from "hono/bun";
import { logger } from "hono/logger";

import { randomUUIDv7 } from "bun";
import HandelLiveMatchesLoop from "./lib/hockey-nl/handelLiveMatches";
import api from "./routes/api";
import web from "./routes/web";

const app = new Hono();

// Mount like Laravel’s RouteServiceProvider
app.use("*", logger());
app.route("/", web);
app.use("/static/*", serveStatic({ root: "./" }));
app.use(
	"/public/*",
	serveStatic({
		root: "./",
		onNotFound: (path, c) => {
			console.log(`${path} is not found, you access ${c.req.path}`);
		},
	}),
);
app.route("/api", api);

// bun webserver
export const server = Bun.serve({
	hostname: process.env.HOST || "localhost",
	port: Number(process.env.PORT || 3000),
	development: process.env.NODE_ENV !== "production",
	fetch: app.fetch,
	websocket: websocket,
});
const ws = new ReconnectingWebSocket("ws://localhost:" + server.port + "/ws");

if (process.env.HOCKEY_NL === "true") {
	const devicdeId = randomUUIDv7();
	fetch("https://app.hockeyweerelt.nl/device/register", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			uuid: devicdeId,
			os: "Web",
		}),
	}).then((res) => {
		if (!res.ok) {
			console.error("Failed to register device:", res.statusText);
		} else {
			console.log("Device registered successfully with ID:", devicdeId);
		}

		res.json().then((data) => {
			if (data.token) {
				console.log("Received API token:", data.token);

				new HandelLiveMatchesLoop(ws, data.token, devicdeId);
			} else {
				console.error("No token received in response:", data);
			}
		});
	});
}

console.log(`Server running at http://${server.hostname}:${server.port}`);
