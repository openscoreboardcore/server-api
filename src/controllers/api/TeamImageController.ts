import { getTeamById } from "@/lib/hockey-nl/api";
import getTeamLogo from "@/lib/images";
import { Context } from "hono";

export class TeamImageController {
	static async show(c: Context) {
		const side = c.req.param("id");
		const url = c.req.param("url");

		const teamLogoObject = await getTeamLogo(side, url);

		const body = new Uint8Array(teamLogoObject.buffer);

		// return c.newResponse();
		return new Response(body, {
			status: 200,
			headers: {
				"Content-Type": teamLogoObject.contentType,
				"Cache-Control": "public", // optional , max-age=3600
			},
		});
	}
}
