import type { Team } from "@/types/match.types";
import { removeBackground } from "@imgly/background-removal-node";
import fs from "fs/promises";
import path from "path";

const thuis = path.join(process.cwd(), "src/assets/thuis.svg");
const uit = path.join(process.cwd(), "src/assets/uit.svg");

export default async function getTeamLogo(
	team: Team
): Promise<{ buffer: Buffer; contentType: string }> {
	let type = team.name.toLocaleLowerCase().includes("flevoland")
		? "home"
		: "away";

	if (type === "home") {
		return {
			buffer: await fs.readFile(thuis),
			contentType: "image/svg+xml",
		};
	}
	if (!team.logo) {
		return {
			buffer: await fs.readFile(uit),
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
