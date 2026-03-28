export interface FacilityResponse {
	data: FacilityData;
}

export interface FacilityData {
	id: number;
	name: string;
	address: FacilityAddress;
	matches: FacilityMatch[];
}

export interface FacilityAddress {
	id: number;
	country_code: string;
	city: string;
	postal_code: string;
	street_address: string;
	lat: string;
	lon: string;
}

export interface FacilityMatch {
	id: number;
	date: string;
	status: "scheduled" | "final" | "result" | "in_progress" | "InProgress";
	cancellation_minute: number | null;

	home: Team;
	away: Team;
	own_team_id: number | null;

	shootouts: ShootoutScore;
	score: MatchScore;

	poule_name: string | null;
	poule_id: number;
	remarks: string | null;
	competition_name: string | null;
	gender: string | null;

	role: string;
	role_name: string | null;

	round: number;
	user_action_required: boolean;
	user_action_description: string | null;
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
