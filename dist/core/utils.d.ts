/**
 * Normalizes Windows timezone names to standard IANA timezone names.
 * If the input is already a valid IANA timezone name, it returns it as is.
 * Otherwise, falls back to UTC.
 */
export declare function normalizeTimezone(timezone?: string | null): string;
/**
 * Safely extracts, cleans, and parses JSON output from LLM responses.
 * Handles common LLM errors like markdown code blocks, trailing commas,
 * smart quotes, and unescaped newlines/control characters.
 */
export declare function cleanAndParseJson<T = any>(str: string): T;
/**
 * Scans the database and normalizes any legacy/invalid timezone entries.
 */
export declare function normalizeAllUserTimezones(): Promise<void>;
//# sourceMappingURL=utils.d.ts.map