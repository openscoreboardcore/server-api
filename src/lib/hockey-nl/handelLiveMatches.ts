import type { MatchAction, MatchResponse } from "@/types/match.types";
import type WebSocketClient from "../ws/WebSocketClient";
import { retainTopic } from "../ws/RetainedTopics";
import { getMatchDetails, getMatchesByFacility, type HockeyAuth } from "./api";
const PART_DURATION_SECONDS = 17 * 60 + 30;
const DISCOVERY_INTERVAL_MS = 60_000;
const LIVE_REFRESH_INTERVAL_MS = 10_000;
const DISPLAY_UPDATE_INTERVAL_MS = 1_000;
// Configurable between 0 and 20 minutes; invalid values use 20.
const configuredResultMinutes = Number(process.env.RESULT_DISPLAY_MINUTES ?? "20");
const RESULT_DISPLAY_MS = (Number.isFinite(configuredResultMinutes)
    ? Math.min(20, Math.max(0, configuredResultMinutes)) : 20) * 60_000;
// Without an API end timestamp, scheduled start is the conservative restart guard.
const RESULT_MAX_AGE_MS = 120 * 60_000;
const MATCH_START_WINDOW_MS = 20 * 60 * 1000;
const MATCH_END_WINDOW_MS = 100 * 60 * 1000;
type DisplayStatus = "off" | "logo" | "match" | "sponsor" | "schema";
interface CurrentMatch {
    id: string;
    time: string;
    field: string;
    details: MatchResponse;
}
interface MatchTimeState {
    currentPart: number;
    elapsed: number;
    syncedAt: number;
    running: boolean;
    lastActionId: number;
}
export default class HandelLiveMatchesLoop {
    private readonly auth: HockeyAuth;
    private readonly socket: WebSocketClient;
    private readonly matchTimers: Record<string, MatchTimeState> = {};
    private readonly selectedMatches: Record<string, MatchResponse | undefined> =
        {};
    private readonly candidates = new Map<string, CurrentMatch>();
    private readonly observedLive = new Set<string>();
    private readonly resultDeadlines = new Map<string, number>();
    // Terminal observations are monotonic: stale API data cannot revive a match.
    private readonly terminalStatuses = new Map<string, string>();
    private readonly fieldProgress = new Map<string, number>();
    private apiQueue: Promise<void> = Promise.resolve();
    private discoveryPromise: Promise<void> | null = null;
    private readonly knownFields = new Set<string>();
    private stopped = false;
    private displayInterval: ReturnType<typeof setInterval> | undefined;
    constructor(
        socket: WebSocketClient,
        token: string,
        uuid: string,
    ) {
        this.socket = socket;
        this.auth = {
            token,
            uuid,
        };
        void this.startDiscoveryLoop();
        void this.startLiveRefreshLoop();
        this.displayInterval = setInterval(
            () => this.handleDisplayTick(),
            DISPLAY_UPDATE_INTERVAL_MS,
        );
    }
    public stop(): void {
        this.stopped = true;
        if (this.displayInterval) {
            clearInterval(this.displayInterval);
            this.displayInterval = undefined;
        }
    }
    private async startDiscoveryLoop(): Promise<void> {
        while (!this.stopped) {
            try {
                await this.requestDiscovery();
            } catch (error) {
                console.error("[HockeyNL] Discovery failed:", error);
            }
            await sleep(DISCOVERY_INTERVAL_MS);
        }
    }
    private async startLiveRefreshLoop(): Promise<void> {
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
        if (this.stopped) return;
        this.handleClock();
        // Selection is time-based, not dependent on a successful API response.
        this.selectAndPublish();
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const next = this.apiQueue.then(async () => {
            if (!this.stopped) await task();
        });
        this.apiQueue = next.catch(() => undefined);
        return next;
    }

    private requestDiscovery(): Promise<void> {
        if (this.stopped) return Promise.resolve();
        if (this.discoveryPromise) return this.discoveryPromise;
        const task = this.enqueue(() => this.refreshMatches()).finally(() => {
            if (this.discoveryPromise === task) this.discoveryPromise = null;
        });
        this.discoveryPromise = task;
        return task;
    }

    private async refreshMatches(): Promise<void> {
        // All discovery/live writes run through the same queue. No response from
        // an older discovery can overwrite a newer live refresh (or vice versa).
        const currentMatches = await this.fetchCurrentMatches();
        if (this.stopped) return;
        if (currentMatches !== null) {
            this.candidates.clear();
            for (const match of currentMatches) this.candidates.set(match.id, match);
        }
        this.selectAndPublish();
    }

