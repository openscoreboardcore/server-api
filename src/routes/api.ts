import { Hono } from "hono";
import { UserController } from "../controllers/api/UserController";

const api = new Hono();

api.get("/users", UserController.index);
api.get("/users/:id", UserController.show);
api.post("/users", UserController.store);

export default api;
