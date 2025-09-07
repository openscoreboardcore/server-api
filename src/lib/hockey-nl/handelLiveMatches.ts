import type { MatchResponse } from "@/types/match.types";
import type WebSocketClient from "../ws/WebSocketClient";
import { getMatchDetails, getMatchesByFacility } from "./api";

const PART_DURATION = 17 * 60 + 30; // 17:30 in seconds

interface CurrentMatches {
	id: string;
	teams: [string, string];
	score: [number, number];
	time: string;
	field: string;
	live: boolean;
}

interface MatchTimeState {
	currentPart: number;
	lastActionTime: number;
	running: boolean;
	elapsed: number;
	lastActionIndex: number; // new: index of last processed action
}

export default class HandelLiveMatchesLoop {
	matchTimers: Record<string, MatchTimeState> = {};
	selectedMatches: Record<string, MatchResponse> = {}; // fieldId -> matchId
	fields: string[] = [];

	constructor(socket: WebSocketClient) {
		this.handelLiveMatches(socket);
		setInterval(async () => {
			this.handelLiveMatches(socket);
		}, 5000);

		setInterval(async () => {
			this.fields.forEach((field) => {
				this.handelWebsocketData(socket, field.replace(" ", "").toLowerCase());
			});
		}, 1000);
	}

	async handelLiveMatches(socket: WebSocketClient) {
		const currentMatches = await this.fetchCurrentMatches();
		this.fields = Array.from(
			new Set(currentMatches.map((match) => match.field))
		);
		if (this.fields.length === 0) {
			this.setScreenDisplay(socket, "off");
			return;
		}
		this.fields.forEach((field) => {
			const matchesOnField = currentMatches.filter(
				(match) => match.field === field
			);
			this.handelLiveMatchesData(socket, matchesOnField);
		});
	}

	async fetchCurrentMatches(): Promise<CurrentMatches[]> {
		const matches = [] as CurrentMatches[];
		await getMatchesByFacility(process.env.FACILITY_ID as string).then(
			(data) => {
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
			}
		);

		return matches;
	}

	async handelLiveMatchesData(
		socket: WebSocketClient,
		matches: CurrentMatches[]
	) {
		const selectedMatch =
			matches.find((match) => match.live) ||
			matches.sort((a, b) => a.time.localeCompare(b.time))[0];
		const match = await getMatchDetails(selectedMatch.id);
		this.selectedMatches[selectedMatch.field.replace(" ", "").toLowerCase()] =
			match;
		this.setScreenDisplay(socket, "match");
		this.setCurrentMatch(
			socket,
			selectedMatch.field.replace(" ", "").toLowerCase(),
			selectedMatch.id
		);
	}

	async handelWebsocketData(socket: WebSocketClient, field: string) {
		const match = this.selectedMatches[field];

		// Initialize timer state if not exists
		if (!this.matchTimers[match.data.id]) {
			this.matchTimers[match.data.id] = {
				currentPart: 1,
				lastActionTime: Date.now(),
				running: false,
				elapsed: 0,
				lastActionIndex: -1, // track last processed action
			};
		}

		const timer = this.matchTimers[match.data.id];

		// Sort actions by time
		match.data.actions.sort(
			(a, b) => new Date(a.actionAt).getTime() - new Date(b.actionAt).getTime()
		);

		// Process only new actions
		for (
			let i = (timer.lastActionIndex ?? -1) + 1;
			i < match.data.actions.length;
			i++
		) {
			const action = match.data.actions[i];
			const actionTime = new Date(action.actionAt).getTime();

			switch (action.type) {
				case "start":
					if (!timer.running) {
						timer.running = true;
						timer.lastActionTime = actionTime;
						timer.elapsed = 0;
						timer.currentPart = 1;
					}
					break;

				case "start-period":
					// Start new part
					timer.currentPart += 1;
					timer.running = true;
					timer.lastActionTime = actionTime;
					timer.elapsed = 0; // reset elapsed for new part
					break;

				case "resume":
					if (!timer.running) {
						timer.running = true;
						timer.lastActionTime = actionTime;
					}
					break;

				case "pause":
				case "end-period":
				case "end":
					if (timer.running) {
						timer.elapsed += (actionTime - timer.lastActionTime) / 1000;
						timer.running = false;
					}
					break;
			}

			// Mark this action as processed
			timer.lastActionIndex = i;
		}

		// Update elapsed if running
		if (timer.running) {
			timer.elapsed += (Date.now() - timer.lastActionTime) / 1000;
			timer.lastActionTime = Date.now();
		}

		// Calculate remaining time for countdown
		let remaining = Math.max(PART_DURATION - timer.elapsed, 0);
		if (remaining === 0 && timer.running) {
			timer.running = false; // stop automatically if countdown finished
		}

		const minutes = Math.floor(remaining / 60);
		const seconds = Math.floor(remaining % 60);
		const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;

		// Determine current part
		const part = `Kwart ${timer.currentPart}`;

		// Send update via websocket
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
					status: match.data.status,
					time: timeString,
					part: part,
				},
			})
		);
	}

	setScreenDisplay(
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

	setCurrentMatch(socket: WebSocketClient, fieldId: string, matchId: string) {
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
}
