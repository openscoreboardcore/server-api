import { Hono } from "hono";
import { websocket } from "hono/bun";
import api from "./routes/api";
import web from "./routes/web";

const app = new Hono();

// Mount like Laravel’s RouteServiceProvider
app.route("/", web);
app.route("/api", api);

// bun webserver
export const server = Bun.serve({
	hostname: process.env.HOST || "localhost",
	port: Number(process.env.PORT || 3000),
	development: process.env.NODE_ENV !== "production",
	fetch: app.fetch,
	websocket: websocket,
});

console.log(`Server running at http://${server.hostname}:${server.port}`);
