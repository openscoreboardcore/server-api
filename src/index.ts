// import { migrate } from "drizzle-orm/bun-sqlite/migrator";
// import { db } from "./db/db";
import "./server";

process.env.TZ = "UTC";
// migrate(db, {
// 	migrationsFolder: "./src/db/migrations",
// });
console.log("Server initialized");
