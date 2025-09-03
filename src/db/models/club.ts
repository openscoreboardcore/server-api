import {
	blob,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { defaultUuidBlob } from "../lib/uuidBlob";

export const clubs = sqliteTable(
	"club",
	{
		id: blob("id", { mode: "buffer" })
			.primaryKey()
			.$defaultFn(defaultUuidBlob()),
		importedId: text("importedId"),
		name: text("name").notNull(),
		logo: blob("logo", { mode: "buffer" }),
		createdAt: integer("createdAt", { mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => [
		index("teams_importedId_idx").on(table.importedId),
		index("teams_createdAt_idx").on(table.createdAt),
	]
);
