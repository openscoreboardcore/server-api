import { randomUUIDv7 } from "bun";

const TOKEN_FILE = "./storage/hockey-token.json";

interface HockeyAuth {
	deviceId: string;
	token: string;
}

async function loadAuth(): Promise<HockeyAuth | null> {
	try {
		const file = Bun.file(TOKEN_FILE);

		if (!(await file.exists())) {
			return null;
		}

		const auth = (await file.json()) as HockeyAuth;

		if (!auth.deviceId || !auth.token) {
			return null;
		}

		return auth;
	} catch (error) {
		console.error("Failed to load HockeyWeerelt auth:", error);
		return null;
	}
}

async function saveAuth(auth: HockeyAuth): Promise<void> {
	await Bun.write(TOKEN_FILE, JSON.stringify(auth, null, 2));
}

export async function resetAuthAndRestart(): Promise<void> {
	const file = Bun.file(TOKEN_FILE);
	if (await file.exists()) {
		file.delete();
	}
	process.exit(1);
}

async function registerDevice(): Promise<HockeyAuth> {
	const deviceId = randomUUIDv7();

	const res = await fetch("https://app.hockeyweerelt.nl/device/register", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			uuid: deviceId,
			os: "Web",
		}),
	});

	const data = (await res.json()) as {
		token?: string;
		message?: string;
	};

	if (data.message === "Too Many Attempts.") {
		console.error(
			"HockeyWeerelt: Too Many Attempts. Process is paused until manually restarted.",
		);

		// Intentionally never resolves.
		await new Promise(() => {});
	}

	if (!res.ok) {
		throw new Error(
			`Registration failed: ${res.status} ${data.message ?? res.statusText}`,
		);
	}

	if (!data.token) {
		throw new Error(`No token received: ${data.message ?? "Unknown error"}`);
	}

	const auth = {
		deviceId,
		token: data.token,
	};

	await saveAuth(auth);

	return auth;
}

export default async function getHockeyAuth(): Promise<HockeyAuth> {
	const savedAuth = await loadAuth();

	if (savedAuth) {
		console.log("Using saved HockeyWeerelt token");
		return savedAuth;
	}

	console.log("No saved token found, registering device...");

	return registerDevice();
}
