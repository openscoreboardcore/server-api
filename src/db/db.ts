import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as models from "./models";

const sqlite = new Database(process.env.DB_FILE_NAME!);

export const db = drizzle({ client: sqlite, schema: models });
