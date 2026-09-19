import type { MatchAction, MatchResponse } from "@/types/match.types";

import type WebSocketClient from "../ws/WebSocketClient";

import { getMatchDetails, getMatchesByFacility, type HockeyAuth } from "./api";

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const PART_DURATION_SECONDS = 17 * 60 + 30;

// Discover schedule / fields once per minute.
const DISCOVERY_INTERVAL_MS = 60_000;

// Refresh only live matches every 10 seconds.
const LIVE_REFRESH_INTERVAL_MS = 10_000;

// Local clock / websocket output remains smooth.
const DISPLAY_UPDATE_INTERVAL_MS = 1_000;

// During discovery, don't fetch the same match details again within this period.
const MATCH_DETAILS_CACHE_MS = 60_000;

// Match becomes relevant 20 minutes before scheduled start.
const MATCH_START_WINDOW_MS = 20 * 60 * 1000;

// Keep it relevant for 1h40 after scheduled start.
const MATCH_END_WINDOW_MS = 100 * 60 * 1000;

type DisplayStatus = "off" | "logo" | "match" | "sponsor" | "schema";

interface CurrentMatch {
	id: string;
	time: string;
	field: string;
	live: boolean;

	/**
	 * We already needed the details to determine the field.
	 *
	 * Keep them here so selectMatchForField() doesn't need to
	 * make another API request.
	 */
	details: MatchResponse;
}

interface MatchTimeState {
	currentPart: number;

	/**
	 * Total elapsed match time according to the API/local clock.
	 */
	elapsed: number;

	/**
	 * Local timestamp when elapsed was last synchronized.
	 */
	syncedAt: number;

	running: boolean;

	/**
	 * Last action already processed.
	 */
	lastActionId: number;
}

interface CachedMatch {
	response: MatchResponse;
	fetchedAt: number;
}

// -----------------------------------------------------------------------------
// HandelLiveMatchesLoop
// -----------------------------------------------------------------------------

export default class HandelLiveMatchesLoop {
	private readonly auth: HockeyAuth;

	/**
	 * matchId -> timer
	 */
	private readonly matchTimers: Record<string, MatchTimeState> = {};

	/**
	 * normalized fieldId -> selected match
	 *
	 * Example:
	 * veld1 -> MatchResponse
	 */
	private readonly selectedMatches: Record<string, MatchResponse | undefined> =
		{};

	/**
	 * matchId -> cached HockeyWeerelt response
	 */
	private readonly matchCache = new Map<string, CachedMatch>();

	/**
	 * Fields currently active on the scoreboard.
	 *
	 * These are only replaced after discovery has completed
	 * successfully.
	 */
	private fields: string[] = [];

	private displayStatus: DisplayStatus = "off";

	private stopped = false;

