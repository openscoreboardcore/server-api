import type WebSocketClient from "../ws/WebSocketClient";
import { getMatchDetails, getMatchesByFacility } from "./api";

interface CurrentMatches {
	id: string;
	teams: [string, string];
	score: [number, number];
	time: string;
	field: string;
	live: boolean;
}

export default function handelLiveMatchesLoop(socket: WebSocketClient) {
	handelLiveMatches(socket);
	setInterval(async () => {
		handelLiveMatches(socket);
	}, 10000);
}

async function handelLiveMatches(socket: WebSocketClient) {
	const currentMatches = await fetchCurrentMatches();
	const fields = Array.from(
		new Set(currentMatches.map((match) => match.field))
	);
	if (fields.length === 0) {
		setScreenDisplay(socket, "off");
		return;
	}
	fields.forEach((field) => {
		const matchesOnField = currentMatches.filter(
			(match) => match.field === field
		);
		handelLiveMatchesWebsocketData(socket, matchesOnField);
	});
}

async function fetchCurrentMatches(): Promise<CurrentMatches[]> {
	const matches = [] as CurrentMatches[];
	await getMatchesByFacility(process.env.FACILITY_ID as string).then((data) => {
		data.data.forEach((match) => {
			const now = new Date();
			const matchDate = new Date(match.datetime);

			const lowerBound = new Date(matchDate.getTime() - 15 * 60 * 1000); // 15 minutes ago
			const upperBound = new Date(matchDate.getTime() + 2 * 60 * 60 * 1000); // 2 hours ahead
			const inProgress = match.status === "InProgress";

			if ((now > lowerBound && now < upperBound) || inProgress) {
				matches.push({
					id: match.id,
					teams: [match.home_team.name, match.away_team.name],
					score: [match.home_score, match.away_score],
					time: match.datetime,
					field: match.field,
					live: match.status === "InProgress",
				});
			}
		});
	});

	return matches;
}

async function handelLiveMatchesWebsocketData(
	socket: WebSocketClient,
	matches: CurrentMatches[]
) {
	const selectedMatch =
		matches.find((match) => match.live) ||
		matches.sort((a, b) => a.time.localeCompare(b.time))[0];
	const match = await getMatchDetails(selectedMatch.id);
	setScreenDisplay(socket, "match");
	setCurrentMatch(
		socket,
		selectedMatch.field.replace(" ", "").toLowerCase(),
		selectedMatch.id
	);
	socket.send(
		JSON.stringify({
			type: "publish",
			topic: "match-" + match.data.id,
			message: {
				homeTeam: {
					name: match.data.home_team.name,
					score: match.data.home_score,
					logo: match.data.home_team.logo,
				},
				awayTeam: {
					name: match.data.away_team.name,
					score: match.data.away_score,
					logo: match.data.away_team.logo,
				},

				status: "in_progress",
				time: "",
				part: "",
			},
		})
	);
}

function setScreenDisplay(
	socket: WebSocketClient,
	status: "off" | "logo" | "match" | "sponsor" | "schema"
) {
	console.log("Setting screen display to", status);
	socket.send(
		JSON.stringify({
			type: "publish",
			topic: "screen-1",
			message: {
				status: status,
			},
		})
	);
}

function setCurrentMatch(
	socket: WebSocketClient,
	fieldId: string,
	matchId: string
) {
	socket.send(
		JSON.stringify({
			type: "publish",
			topic: "field-" + fieldId,
			message: {
				matchId: matchId,
			},
		})
	);
}
