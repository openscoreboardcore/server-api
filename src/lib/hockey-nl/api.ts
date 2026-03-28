import type { MatchResponse, Team } from "@/types/match.types";
import type { FacilityResponse } from "@/types/team.types";

// export async function getMatchesByFacility(
// 	facilityId: string,
// 	token: string,
// ): Promise<MatchListResponse> {
// 	const today = new Date();
// 	const todayFormatted = today.toISOString().split("T")[0];
// 	const tomorrow = new Date(today);
// 	tomorrow.setDate(tomorrow.getDate() + 1);
// 	const tomorrowFormatted = tomorrow.toISOString().split("T")[0];
// 	try {
// 		const response = await fetch(
// 			`https://app.hockeyweerelt.nl/facilities/${facilityId}/matches/upcoming?filter[dateStart]=${todayFormatted}&filter[dateEnd]=${tomorrowFormatted}`,
// 			{
// 				headers: {
// 					"x-hapi-authorization": token,
// 				},
// 			},
// 		);
// 		if (!response.ok) {
// 			throw new Error(
// 				`Error fetching matches for facility ${facilityId}: ${response.statusText}`,
// 			);
// 		}
// 		return response.json();
// 	} catch (error) {
// 		console.error("Failed to fetch matches:", error);
// 	}
// 	return {} as MatchListResponse;

// 	// return (await import(
// 	// 	"../../../info/testMatchList.json"
// 	// )) as MatchListResponse;
// }

// export async function getMatchDetails(
// 	matchId: string,
// 	token: string,
// ): Promise<MatchResponse> {
// 	try {
// 		const response = await fetch(
// 			`https://app.hockeyweerelt.nl/matches/${matchId}?t=${Date.now()}`,
// 			{
// 				cache: "no-store",
// 				headers: {
// 					"Cache-Control": "no-cache",
// 					"x-hapi-authorization": token,
// 				},
// 			},
// 		);
// 		if (!response.ok) {
// 			throw new Error(
// 				`Error fetching match details for match ${matchId}: ${response.statusText}`,
// 			);
// 		}
// 		return response.json();
// 	} catch (error) {
// 		console.error("Failed to fetch match details:", error);
// 	}
// 	return {} as MatchResponse;

// 	// return (await import("../../../info/testMatch.json")) as MatchResponse;
// }

export async function getTeamById(
	teamId: string,
	token: string,
): Promise<Team> {
	try {
		const response = await fetch(
			`https://app.hockeyweerelt.nl/teams/${teamId}`,
			{
				headers: {
					"x-hapi-authorization": token,
				},
			},
		);
		if (!response.ok) {
			throw new Error(
				`Error fetching team details for team ${teamId}: ${response.statusText}`,
			);
		}
		return response.json();
	} catch (error) {
		console.error("Failed to fetch team details:", error);
	}
	return {} as Team;
}

// new api helpers:

import crypto from "crypto";

type HockeyAuth = {
	token: string;
	uuid: string;
};

const BASE_URL = "https://app.hockeyweerelt.nl";

// --- helpers ---
function clean(str: string) {
	return str.replace(/[^a-zA-Z0-9\-/=]+/g, "");
}

function generateSignature(
	path: string,
	params: Record<string, any>,
	timestamp: number,
	uuid: string,
): string {
	const cleanPath = path.replace(/[^a-zA-Z0-9\-/]+/g, "");

	let queryString = "";
	for (const key of Object.keys(params)) {
		if (!key) continue;

		const cleanKey = clean(key);
		const cleanValue = clean(String(params[key]));

		queryString += `${cleanKey}=${cleanValue}`;
	}

	const reversedUuid = uuid.split("").reverse().join("");

	const payload = `${timestamp}${cleanPath}${queryString}${reversedUuid}`;

	return crypto.createHash("sha1").update(payload).digest("hex");
}

// --- main function ---
export async function hockeyFetch<T = any>(
	path: string,
	params: Record<string, any>,
	auth: HockeyAuth,
	options: RequestInit = {},
): Promise<T> {
	const timestamp = Math.floor(Date.now() / 1000);

	const signature = generateSignature(path, params, timestamp, auth.uuid);

	const url = new URL(BASE_URL + path);

	// attach query params
	Object.entries(params || {}).forEach(([key, value]) => {
		if (Array.isArray(value)) {
			value.forEach((v) => url.searchParams.append(key, String(v)));
		} else {
			url.searchParams.append(key, String(value));
		}
	});

	const res = await fetch(url.toString(), {
		...options,
		headers: {
			Accept: "application/json",
			"X-HAPI-Authorization": auth.token,
			"X-HAPI-Signature": signature,
			"X-HAPI-Timestamp": timestamp.toString(),
			"X-HAPI-Version": "7",
			...(options.headers || {}),
		},
	});

	if (!res.ok) {
		console.error(res.url);
		// throw new Error(`HTTP ${res.status}`);
		return {} as T;
	}

	return res.json();
}

// new api:

export async function getMatchesByFacility(
	facilityId: string,
	auth: HockeyAuth,
): Promise<FacilityResponse> {
	const today = new Date();

	const todayFormatted = today.toISOString().split("T")[0];

	const tomorrow = new Date(today);
	tomorrow.setDate(tomorrow.getDate() + 1);
	const tomorrowFormatted = tomorrow.toISOString().split("T")[0];

	try {
		return await hockeyFetch<FacilityResponse>(
			`/facilities/${facilityId}/matches`,
			{
				"filter[dateStart]": todayFormatted,
				"filter[dateEnd]": tomorrowFormatted,
			},
			auth,
		);
	} catch (error) {
		console.error("Failed to fetch matches:", error);
		return {} as FacilityResponse;
	}
}

export async function getMatchDetails(
	matchId: string,
	auth: HockeyAuth,
): Promise<MatchResponse> {
	try {
		return await hockeyFetch<MatchResponse>(
			`/matches/${matchId}`,
			{
				// t: Date.now(), // 👈 cache buster (included in signature automatically)
			},
			auth,
			{
				cache: "no-store",
				headers: {
					"Cache-Control": "no-cache",
				},
			},
		);
	} catch (error) {
		console.error("Failed to fetch match details:", error);
		return {} as MatchResponse;
	}
}
