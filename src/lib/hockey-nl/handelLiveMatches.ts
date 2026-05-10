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

	// authoritative elapsed match time from API
	elapsed: number;

	// local timestamp when we synced elapsed
	syncedAt: number;

	// timer currently running?
	running: boolean;

	// last processed action
	lastActionId: number;
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

			const lowerBound = new Date(matchDate.getTime() - 20 * 60 * 1000);
			const upperBound = new Date(
				matchDate.getTime() + 1 * 60 * 60 * 1000 + 40 * 60 * 1000,
			);

			const inProgress = match.status === "live";

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

		if (!match) {
			console.error("Match not found for field:", field);
			return;
		}

		// init timer
		if (!this.matchTimers[match.data.id]) {
			this.matchTimers[match.data.id] = {
				currentPart: 1,
				elapsed: 0,
				syncedAt: Date.now(),
				running: false,
				lastActionId: 0,
			};
		}

		const timer = this.matchTimers[match.data.id];

		// sort oldest -> newest
		match.data.actions.sort(
			(a, b) =>
				new Date(a.action_at).getTime() - new Date(b.action_at).getTime(),
		);

		// process ONLY new actions
		for (const action of match.data.actions) {
			if (action.id <= timer.lastActionId) {
				continue;
			}

			const now = Date.now();
			const actionTime = new Date(action.action_at).getTime();

			// determine if match should be running AFTER this action
			switch (action.action_type) {
				case "start":
				case "resume":
				case "start-period":
					timer.running = true;
					break;

				case "pause":
				case "end":
				case "end-period":
					timer.running = false;
					break;
			}

			// base seconds from API
			let correctedElapsed = action.seconds_since_start ?? timer.elapsed;

			// IMPORTANT:
			// compensate for delayed API response
			// ONLY while running
			if (timer.running) {
				correctedElapsed += (now - actionTime) / 1000;
			}

			// sync timer
			timer.elapsed = correctedElapsed;
			timer.syncedAt = now;

			switch (action.action_type) {
				case "start":
					timer.currentPart = 1;

					console.info(
						new Date().toTimeString().split(" ")[0],
						": Match started",
					);
					break;

				case "start-period":
					// derive current part from total elapsed
					timer.currentPart =
						Math.floor((action.seconds_since_start ?? 0) / PART_DURATION) + 1;

					console.info(
						new Date().toTimeString().split(" ")[0],
						`: Period ${timer.currentPart} started`,
					);
					break;

				case "pause":
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Match paused",
					);
					break;

				case "resume":
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Match resumed",
					);
					break;

				case "end-period":
					console.info(
						new Date().toTimeString().split(" ")[0],
						`: Period ${timer.currentPart} ended`,
					);
					break;

				case "end":
					console.info(
						new Date().toTimeString().split(" ")[0],
						": Match ended",
					);
					break;

				case "goal":
					console.info(
						new Date().toTimeString().split(" ")[0],
						`: Goal scored by ${action.side}`,
					);
					break;

				case "card-green":
				case "card-yellow":
				case "card-red":
					this.handelCardAction(action);
					break;
			}

			timer.lastActionId = action.id;
		}

		// LOCAL ticking between API updates
		if (timer.running) {
			const now = Date.now();

			timer.elapsed += (now - timer.syncedAt) / 1000;

			timer.syncedAt = now;
		}
		// remaining countdown
		const remaining = Math.max(
			PART_DURATION * timer.currentPart - timer.elapsed,
			0,
		);

		const minutes = Math.floor(remaining / 60);
		const seconds = Math.floor(remaining % 60);

		const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;

		console.log(
			"MatchId:",
			match.data.id,
			"Part:",
			timer.currentPart,
			"Running:",
			timer.running,
			"Elapsed:",
			timer.elapsed.toFixed(1),
			"Remaining:",
			timeString,
		);

		const part = `Kwart ${timer.currentPart}`;

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
							"/api/team/home/logo?url=" +
							Buffer.from(match.data.home.logo, "utf-8").toString("base64"),
					},
					awayTeam: {
						name: match.data.away.name,
						score: match.data.score.away,
						logo:
							process.env.BETTER_AUTH_URL +
							"/api/team/away/logo?url=" +
							Buffer.from(match.data.away.logo, "utf-8").toString("base64"),
					},
					status: match.data.status,
					time: timeString,
					part,
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
