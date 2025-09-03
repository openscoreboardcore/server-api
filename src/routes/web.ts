import WebsocketHandler from "@/lib/ws/WebsocketHandler";
import { Hono } from "hono";

const web = new Hono();

web.get("/", (c) => c.text("Welcome to Hono + Bun API"));

web.route("/ws", WebsocketHandler);

export default web;
