import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Normalizes Windows timezone names to standard IANA timezone names.
 * If the input is already a valid IANA timezone name, it returns it as is.
 * Otherwise, falls back to UTC.
 */
export function normalizeTimezone(timezone?: string | null): string {
  if (!timezone) return 'UTC';
  
  const trimmed = timezone.trim();
  
  // Try checking if it's already a valid IANA timezone in Node
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch (e) {
    // Continue to mapping dictionary
  }

  // Windows Standard Time Zone Database mapping (most common zones)
  const map: Record<string, string> = {
    'India Standard Time': 'Asia/Kolkata',
    'IST': 'Asia/Kolkata',
    'Eastern Standard Time': 'America/New_York',
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'Central Standard Time': 'America/Chicago',
    'CST': 'America/Chicago',
    'CDT': 'America/Chicago',
    'Mountain Standard Time': 'America/Denver',
    'MST': 'America/Denver',
    'MDT': 'America/Denver',
    'Pacific Standard Time': 'America/Los_Angeles',
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles',
    'W. Europe Standard Time': 'Europe/Berlin',
    'Central Europe Standard Time': 'Europe/Berlin',
    'Romance Standard Time': 'Europe/Paris',
    'GMT Standard Time': 'Europe/London',
    'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'W. Central Africa Standard Time': 'Africa/Lagos',
    'GTB Standard Time': 'Europe/Bucharest',
    'E. Europe Standard Time': 'Europe/Chisinau',
    'FLE Standard Time': 'Europe/Helsinki',
    'Russian Standard Time': 'Europe/Moscow',
    'China Standard Time': 'Asia/Shanghai',
    'Singapore Standard Time': 'Asia/Singapore',
    'Taiwan Standard Time': 'Asia/Taipei',
    'Taipei Standard Time': 'Asia/Taipei',
    'Tokyo Standard Time': 'Asia/Tokyo',
    'Korea Standard Time': 'Asia/Seoul',
    'Yakutsk Standard Time': 'Asia/Yakutsk',
    'Vladivostok Standard Time': 'Asia/Vladivostok',
    'Tasmania Standard Time': 'Australia/Hobart',
    'AUS Eastern Standard Time': 'Australia/Sydney',
    'Cen. Australia Standard Time': 'Australia/Adelaide',
    'W. Australia Standard Time': 'Australia/Perth',
    'New Zealand Standard Time': 'Pacific/Auckland',
    'UTC': 'UTC',
    'GMT': 'UTC'
  };

  if (map[trimmed]) {
    return map[trimmed];
  }

  // Case-insensitive check
  const lower = trimmed.toLowerCase();
  for (const [win, iana] of Object.entries(map)) {
    if (win.toLowerCase() === lower) {
      return iana;
    }
  }

  // If there's a custom offset string like "GMT+05:30" or "UTC+05:30", map it if possible
  const offsetMatch = trimmed.match(/^(?:UTC|GMT)\s*([+-]\d{1,2}):?(\d{2})?$/i);
  if (offsetMatch && offsetMatch[1]) {
    // E.g., UTC+5:30 -> Asia/Kolkata-like or general fixed offset
    const sign = offsetMatch[1][0];
    const hour = offsetMatch[1].slice(1).padStart(2, '0');
    const min = (offsetMatch[2] || '00').padStart(2, '0');
    return `${sign}${hour}:${min}`;
  }

  // Default fallback
  return 'UTC';
}

/**
 * Escapes unescaped control characters inside double-quoted string literals in a JSON string.
 */
function escapeControlCharsInStrings(jsonStr: string): string {
  let inString = false;
  let escape = false;
  const chars = [...jsonStr];
  
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === undefined) continue;
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      if (char === '\n') {
        chars[i] = '\\n';
      } else if (char === '\r') {
        chars[i] = '\\r';
      } else if (char === '\t') {
        chars[i] = '\\t';
      }
    }
  }
  return chars.join('');
}

/**
 * Strips trailing commas from arrays and objects inside a JSON string.
 */
function stripTrailingCommas(jsonStr: string): string {
  let inString = false;
  let escape = false;
  const chars = [...jsonStr];
  let lastCommaIdx = -1;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === undefined) continue;
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    
    // Outside string literal
    if (char === ',') {
      lastCommaIdx = i;
    } else if (char === '}' || char === ']') {
      if (lastCommaIdx !== -1) {
        const slice = chars.slice(lastCommaIdx + 1, i).join('');
        if (/^\s*$/.test(slice)) {
          chars[lastCommaIdx] = ' ';
        }
      }
      lastCommaIdx = -1;
    } else if (!/\s/.test(char)) {
      lastCommaIdx = -1;
    }
  }
  return chars.join('');
}

/**
 * Safely extracts, cleans, and parses JSON output from LLM responses.
 * Handles common LLM errors like markdown code blocks, trailing commas,
 * smart quotes, and unescaped newlines/control characters.
 */
