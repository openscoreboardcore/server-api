import type { Team } from "@/types/match.types";
import { removeBackground } from "@imgly/background-removal-node";
import path from "path";

const thuis = path.join(process.cwd(), "src/assets/thuis.svg");
const uit = path.join(process.cwd(), "src/assets/uit.svg");

export default async function getTeamLogo(
	team: Team
): Promise<{ buffer: Buffer; contentType: string }> {
	const type = team.name.toLocaleLowerCase().includes("flevoland")
		? "home"
		: "away";

	if (type === "home") {
		return {
			buffer: Buffer.from(thuis),
			contentType: "image/svg+xml",
		};
	}
	if (!team.logo) {
		return {
			buffer: Buffer.from(uit),
			contentType: "image/svg+xml",
		};
	}

	const blob = await removeBackground(team.logo || "");
	const arrayBuffer = await blob.arrayBuffer();
	return {
		buffer: Buffer.from(arrayBuffer),
		contentType: "image/png",
	};
}