    private status(value: string): string {
        return (value ?? "").trim().toLowerCase();
    }

    private isTerminal(status: string): boolean {
        return ["result", "finished", "completed", "ended", "final",
            "cancelled", "canceled"].includes(this.status(status));
    }

    private observeStatus(id: string, date: string, status: string, freshDetails = false): string {
        const observed = this.status(status);
        if (freshDetails && observed === "live" && !this.terminalStatuses.has(id)) {
            this.observedLive.add(id);
        }
        const previous = this.terminalStatuses.get(id);
        // Allow a non-result final status to acquire an actual final score later.
        const effective = previous === "result" ? previous
            : observed === "result" ? observed : previous ?? observed;
        if (this.isTerminal(effective)) this.terminalStatuses.set(id, effective);
        if (effective === "result" && !this.resultDeadlines.has(id)) {
            const now = Date.now();
            const start = Date.parse(date);
            this.resultDeadlines.set(id,
                this.observedLive.has(id) ? now + RESULT_DISPLAY_MS
                    : Number.isFinite(start) && start <= now
                        ? Math.min(now + RESULT_DISPLAY_MS, start + RESULT_MAX_AGE_MS)
                        : now);
        }
        return effective;
    }

    private resultDisplayable(id: string, now: number): boolean {
        return now < (this.resultDeadlines.get(id) ?? -Infinity);
    }

