export interface TeamResponse {
	data: TeamData;
	status: number;
	message: string;
}

export interface TeamData {
	id: string;
	name: string;
	short_name: string;
	type: string;
	category_group: string;
	category_name: string;
	order: number;
	gender: string | null;
	club_name: string;
	logo: string;
	club_id: string;
	competitions: Array<{
		id: string;
		name: string;
		match_date: string;
		last_played_match_date: string | null;
		gender: string | null;
		logo: string;
	}>;
	live: boolean;
	next_match_date: string;
	my_team: boolean;
	// Add other fields as necessary
}
