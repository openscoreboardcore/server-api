import ReconnectingWebSocket from "@/lib/ws/WebSocketClient";
import { Hono } from "hono";
import { serveStatic, websocket } from "hono/bun";
import { logger } from "hono/logger";

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
	})
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

// new HandelLiveMatchesLoop(ws);

console.log(`Server running at http://${server.hostname}:${server.port}`);
