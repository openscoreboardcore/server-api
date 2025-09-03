import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defaultUuidBlob } from "../lib/uuidBlob";

export const fields = sqliteTable("fields", {
	id: blob("id", { mode: "buffer" }).primaryKey().$defaultFn(defaultUuidBlob()),
	name: text("name").notNull(),
	createdAt: integer("createdAt", { mode: "timestamp_ms" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
		.$defaultFn(() => new Date())
		.notNull(),
});
