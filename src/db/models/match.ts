import {
	blob,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { defaultUuidBlob } from "../lib/uuidBlob";
import { fields } from "./field";
import { teams } from "./team";

export const matches = sqliteTable(
	"matches",
	{
		id: blob("id", { mode: "buffer" })
			.primaryKey()
			.$defaultFn(defaultUuidBlob()),
		fieldId: blob("fieldId", { mode: "buffer" }).references(() => fields.id),
		matchNumber: text("matchNumber").unique().notNull(),
		homeTeamId: blob("homeTeamId", { mode: "buffer" }).references(
			() => teams.id
		),
		awayTeamId: blob("awayTeamId", { mode: "buffer" }).references(
			() => teams.id
		),
		date: integer("date", { mode: "timestamp_ms" }).notNull(), // JS Date support
		createdAt: integer("createdAt", { mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => [
		index("matches_matchNumber_idx").on(table.matchNumber),
		index("matches_date_idx").on(table.date),
	]
);
