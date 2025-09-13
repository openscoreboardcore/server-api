export interface MatchResponse {
	data: MatchData;
	status: number;
	message: string;
}
export interface MatchListResponse {
	data: MatchData[];
	status: number;
	message: string;
}

export interface MatchData {
	id: string;
	datetime: string;
	location: Location;
	home_team: Team;
	away_team: Team;
	home_score: number;
	away_score: number;
	home_shootout: number | null;
	away_shootout: number | null;
	competition: string;
	poule: string;
	status: string;
	field: string;
	actions: Action[];
	announcements: Announcement[];
	facility_official: string | null;
}

export interface Location {
	street: string;
	house_number: string;
	postal_code: string;
	city: string;
	description: string;
	facility_id: string;
	district: string;
}

export interface Team {
	id: string;
	name: string;
	gender: string | null;
	club_name: string;
	logo: string | null;
	my_team: boolean;
}

export interface Action {
	side: "home" | "away" | "both";
	action: "match" | "goal";
	type: string;
	actionAt: string;
	minute: number | null;
	seconds_since_start: number | null;
	duration: number | null;
	reason: string | null;
	playerId: string | null;
	playerName: string | null;
	staffId: string | null;
	staffName: string;
}

export type Announcement = any; // replace with real shape if known