	private displayInterval: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly socket: WebSocketClient,
		token: string,
		uuid: string,
	) {
		this.auth = {
			token,
			uuid,
		};

		/*
		 * Three separate responsibilities:
		 *
		 * 1. Discovery       -> 60 sec
		 * 2. Live API sync   -> 10 sec
		 * 3. Local display   -> 1 sec
		 */

		void this.startDiscoveryLoop();
		void this.startLiveRefreshLoop();

		this.displayInterval = setInterval(
			() => this.handleDisplayTick(),
			DISPLAY_UPDATE_INTERVAL_MS,
		);
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	public stop(): void {
		this.stopped = true;

		if (this.displayInterval) {
			clearInterval(this.displayInterval);
			this.displayInterval = undefined;
		}
	}

	// -------------------------------------------------------------------------
	// Main loops
	// -------------------------------------------------------------------------

	private async startDiscoveryLoop(): Promise<void> {
		while (!this.stopped) {
			try {
				await this.refreshMatches();
			} catch (error) {
				console.error("[HockeyNL] Discovery failed:", error);
			}

			await sleep(DISCOVERY_INTERVAL_MS);
		}
	}

	private async startLiveRefreshLoop(): Promise<void> {
		/*
		 * Give initial discovery a moment to populate selectedMatches.
		 *
		 * This is not required for correctness, but avoids immediately
		 * running an empty live refresh during startup.
		 */
		await sleep(1_000);

		while (!this.stopped) {
			try {
				await this.refreshLiveMatches();
			} catch (error) {
				console.error("[HockeyNL] Live refresh failed:", error);
			}

			await sleep(LIVE_REFRESH_INTERVAL_MS);
		}
	}

	private handleDisplayTick(): void {
		this.setScreenDisplay(this.displayStatus);

		this.handleClock();

		for (const field of this.fields) {
			this.handleWebsocketData(normalizeFieldId(field));
		}
	}

	// -------------------------------------------------------------------------
	// Discovery
	// -------------------------------------------------------------------------

	private async refreshMatches(): Promise<void> {
		const currentMatches = await this.fetchCurrentMatches();

		/*
		 * API failure.
		 *
		 * Keep:
		 * - old fields
		 * - selected matches
		 * - timers
		 * - display state
		 *
		 * This keeps the scoreboard running when HockeyWeerelt
		 * temporarily fails or rate limits us.
		 */
		if (currentMatches === null) {
			return;
		}

		const newFields = [...new Set(currentMatches.map((match) => match.field))];

		if (newFields.length === 0) {
			this.fields = [];

			this.displayStatus = this.getIdleDisplayStatus();

			return;
		}

		/*
		 * IMPORTANT:
		 *
		 * First select matches.
		 * Only expose newFields afterwards.
		 *
		 * This prevents the 1-second display loop from seeing:
		 *
		 * fields = ["Veld 1"]
		 * selectedMatches["veld1"] = undefined
		 */
		for (const field of newFields) {
			const matchesOnField = currentMatches.filter(
				(match) => match.field === field,
			);

			this.selectMatchForField(field, matchesOnField);
		}

		this.fields = newFields;

		if (this.hasSelectedMatches()) {
			this.displayStatus = "match";
		}
	}

	private async fetchCurrentMatches(): Promise<CurrentMatch[] | null> {
		const facilityId = process.env.FACILITY_ID;

		if (!facilityId) {
			console.error("[HockeyNL] FACILITY_ID is not configured.");

			return null;
		}

		let response;

		try {
			response = await getMatchesByFacility(facilityId, this.auth);
		} catch (error) {
			console.error("[HockeyNL] Could not fetch facility matches:", error);

			return null;
		}

		if (!Array.isArray(response?.data?.matches)) {
			console.warn("[HockeyNL] Invalid facility response:", response);

			return null;
		}

		const now = Date.now();

		const currentMatches: CurrentMatch[] = [];

		for (const match of response.data.matches) {
			if (!this.isRelevantMatch(match.date, match.status, now)) {
				continue;
			}

			const matchId = match.id.toString();

			const details = await this.getMatchDetailsCached(
				matchId,
				MATCH_DETAILS_CACHE_MS,
			);

			if (!details?.data?.id) {
				continue;
			}

			const field = details.data.location?.field?.name;

			if (!field) {
				console.warn(`[HockeyNL] Match ${matchId} has no field.`);

				continue;
			}

			currentMatches.push({
				id: matchId,
				time: match.date,
				field,

				/*
				 * Prefer the detailed response status because it
				 * may be newer than the facility list.
				 */
				live: details.data.status === "live" || match.status === "live",

				details,
			});
		}

		return currentMatches;
	}

	private isRelevantMatch(date: string, status: string, now: number): boolean {
		if (status === "live") {
			return true;
		}

		const matchTime = new Date(date).getTime();

		if (!Number.isFinite(matchTime)) {
			return false;
		}

		const lowerBound = matchTime - MATCH_START_WINDOW_MS;

		const upperBound = matchTime + MATCH_END_WINDOW_MS;

		return now > lowerBound && now < upperBound;
	}

	// -------------------------------------------------------------------------
	// Match selection
	// -------------------------------------------------------------------------

	private selectMatchForField(field: string, matches: CurrentMatch[]): void {
		if (matches.length === 0) {
			return;
		}

		/*
		 * Live always wins.
		 *
		 * Otherwise use the earliest scheduled relevant match.
		 *
		 * Copy before sort so we don't mutate the original array.
		 */
		const selectedMatch =
			matches.find((match) => match.live) ??
			[...matches].sort(
				(a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
			)[0];

		if (!selectedMatch?.details?.data?.id) {
			return;
		}

		const fieldId = normalizeFieldId(field);

		/*
		 * No API call here.
		 *
		 * fetchCurrentMatches() already fetched the details.
		 */
		this.selectedMatches[fieldId] = selectedMatch.details;

		this.setCurrentMatch(fieldId, selectedMatch.id);
	}

	private hasSelectedMatches(): boolean {
		for (const field of this.fields) {
			const fieldId = normalizeFieldId(field);

			if (this.selectedMatches[fieldId]?.data?.id) {
				return true;
			}
		}

		/*
		 * During discovery this.fields isn't updated until after
		 * selection, so also check the record itself.
		 */
		return Object.values(this.selectedMatches).some((match) =>
			Boolean(match?.data?.id),
		);
	}

	// -------------------------------------------------------------------------
	// Live match refresh
	// -------------------------------------------------------------------------

	private async refreshLiveMatches(): Promise<void> {
		for (const field of this.fields) {
			if (this.stopped) {
				return;
			}

			const fieldId = normalizeFieldId(field);

			const current = this.selectedMatches[fieldId];

			if (!current?.data?.id) {
				continue;
			}

			/*
			 * Scheduled matches do NOT need a 10-second API refresh.
			 *
			 * They will be refreshed during the 60-second discovery.
			 */
			if (current.data.status !== "live") {
				continue;
			}

			const matchId = current.data.id.toString();

			try {
				const fresh = await getMatchDetails(matchId, this.auth);

				if (!fresh?.data?.id) {
					console.warn(
						`[HockeyNL] Invalid live response for match ${matchId}.`,
					);

					continue;
				}

				/*
				 * Replace selected match atomically.
				 *
				 * The 1-second display loop will now use the
				 * new score/actions/status.
				 */
				this.selectedMatches[fieldId] = fresh;

				this.matchCache.set(matchId, {
					response: fresh,
					fetchedAt: Date.now(),
				});

				/*
				 * A live match may have become final.
				 *
				 * Stop polling it every 10 seconds immediately.
				 * Discovery will decide what should be displayed next.
				 */
				if (fresh.data.status !== "live") {
					console.info(
						`[HockeyNL] Match ${matchId} is no longer live (${fresh.data.status}).`,
					);
				}
			} catch {
				/*
				 * Deliberately don't replace selectedMatches.
				 *
				 * This means:
				 *
				 * API down / 429
				 *       ↓
				 * cached score remains visible
				 *       ↓
				 * local timer keeps running
				 */
				console.warn(
					`[HockeyNL] Could not refresh live match ${matchId}. Using cached state.`,
				);
			}
		}
	}

	// -------------------------------------------------------------------------
	// API cache
	// -------------------------------------------------------------------------

	private async getMatchDetailsCached(
		matchId: string,
		maxAgeMs: number,
	): Promise<MatchResponse | null> {
		const now = Date.now();

		const cached = this.matchCache.get(matchId);

		if (cached && now - cached.fetchedAt < maxAgeMs) {
			return cached.response;
		}

		try {
			const response = await getMatchDetails(matchId, this.auth);

			if (!response?.data?.id) {
				console.warn(`[HockeyNL] Invalid details for match ${matchId}.`);

				return cached?.response ?? null;
			}

			this.matchCache.set(matchId, {
				response,
				fetchedAt: Date.now(),
			});

			return response;
		} catch {
			/*
			 * Don't print a full HockeyApiError stack every time
			 * the rate limiter is active.
			 *
			 * api.ts already knows why the request failed.
			 */
			if (cached) {
				console.warn(`[HockeyNL] Using cached match ${matchId}.`);

				return cached.response;
			}

			console.warn(`[HockeyNL] No data available for match ${matchId}.`);

			return null;
		}
	}

	// -------------------------------------------------------------------------
	// Match clock / actions
	// -------------------------------------------------------------------------

	private handleWebsocketData(field: string): void {
		const match = this.selectedMatches[field];

		if (!match?.data?.id) {
			return;
		}

		const matchData = match.data;

		const timer = this.getMatchTimer(matchData.id.toString());

		/*
		 * Don't mutate matchData.actions because MatchResponse is
		 * also stored in selectedMatches/matchCache.
		 */
		const actions = [...(matchData.actions ?? [])].sort(
			(a, b) =>
				new Date(a.action_at).getTime() - new Date(b.action_at).getTime(),
		);

		for (const action of actions) {
			if (action.id <= timer.lastActionId) {
				continue;
			}

			this.processMatchAction(timer, action);
		}

		this.updateRunningTimer(timer);

		const time = this.getRemainingTime(timer);

		console.log(
			"MatchId:",
			matchData.id,
			"Part:",
			timer.currentPart,
			"Running:",
			timer.running,
			"Elapsed:",
			timer.elapsed.toFixed(1),
			"Remaining:",
			time,
		);

		this.publish(`match-${matchData.id}`, {
			homeTeam: {
				name: matchData.home.name,

				score: matchData.score.home,

				logo: getTeamLogoUrl("home", matchData.home.logo),
			},

			awayTeam: {
				name: matchData.away.name,

				score: matchData.score.away,

				logo: getTeamLogoUrl("away", matchData.away.logo),
			},

			status: matchData.status,

			time,

			part: `Kwart ${timer.currentPart}`,
		});
	}

	private getMatchTimer(matchId: string): MatchTimeState {
		if (!this.matchTimers[matchId]) {
			this.matchTimers[matchId] = {
				currentPart: 1,
				elapsed: 0,
				syncedAt: Date.now(),
				running: false,
				lastActionId: 0,
			};
		}

		return this.matchTimers[matchId];
	}

	private processMatchAction(timer: MatchTimeState, action: MatchAction): void {
		const now = Date.now();

		/*
		 * First update running state.
		 */
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

		/*
		 * Only actual clock-control actions are authoritative
		 * for the timer.
		 *
		 * Goals and cards should not unexpectedly move the clock.
		 */
		if (this.isClockAction(action)) {
			const actionTime = new Date(action.action_at).getTime();

			let correctedElapsed = action.seconds_since_start ?? timer.elapsed;

			/*
			 * When the action started/resumed the clock,
			 * compensate for the time between action_at and now.
			 */
			if (timer.running && Number.isFinite(actionTime)) {
				correctedElapsed += Math.max(0, (now - actionTime) / 1000);
			}

			timer.elapsed = Math.max(correctedElapsed, 0);

			timer.syncedAt = now;
		}

		this.handleActionSideEffects(timer, action);

		timer.lastActionId = action.id;
	}

	private isClockAction(action: MatchAction): boolean {
		switch (action.action_type) {
			case "start":
			case "pause":
			case "resume":
			case "end":
			case "start-period":
			case "end-period":
				return true;

			default:
				return false;
		}
	}

	private handleActionSideEffects(
		timer: MatchTimeState,
		action: MatchAction,
	): void {
		switch (action.action_type) {
			case "start":
				timer.currentPart = 1;

				this.logAction("Match started");

				break;

			case "start-period":
				timer.currentPart =
					Math.floor(
						(action.seconds_since_start ?? 0) / PART_DURATION_SECONDS,
					) + 1;

				this.logAction(`Period ${timer.currentPart} started`);

				break;

			case "pause":
				this.logAction("Match paused");

				break;

			case "resume":
				this.logAction("Match resumed");

				break;

			case "end-period":
				this.logAction(`Period ${timer.currentPart} ended`);

				break;

			case "end":
				this.logAction("Match ended");

				break;

			case "goal":
				this.logAction(`Goal scored by ${action.side}`);

				break;

			case "card-green":
			case "card-yellow":
			case "card-red":
				this.handleCardAction(action);

				break;
		}
	}

	private updateRunningTimer(timer: MatchTimeState): void {
		if (!timer.running) {
			return;
		}

		const now = Date.now();

		timer.elapsed += (now - timer.syncedAt) / 1000;

		timer.syncedAt = now;
	}

	private getRemainingTime(timer: MatchTimeState): string {
		const periodEnd = PART_DURATION_SECONDS * timer.currentPart;

		const remaining = Math.max(periodEnd - timer.elapsed, 0);

		const minutes = Math.floor(remaining / 60);

		const seconds = Math.floor(remaining % 60);

		return `${minutes}:` + seconds.toString().padStart(2, "0");
	}

	// -------------------------------------------------------------------------
	// WebSocket publishing
	// -------------------------------------------------------------------------

	private publish(topic: string, message: unknown): void {
		this.socket.send(
			JSON.stringify({
				type: "publish",
				topic,
				message,
			}),
		);
	}

	private handleClock(): void {
		const time = new Date().toLocaleTimeString("nl-NL", {
			hour: "2-digit",
			minute: "2-digit",
		});

		this.publish("clock", { time });
	}

	private setScreenDisplay(status: DisplayStatus): void {
		this.publish("screen-1", { status });
	}

	private setCurrentMatch(fieldId: string, matchId: string): void {
		this.publish(`field-${fieldId}`, { matchId });
	}

	// -------------------------------------------------------------------------
	// Display state
	// -------------------------------------------------------------------------

	private getIdleDisplayStatus(): DisplayStatus {
		const now = new Date();

		const day = now.getDay();

		const hour = now.getHours();

		const weekday = day >= 1 && day <= 5;

		const evening = hour >= 16 && hour < 22;

		return weekday && evening ? "logo" : "off";
	}

	// -------------------------------------------------------------------------
	// Logging
	// -------------------------------------------------------------------------

	private handleCardAction(action: MatchAction): void {
		console.info(
			getLogTime(),
			": Card issued to",
			action.person_name ?? "Unknown",
			`(${action.action_type})`,
			"Duration:",
			action.duration_in_seconds ?? "N/A",
			"Action time:",
			new Date(action.action_at).toTimeString().split(" ")[0],
		);
	}

	private logAction(message: string): void {
		console.info(getLogTime(), ":", message);
	}
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function normalizeFieldId(field: string): string {
	return field.replace(/\s+/g, "").toLowerCase();
}

function getLogTime(): string {
	return new Date().toTimeString().split(" ")[0];
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTeamLogoUrl(
	side: "home" | "away",
	logo: string | null | undefined,
): string | null {
	const baseUrl = process.env.BETTER_AUTH_URL;

	if (!baseUrl) {
		return null;
	}

	if (!logo) {
		return `${baseUrl}/api/team/` + `${side}/logo`;
	}

	const encodedLogo = Buffer.from(logo, "utf-8").toString("base64");

	return (
		`${baseUrl}/api/team/` +
		`${side}/logo` +
		`?url=${encodeURIComponent(encodedLogo)}`
	);
}
