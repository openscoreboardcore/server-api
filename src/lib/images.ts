import { removeBackground } from "@imgly/background-removal-node";
import fs from "fs/promises";
import path from "path";

const thuis = path.join(process.cwd(), "src/assets/thuis.svg");
const uit = path.join(process.cwd(), "src/assets/uit.svg");

export default async function getTeamLogo(
	type: string,
	url?: string,
): Promise<{ buffer: Buffer; contentType: string }> {
	if (type === "home") {
		return {
			buffer: await fs.readFile(thuis),
			contentType: "image/svg+xml",
		};
	}
	if (!url) {
		return {
			buffer: await fs.readFile(uit),
			contentType: "image/svg+xml",
		};
	}

	const blob = await removeBackground(url || "");
	const arrayBuffer = await blob.arrayBuffer();
	return {
		buffer: Buffer.from(arrayBuffer),
		contentType: "image/png",
	};
}
