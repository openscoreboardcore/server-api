export interface MatchResponse {
	data: MatchData;
}
export interface MatchListResponse {
	data: {
		matches: MatchData[];
	};
}

export interface MatchData {
	id: number;
	date: string;
	status: string;
	cancellation_minute: number | null;

	home: Team;
	away: Team;
	own_team_id: number | null;

	shootouts: ShootoutScore;
	score: MatchScore;

	location: MatchLocation;
	actions: MatchAction[];

	poule_name: string | null;
	poule_id: number;
	remarks: string | null;
	competition_name: string | null;
	gender: string | null;

	role: string;
	role_name: string | null;
	announcement: string | null;
	videos: unknown[];

	round: number;
	user_action_required: boolean;
	user_action_description: string | null;

	weather: Weather;
}

export interface Team {
	id: number;
	name: string;
	short_name: string;
	logo: string;
	hockey_type: string;
	category_group_name: string;
	federation_reference_id: string;
	recent_poule_id: number;
}

export interface ShootoutScore {
	home: number;
	away: number;
}

export interface MatchScore {
	home: number;
	away: number;
}

export interface MatchLocation {
	facility: {
		name: string;
		address: string;
	};
	field: {
		name: string;
		type: string;
	};
	announcement: string | null;
}

export interface MatchAction {
	id: number;
	match_id: number;
	action: "match" | "goal" | "card";
	action_type:
		| "start"
		| "pause"
		| "resume"
		| "end"
		| "submit"
		| "start-period"
		| "end-period"
		| "goal"
		| "card-green"
		| "card-yellow"
		| "card-red";
	side: "home" | "away" | "both";
	action_at: string;
	seconds_since_start: number;
	team_id: number;
	reason: string | null;
	duration_in_seconds: number | null;
	person_name: string | null;
}

export interface Weather {
	condition_code: string;
	rating: string;
	grade: number;
	temperature: number;
	temperature_apparent: number;
	precipitation_type: string;
	precipitation_chance: number;
	precipitation_amount: number;
	humidity: number;
	description: string;
	icon: {
		vector: string;
		raster: string;
		name: string;
	};
}

export type Announcement = any; // replace with real shape if known
