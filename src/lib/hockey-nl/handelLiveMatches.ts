import type { MatchAction, MatchResponse } from "@/types/match.types";
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
	lastTimerActionTime: number;
	running: boolean;
	elapsed: number;
	lastActionIndex: number; // new: index of last processed action
	timeCorrection: number;
	seconds_since_start: number;
}

export default class HandelLiveMatchesLoop {
	matchTimers: Record<string, MatchTimeState> = {};
	selectedMatches: Record<string, MatchResponse> = {}; // fieldId -> matchId
	fields: string[] = [];
	apiToken = "";
	uuid = "";

	constructor(socket: WebSocketClient, token: string, uuid: string) {
		this.apiToken = token;
		this.uuid = uuid;
		this.handelLiveMatches(socket);
		setInterval(async () => {
			this.handelLiveMatches(socket);
		}, 10000);

		setInterval(async () => {
			this.fields.forEach((field) => {
				this.handelWebsocketData(socket, field.replace(" ", "").toLowerCase());
			});
		}, 1000);
	}

	async handelLiveMatches(socket: WebSocketClient) {
		const currentMatches = await this.fetchCurrentMatches();
		this.fields = Array.from(
			new Set(currentMatches.map((match) => match.field)),
		);
		if (this.fields.length === 0) {
			this.setScreenDisplay(socket, "off");
			return;
		}
		this.fields.forEach((field) => {
			const matchesOnField = currentMatches.filter(
				(match) => match.field === field,
			);
			this.handelLiveMatchesData(socket, matchesOnField);
		});
	}

	async fetchCurrentMatches(): Promise<CurrentMatches[]> {
		const matches: CurrentMatches[] = [];

		const data = await getMatchesByFacility(process.env.FACILITY_ID as string, {
			token: this.apiToken,
			uuid: this.uuid,
		});

		for (const match of data.data.matches) {
			const now = new Date();
			const matchDate = new Date(match.date);

			const lowerBound = new Date(matchDate.getTime() - 15 * 60 * 1000);
			const upperBound = new Date(
				matchDate.getTime() + 1 * 60 * 60 * 1000 + 40 * 60 * 1000,
			);

			const inProgress =
				match.status === "in_progress" || match.status === "InProgress";

			if ((now > lowerBound && now < upperBound) || inProgress) {
				const matchDetails = await getMatchDetails(match.id.toString(), {
					token: this.apiToken,
					uuid: this.uuid,
				});

				if (matchDetails.data) {
					matches.push({
						id: match.id.toString(),
						teams: [match.home.name, match.away.name],
						score: [match.score.home, match.score.away],
						time: match.date,
						field: matchDetails.data.location.field.name,
						live: inProgress,
					});
				}
			}
		}

		return matches;
	}

	async handelLiveMatchesData(
		socket: WebSocketClient,
		matches: CurrentMatches[],
	) {
		const selectedMatch =
			matches.find((match) => match.live) ||
			matches.sort((a, b) => a.time.localeCompare(b.time))[0];
		const match = await getMatchDetails(selectedMatch.id, {
			token: this.apiToken,
			uuid: this.uuid,
		});
		this.selectedMatches[selectedMatch.field.replace(" ", "").toLowerCase()] =
			match;
		this.setScreenDisplay(socket, "match");
		this.setCurrentMatch(
			socket,
			selectedMatch.field.replace(" ", "").toLowerCase(),
			selectedMatch.id,
		);
	}

