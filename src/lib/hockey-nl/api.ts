import type { MatchListResponse, MatchResponse } from "@/types/match.types";
import type { TeamResponse } from "@/types/team.types";

export async function getMatchesByFacility(
	facilityId: string
): Promise<MatchListResponse> {
	// const today = new Date();
	// const todayFormatted = today.toISOString().split("T")[0];
	// const tomorrow = new Date(today);
	// tomorrow.setDate(tomorrow.getDate() + 1);
	// const tomorrowFormatted = tomorrow.toISOString().split("T")[0];

	// const response = await fetch(
	// 	`https://publicaties.hockeyweerelt.nl/mc/facilities/${facilityId}/matches/upcoming?show_all=0&start_date=${todayFormatted}&end_date=${tomorrowFormatted}`
	// );
	// if (!response.ok) {
	// 	throw new Error(
	// 		`Error fetching matches for facility ${facilityId}: ${response.statusText}`
	// 	);
	// }
	// return response.json();

	return (await import(
		"../../../info/testMatchList.json"
	)) as MatchListResponse;
}

export async function getMatchDetails(matchId: string): Promise<MatchResponse> {
	// const response = await fetch(
	// 	`https://publicaties.hockeyweerelt.nl/mc/matches/${matchId}`
	// );
	// if (!response.ok) {
	// 	throw new Error(
	// 		`Error fetching match details for match ${matchId}: ${response.statusText}`
	// 	);
	// }
	// return response.json();

	return (await import("../../../info/testMatch.json")) as MatchResponse;
}

export async function getTeamById(teamId: string): Promise<TeamResponse> {
	const response = await fetch(
		`https://publicaties.hockeyweerelt.nl/mc/teams/${teamId}`
	);
	if (!response.ok) {
		throw new Error(
			`Error fetching team details for team ${teamId}: ${response.statusText}`
		);
	}
	return response.json();
}
