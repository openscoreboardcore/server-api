import { parse, stringify } from "uuid";

/**
 * Converts a UUID string to 16-byte Buffer for SQLite blob
 */
export function uuidToBuffer(uuid: string): Buffer {
	return Buffer.from(parse(uuid));
}

/**
 * Converts a 16-byte Buffer from SQLite blob back to UUID string
 */
export function bufferToUuid(buf: Buffer | Uint8Array): string {
	return stringify(new Uint8Array(buf));
}

/**
 * Returns a $defaultFn function for Drizzle blob columns
 */
export function defaultUuidBlob() {
	return () => uuidToBuffer(Bun.randomUUIDv7());
}