	async handelWebsocketData(socket: WebSocketClient, field: string) {
		const match = this.selectedMatches[field];

		// Initialize timer state if not exists
		if (!this.matchTimers || !this.matchTimers[match.data.id]) {
			this.matchTimers[match.data.id] = {
				currentPart: 1,
				lastActionTime: Date.now(),
				lastTimerActionTime: Date.now(),
				running: false,
				elapsed: 0,
				lastActionIndex: -1, // track last processed action
				timeCorrection: 0,
				seconds_since_start: 0,
			};
		}

		const timer = this.matchTimers[match.data.id];

		// Sort actions by time
		match.data.actions.sort(
			(a, b) =>
				new Date(a.action_at).getTime() - new Date(b.action_at).getTime(),
		);

		// Process only new actions
		for (
			let i = (timer.lastActionIndex ?? -1) + 1;
			i < match.data.actions.length;
			i++
		) {
			const action = match.data.actions[i];
			const actionTime = new Date(action.action_at).getTime();

			switch (action.action_type) {
				case "start":
					if (!timer.running) {
						timer.running = true;
						timer.lastActionTime = actionTime;
						timer.lastTimerActionTime = actionTime;
						timer.elapsed = action.seconds_since_start;
						timer.currentPart = 1;
					}
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Match started",
						new Date(actionTime).toTimeString().split(" ")[0],
					);
					break;

				case "start-period":
					// Start new part
					// if (!timer.running) {
					timer.currentPart += 1;
					timer.running = true;
					timer.lastActionTime = actionTime;
					timer.lastTimerActionTime = actionTime;
					timer.timeCorrection = 0;
					timer.elapsed = 0;
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Period ",
						timer.currentPart,
						" started",
						new Date(actionTime).toTimeString().split(" ")[0],
					);
					// }
					break;

				case "resume":
					// if (!timer.running) {
					// 	timer.running = true;
					// 	timer.lastActionTime = actionTime;
					// 	timer.timeCorrection +=
					// 		timer.seconds_since_start - action.seconds_since_start;
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Match resumed",
						new Date(actionTime).toTimeString().split(" ")[0],
					);
					// }
					break;

				case "pause":
					// if (timer.running) {
					// 	timer.elapsed += (actionTime - timer.lastActionTime) / 1000;
					// 	timer.running = false;
					// 	timer.seconds_since_start = action.seconds_since_start;

					console.info(
						new Date().toTimeString().split(" ")[0],
						": Match paused",
						new Date(actionTime).toTimeString().split(" ")[0],
					);
					// }
					break;

				case "end-period":
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Period ",
						timer.currentPart,
						" ended",
						new Date(actionTime).toTimeString().split(" ")[0],
					);
					break;

				case "end":
					if (timer.running) {
						timer.elapsed += (actionTime - timer.lastActionTime) / 1000;
						timer.running = false;
					}
					break;
				case "goal":
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Goal scored by ",
						action.side || "Unknown",
						new Date(actionTime).toTimeString().split(" ")[0],
					);
					break;
				case "card-green":
				case "card-yellow":
				case "card-red":
					this.handelCardAction(action);
					break;
			}

			// Mark this action as processed
			timer.seconds_since_start = action.seconds_since_start;
			timer.lastActionIndex = i;
		}

		// Update elapsed if running
		if (timer.running) {
			timer.elapsed += (Date.now() - timer.lastTimerActionTime) / 1000;
			timer.lastTimerActionTime = Date.now();
		}

		// Calculate remaining time for countdown
		let remaining = Math.max(PART_DURATION - timer.elapsed, 0);
		if (remaining === 0 && timer.running) {
			timer.running = false; // stop automatically if countdown finished
		}

		const minutes = Math.floor(remaining / 60);
		const seconds = Math.floor(remaining % 60);
		const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;
		console.log("Remaining time:", timeString);

		// Determine current part
		const part = `Kwart ${timer.currentPart}`;

		// Send update via websocket
		socket.send(
			JSON.stringify({
				type: "publish",
				topic: "match-" + match.data.id,
				message: {
					homeTeam: {
						name: match.data.home.name,
						score: match.data.score.home,
						logo:
							process.env.BETTER_AUTH_URL +
							"/api/team/" +
							match.data.home.id +
							"/logo",
					},
					awayTeam: {
						name: match.data.away.name,
						score: match.data.score.away,
						logo:
							process.env.BETTER_AUTH_URL +
							"/api/team/" +
							match.data.away.id +
							"/logo",
					},
					status: match.data.status,
					time: timeString,
					part: part,
				},
			}),
		);
	}

	setScreenDisplay(
		socket: WebSocketClient,
		status: "off" | "logo" | "match" | "sponsor" | "schema",
	) {
		// console.log("Setting screen display to", status);
		socket.send(
			JSON.stringify({
				type: "publish",
				topic: "screen-1",
				message: {
					status: status,
				},
			}),
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
			}),
		);
	}

	handelCardAction(action: MatchAction) {
		console.info(
			new Date().toTimeString().split(" ")[0],
			": Card issued to ",
			action.person_name || "Unknown",
			" (",
			action.action_type || "Unknown",
			")",
			"Duration:",
			action.duration_in_seconds || "N/A",
			new Date(action.action_at).toTimeString().split(" ")[0],
		);
	}
}
