import { Context } from "hono";

export class UserController {
	static async index(c: Context) {
		return c.json({ message: "List of users" });
	}

	static async show(c: Context) {
		const id = c.req.param("id");
		return c.json({ message: `User details for ${id}` });
	}

	static async store(c: Context) {
		const body = await c.req.json();
		return c.json({ message: "User created", data: body }, 201);
	}
}
