/**
 * Zero-width character encoding utility
 * These functions convert between numbers and invisible zero-width characters
 * that can be included in messages without being visible to users.
 */

// Zero-width characters for encoding
export const ZERO_WIDTH_SPACE = '\u200B';         // Used for "1" bit
export const ZERO_WIDTH_NON_JOINER = '\u200C';    // Used for "0" bit

/**
 * Encode a number into zero-width characters
 * @param num The number to encode
 * @returns A string of zero-width characters representing the number
 */
export function encodeNumberToZeroWidth(num: number): string {
    const binary = num.toString(2);
    return binary.split("").map(bit => bit === "1" ? ZERO_WIDTH_SPACE : ZERO_WIDTH_NON_JOINER).join("");
}

/**
 * Decode a string of zero-width characters back into a number
 * @param encoded The encoded string of zero-width characters
 * @returns The decoded number
 */
export function decodeNumberFromZeroWidth(encoded: string): number {
    const binary = encoded.split("").map(char => char === ZERO_WIDTH_SPACE ? "1" : "0").join("");
    return parseInt(binary, 2);
}

/**
 * Encodes a timestamp (like Slack's ts) into a zero-width representation
 * @param ts The timestamp string (e.g. "1647531461.000100")
 * @returns A string of zero-width characters representing the timestamp
 */
export function encodeTimestampToZeroWidth(ts: string): string {
    // Remove the period and convert to a number
    const tsAsNumber = parseInt(ts.replace('.', ''), 10);
    return encodeNumberToZeroWidth(tsAsNumber);
}
