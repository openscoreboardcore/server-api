import { getTeamById } from "@/lib/hockey-nl/api";
import getTeamLogo from "@/lib/images";
import { Context } from "hono";

export class TeamImageController {
	static async show(c: Context) {
		const id = c.req.param("id");

		const team = await getTeamById(id);
		if (!team) {
			return c.json({ message: "Team not found" }, 404);
		}

		const teamLogoObject = await getTeamLogo(team.data);

		const body = new Uint8Array(teamLogoObject.buffer);

		// return c.newResponse();
		return new Response(body, {
			status: 200,
			headers: {
				"Content-Type": teamLogoObject.contentType,
				"Cache-Control": "public, max-age=3600", // optional
			},
		});
	}
}