export function cleanAndParseJson<T = any>(str: string): T {
  const startIdx = str.indexOf('{');
  const endIdx = str.lastIndexOf('}');
  
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error('No valid JSON object found in LLM response');
  }
  
  let jsonString = str.substring(startIdx, endIdx + 1);

  // Replace smart quotes
  jsonString = jsonString
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  // Escape unescaped control characters inside string literals
  jsonString = escapeControlCharsInStrings(jsonString);

  // Strip trailing commas outside string literals
  jsonString = stripTrailingCommas(jsonString);

  // Attempt 1: Direct parse
  try {
    return JSON.parse(jsonString) as T;
  } catch (firstError: any) {
    // Attempt 2: Strip any 'transcription' field that may contain unescaped content
    // This regex removes "transcription": "..." including nested quotes by finding
    // the field and consuming until we find a clean JSON boundary
    const withoutTranscription = stripProblematicField(jsonString, 'transcription');
    if (withoutTranscription !== jsonString) {
      try {
        return JSON.parse(withoutTranscription) as T;
      } catch { /* continue to next attempt */ }
    }

    // Attempt 3: Try to extract key-value pairs with regex-based recovery
    try {
      const recovered = regexRecoverJson(jsonString);
      if (recovered) return recovered as T;
    } catch { /* continue */ }

    console.error('[JSON Parser] Failed to parse cleaned JSON. Original string snippet:', str.substring(0, 100) + '...');
    console.error('[JSON Parser] Cleaned JSON string:', jsonString.substring(0, 500));
    throw new Error(`JSON parse error: ${firstError.message}`);
  }
}

/**
 * Strips a problematic long-string field from a JSON string by finding
 * its key and carefully removing everything from the key to the next
 * valid field boundary or closing brace.
 */
function stripProblematicField(json: string, fieldName: string): string {
  // Match "fieldName" : " and then find the end boundary
  const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'i');
  const match = fieldPattern.exec(json);
  if (!match) return json;

  const fieldStart = match.index;
  const valueStart = fieldStart + match[0].length;
  
  // Walk forward from valueStart to find the end of the string value
  // Look for an unescaped quote followed by , or } (the next field boundary)
  let i = valueStart;
  while (i < json.length) {
    if (json[i] === '\\' && i + 1 < json.length) {
      i += 2; // skip escaped character
      continue;
    }
    if (json[i] === '"') {
      // Check what comes after this closing quote (ignoring whitespace)
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j]!)) j++;
      if (j < json.length && (json[j] === ',' || json[j] === '}')) {
        // Found the proper end of this string value
        const endIdx = json[j] === ',' ? j + 1 : j; // include comma if present
        return json.substring(0, fieldStart) + json.substring(endIdx);
      }
    }
    i++;
  }

  return json; // couldn't find clean boundary, return unchanged
}

/**
 * Last-resort recovery: extract known fields using targeted regexes
 * and reconstruct a valid JSON object from them.
 */
function regexRecoverJson(json: string): Record<string, any> | null {
  const extractString = (key: string): string | null => {
    // Match "key": "value" — take the shortest non-greedy match that ends at ",\n or "\n}
    const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]{0,500})"`, 'i');
    const m = pattern.exec(json);
    return m ? m[1]! : null;
  };

  const extractNumber = (key: string): number | null => {
    const pattern = new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'i');
    const m = pattern.exec(json);
    return m ? parseInt(m[1]!, 10) : null;
  };

  const extractBoolean = (key: string): boolean | null => {
    const pattern = new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'i');
    const m = pattern.exec(json);
    return m ? m[1] === 'true' : null;
  };

  const extractArray = (key: string): string[] | null => {
    const pattern = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]{0,2000})\\]`, 'i');
    const m = pattern.exec(json);
    if (!m) return null;
    try {
      return JSON.parse(`[${m[1]}]`);
    } catch {
      // Extract quoted strings manually
      const items: string[] = [];
      const itemPattern = /"([^"]+)"/g;
      let im;
      while ((im = itemPattern.exec(m[1]!)) !== null) {
        items.push(im[1]!);
      }
      return items.length > 0 ? items : [];
    }
  };

  const summary = extractString('summary');
  if (!summary) return null; // Can't recover without at least a summary

  const result: Record<string, any> = { summary };
  
  const project = extractString('project');
  if (project) result.project = project;
  
  const subproject = extractString('subproject');
  result.subproject = subproject; // can be null
  
  const entities = extractArray('entities');
  result.entities = entities || [];
  
  const people = extractArray('people');
  result.people = people || [];
  
  const contradictions = extractArray('contradictions');
  result.contradictions = contradictions || [];
  
  const actionItems = extractArray('action_items');
  result.action_items = actionItems || [];
  
  const sentiment = extractString('sentiment');
  result.sentiment = sentiment || 'neutral';
  
  const moodScore = extractNumber('mood_score');
  result.mood_score = moodScore || 5;
  
  const requiresResearch = extractBoolean('requires_research');
  result.requires_research = requiresResearch || false;
  
  const researchQuery = extractString('research_query');
  result.research_query = researchQuery;

  console.warn('[JSON Parser] Recovered JSON via regex fallback:', Object.keys(result).join(', '));
  return result;
}

/**
 * Scans the database and normalizes any legacy/invalid timezone entries.
 */
export async function normalizeAllUserTimezones(): Promise<void> {
  console.log('[Timezone] Normalizing user timezone settings in database...');
  try {
    const allUsers = await db.select({ id: users.id, timezone: users.timezone }).from(users);
    let updatedCount = 0;
    for (const u of allUsers) {
      const normalized = normalizeTimezone(u.timezone);
      if (normalized !== u.timezone) {
        console.log(`[Timezone] Migrating user ${u.id} timezone from "${u.timezone}" to "${normalized}"`);
        await db.update(users).set({ timezone: normalized }).where(eq(users.id, u.id));
        updatedCount++;
      }
    }
    console.log(`[Timezone] Normalization check complete. Updated ${updatedCount} user(s).`);
  } catch (error) {
    console.error('[Timezone] Failed to normalize user timezones in database:', error);
  }
}
