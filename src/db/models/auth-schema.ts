import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defaultUuidBlob } from "../lib/uuidBlob";

export const user = sqliteTable("user", {
	id: blob("id", { mode: "buffer" }).primaryKey().$defaultFn(defaultUuidBlob()),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.default(false)
		.notNull(),
	image: text("image"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date())
		.notNull(),
});

export const session = sqliteTable("session", {
	id: blob("id", { mode: "buffer" }).primaryKey().$defaultFn(defaultUuidBlob()),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	token: text("token").notNull().unique(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$onUpdate(() => new Date())
		.notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: blob("user_id", { mode: "buffer" })
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
	id: blob("id", { mode: "buffer" }).primaryKey().$defaultFn(defaultUuidBlob()),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: blob("user_id", { mode: "buffer" })
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: integer("access_token_expires_at", {
		mode: "timestamp",
	}),
	refreshTokenExpiresAt: integer("refresh_token_expires_at", {
		mode: "timestamp",
	}),
	scope: text("scope"),
	password: text("password"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$onUpdate(() => new Date())
		.notNull(),
});

export const verification = sqliteTable("verification", {
	id: blob("id", { mode: "buffer" }).primaryKey().$defaultFn(defaultUuidBlob()),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date())
		.notNull(),
});