    private selectAndPublish(): void {
        if (this.stopped) return;
        const now = Date.now();
        const groups = new Map<string, CurrentMatch[]>();
        for (const match of this.candidates.values()) {
            const field = normalizeFieldId(match.field);
            if (!field) continue;
            this.knownFields.add(field);
            const group = groups.get(field) ?? [];
            group.push(match);
            groups.set(field, group);
        }
        for (const field of this.knownFields) {
            const matches = groups.get(field) ?? [];
            const byStart = (a: CurrentMatch, b: CurrentMatch) =>
                Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id);
            const live = matches.filter(m => this.status(m.details.data.status) === "live")
                .sort(byStart)[0];
            const scheduled = matches.filter(m => {
                const status = this.status(m.details.data.status);
                const start = Date.parse(m.time);
                return status !== "live" && !this.isTerminal(status)
                    && Number.isFinite(start) && now >= start - MATCH_START_WINDOW_MS
                    && now < start + MATCH_END_WINDOW_MS;
            }).sort((a, b) => {
                // A delayed, never-live fixture must not block the next fixture.
                const aPast = Date.parse(a.time) < now ? 1 : 0;
                const bPast = Date.parse(b.time) < now ? 1 : 0;
                return aPast - bPast || byStart(a, b);
            })[0];
            const result = matches.filter(m =>
                this.status(m.details.data.status) === "result"
                && this.resultDisplayable(m.id, now)
                && Date.parse(m.time) >= (this.fieldProgress.get(field) ?? -Infinity)
            ).sort((a, b) => -byStart(a, b))[0];
            const selected = live ?? scheduled ?? result;
            if (selected && selected !== result) {
                const start = Date.parse(selected.time);
                if (Number.isFinite(start)) this.fieldProgress.set(field,
                    Math.max(start, this.fieldProgress.get(field) ?? -Infinity));
            }
            this.selectedMatches[field] = selected?.details;
            this.publishFieldState(field);
            if (selected) this.handleWebsocketData(field);
        }
    }

    private publishFieldState(fieldId: string): void {
        const matchId = this.selectedMatches[fieldId]?.data?.id?.toString() ?? null;
        this.publish(`field-${fieldId}`, {
            fieldId,
            matchId,
            status: matchId ? "match" : this.getIdleDisplayStatus(),
        });
    }
    private async fetchCurrentMatches(): Promise<CurrentMatch[] | null> {
        const facilityId = process.env.FACILITY_ID;
        if (!facilityId) {
            console.error("[HockeyNL] FACILITY_ID is not configured.");
            return null;
        }
        const response = await getMatchesByFacility(facilityId, this.auth);
        if (this.stopped || !Array.isArray(response?.data?.matches)) return null;
        const matches: CurrentMatch[] = [];
        let incomplete = false;
        for (const match of response.data.matches) {
            if (this.stopped) return null;
            const id = match.id.toString();
            const start = Date.parse(match.date);
            const status = this.observeStatus(id, match.date, match.status);
            if (status === "result" && !this.resultDisplayable(id, Date.now())) continue;
            if (this.isTerminal(status) && status !== "result") continue;
            // Keep future fixtures as candidates so the display tick can switch
            // exactly at the start-window boundary, even if discovery is down.
            if (status !== "live" && status !== "result"
                && (!Number.isFinite(start) || Date.now() >= start + MATCH_END_WINDOW_MS)) continue;
            try {
                // Discovery always revalidates details. No expired cache fallback.
                const details = await getMatchDetails(id, this.auth);
                if (this.stopped) return null;
                if (!details?.data?.id || details.data.id.toString() !== id) {
                    incomplete = true;
                    continue;
                }
                const effective = this.observeStatus(id, match.date, details.data.status, true);
                const normalized = { ...details, data: { ...details.data, status: effective } };
                const field = details.data.location?.field?.name;
                if (!field) { incomplete = true; continue; }
                const candidate = { id, time: match.date, field, details: normalized };
                matches.push(candidate);
                // Merge successful detail updates even if another request fails.
                this.candidates.set(id, candidate);
            } catch (error) {
                incomplete = true;
                console.warn(`[HockeyNL] Could not fetch details for ${id}.`, error);
            }
        }
        // Terminal facility observations must also reach retained candidates if
        // fetching their details failed; an old live response cannot stay live.
        for (const [id, candidate] of this.candidates) {
            const status = this.terminalStatuses.get(id);
            if (status) this.candidates.set(id, { ...candidate,
                details: { ...candidate.details, data: { ...candidate.details.data, status } } });
        }
        return incomplete ? null : matches;
    }

    private refreshLiveMatches(): Promise<void> {
        return this.enqueue(async () => {
            // Refresh every known live candidate, including an unselected match.
            for (const [id, candidate] of this.candidates) {
                if (this.stopped) return;
                if (this.status(candidate.details.data.status) !== "live") continue;
                try {
                    const fresh = await getMatchDetails(id, this.auth);
                    if (this.stopped) return;
                    if (!fresh?.data?.id || fresh.data.id.toString() !== id) continue;
                    const status = this.observeStatus(id, candidate.time, fresh.data.status, true);
                    const field = fresh.data.location?.field?.name ?? candidate.field;
                    this.candidates.set(id, { ...candidate, field,
                        details: { ...fresh, data: { ...fresh.data, status } } });
                    this.selectAndPublish();
                    // Queue discovery after this refresh, without awaiting itself.
                    if (status !== "live") void this.requestDiscovery().catch(error =>
                        console.error("[HockeyNL] Discovery failed:", error));
                } catch (error) {
                    console.warn(`[HockeyNL] Could not refresh live match ${id}.`, error);
                }
            }
            this.selectAndPublish();
        });
    }

    private handleWebsocketData(field: string): void {
        const match = this.selectedMatches[field];
        if (!match?.data?.id) {
            return;
        }
        const matchData = match.data;
        const timer = this.getMatchTimer(matchData.id.toString());
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
        // A final status is authoritative even when the API omits an end action.
        if (this.isTerminal(matchData.status)) timer.running = false;
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
        if (this.isClockAction(action)) {
            const actionTime = new Date(action.action_at).getTime();
            let correctedElapsed = action.seconds_since_start ?? timer.elapsed;
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
    private publish(topic: string, message: unknown): void {
        this.socket.send(
            JSON.stringify({
                type: "publish",
                topic,
                message,
            }),
        );
        retainTopic(topic, message);
    }
    private handleClock(): void {
        const time = new Date().toLocaleTimeString("nl-NL", {
            hour: "2-digit",
            minute: "2-digit",
        });
        this.publish("clock", { time });
    }
    private getIdleDisplayStatus(): DisplayStatus {
        const now = new Date();
        const day = now.getDay();
        const hour = now.getHours();
        const weekday = day >= 1 && day <= 5;
        const evening = hour >= 16 && hour < 22;
        return weekday && evening ? "logo" : "off";
    }
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
function normalizeFieldId(field: string): string | null {
    const match = field.match(/\bveld\s*[-_ ]?\s*(\d+)\b/i);
    return match ? `veld${Number(match[1])}` : null;
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
