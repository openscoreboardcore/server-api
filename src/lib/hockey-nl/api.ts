import crypto from "crypto";

import type { MatchResponse, Team } from "@/types/match.types";

import type { FacilityResponse } from "@/types/team.types";

export interface HockeyAuth {
	token: string;
	uuid: string;
}

const BASE_URL = "https://app.hockeyweerelt.nl";

const REQUEST_SPACING_MS = 500;

export class HockeyApiError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly url?: string,
	) {
		super(message);
		this.name = "HockeyApiError";
	}
}

class HockeyApiQueue {
	private queue: Array<{
		execute: () => Promise<unknown>;
		resolve: (value: unknown) => void;
		reject: (error: unknown) => void;
	}> = [];

	private processing = false;

	/**
	 * Don't make another request before this timestamp.
	 *
	 * This gets updated when HockeyWeerelt returns 429.
	 */
	private blockedUntil = 0;

	async add<T>(execute: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push({
				execute,
				resolve: (value) => resolve(value as T),
				reject,
			});

			void this.process();
		});
	}

	private async process(): Promise<void> {
		if (this.processing) {
			return;
		}

		this.processing = true;

		try {
			while (this.queue.length > 0) {
				await this.waitUntilAllowed();

				const item = this.queue.shift();

				if (!item) {
					continue;
				}

				try {
					const result = await item.execute();

					item.resolve(result);
				} catch (error) {
					item.reject(error);
				}

				await sleep(REQUEST_SPACING_MS);
			}
		} finally {
			this.processing = false;

			// Race protection:
			// something may have entered the queue between
			// while() ending and processing being reset.
			if (this.queue.length > 0) {
				void this.process();
			}
		}
	}

	blockFor(ms: number): void {
		this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
	}

	private async waitUntilAllowed(): Promise<void> {
		const remaining = this.blockedUntil - Date.now();

		if (remaining > 0) {
			console.warn(`[HockeyNL] Queue blocked for ${remaining}ms`);

			await sleep(remaining);
		}
	}
}

const hockeyQueue = new HockeyApiQueue();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value: string): string {
	return value.replace(/[^a-zA-Z0-9\-/=]+/g, "");
}

function generateSignature(
	path: string,
	params: Record<string, unknown>,
	timestamp: number,
	uuid: string,
): string {
	const cleanPath = path.replace(/[^a-zA-Z0-9\-/]+/g, "");

	let queryString = "";

	for (const key of Object.keys(params)) {
		const value = params[key];

		if (!key || value === undefined || value === null) {
			continue;
		}

		const cleanKey = clean(key);

		if (Array.isArray(value)) {
			for (const item of value) {
				queryString += `${cleanKey}=${clean(String(item))}`;
			}
		} else {
			queryString += `${cleanKey}=${clean(String(value))}`;
		}
	}

	const reversedUuid = uuid.split("").reverse().join("");

	const payload = `${timestamp}${cleanPath}${queryString}${reversedUuid}`;

	return crypto.createHash("sha1").update(payload).digest("hex");
}

function buildUrl(path: string, params: Record<string, unknown>): URL {
	const url = new URL(BASE_URL + path);

	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) {
			continue;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				url.searchParams.append(key, String(item));
			}
		} else {
			url.searchParams.append(key, String(value));
		}
	}

	return url;
}

async function executeHockeyRequest<T>(
	path: string,
	params: Record<string, unknown>,
	auth: HockeyAuth,
	options: RequestInit,
): Promise<T> {
	/*
	 * Generate these immediately before the actual HTTP request.
	 *
	 * A queued request could have been waiting for a minute, so we
	 * must not generate the timestamp/signature when it enters
	 * the queue.
	 */
	const timestamp = Math.floor(Date.now() / 1000);

	const signature = generateSignature(path, params, timestamp, auth.uuid);

	const url = buildUrl(path, params);

	const response = await fetch(url, {
		...options,

		headers: {
			Accept: "application/json",

			"X-HAPI-Authorization": auth.token,

			"X-HAPI-Signature": signature,

			"X-HAPI-Timestamp": timestamp.toString(),

			"X-HAPI-Version": "7",

			...options.headers,
		},
	});

	if (response.status === 429) {
		const retryAfter = Number(response.headers.get("retry-after") ?? "60");

		const waitMs = Math.max(retryAfter * 1000, 1_000) + 500;

		hockeyQueue.blockFor(waitMs);

		await response.text().catch(() => undefined);

		throw new HockeyApiError(`Rate limited for ${waitMs}ms`, 429, response.url);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => "");

		throw new HockeyApiError(
			[`${response.status}`, response.statusText, body]
				.filter(Boolean)
				.join(" "),
			response.status,
			response.url,
		);
	}

	return (await response.json()) as T;
}

export function hockeyFetch<T>(
	path: string,
	params: Record<string, unknown>,
	auth: HockeyAuth,
	options: RequestInit = {},
): Promise<T> {
	return hockeyQueue.add(() =>
		executeHockeyRequest<T>(path, params, auth, options),
	);
}

export async function getMatchesByFacility(
	facilityId: string,
	auth: HockeyAuth,
): Promise<FacilityResponse> {
	const today = new Date();

	const tomorrow = new Date(today);

	tomorrow.setDate(tomorrow.getDate() + 1);

	return hockeyFetch<FacilityResponse>(
		`/facilities/${facilityId}/matches`,
		{
			"filter[dateStart]": formatDate(today),

			"filter[dateEnd]": formatDate(tomorrow),
		},
		auth,
	);
}

export async function getMatchDetails(
	matchId: string,
	auth: HockeyAuth,
): Promise<MatchResponse> {
	return hockeyFetch<MatchResponse>(`/matches/${matchId}`, {}, auth, {
		cache: "no-store",

		headers: {
			"Cache-Control": "no-cache",
		},
	});
}

export async function getTeamById(
	teamId: string,
	token: string,
): Promise<Team> {
	const response = await fetch(`${BASE_URL}/teams/${teamId}`, {
		headers: {
			"X-HAPI-Authorization": token,
		},
	});

	if (!response.ok) {
		throw new HockeyApiError(
			`Failed to fetch team ${teamId}`,
			response.status,
			response.url,
		);
	}

	return (await response.json()) as Team;
}

function formatDate(date: Date): string {
	return date.toISOString().split("T")[0];
}
