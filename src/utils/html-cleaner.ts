/**
 * HTML entity decoding and tag stripping utilities for EDINET XBRL data.
 * 
 * EDINET XBRL files contain text blocks with escaped HTML entities (e.g., &lt;p&gt;, &amp;apos;).
 * This module provides functions to decode these entities and strip HTML tags to produce clean text.
 */

/**
 * Decodes HTML entities in a string.
 * Supports common HTML entities like &lt;, &gt;, &amp;, &quot;, &apos;, and numeric entities.
 * 
 * @param text - Text containing HTML entities
 * @returns Text with HTML entities decoded
 */
export function decodeHtmlEntities(text: string): string {
    if (!text) return text;

    // Map of common HTML entities to their characters
    const entities: Record<string, string> = {
        '&lt;': '<',
        '&gt;': '>',
        '&amp;': '&',
        '&quot;': '"',
        '&apos;': "'",
        '&#39;': "'",
        '&#x27;': "'",
        '&nbsp;': ' ',
    };

    // Replace named entities
    let decoded = text;
    for (const [entity, char] of Object.entries(entities)) {
        decoded = decoded.replace(new RegExp(entity, 'g'), char);
    }

    // Replace numeric HTML entities (&#xxx; and &#xHH;)
    decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
        return String.fromCharCode(parseInt(dec, 10));
    });
    decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });

    return decoded;
}

/**
 * Removes HTML tags from a string.
 * This is a simple regex-based approach suitable for cleaning XBRL text blocks.
 * 
 * @param text - Text containing HTML tags
 * @returns Text with HTML tags removed
 */
export function stripHtmlTags(text: string): string {
    if (!text) return text;

    // Remove HTML tags
    // This regex matches opening tags, closing tags, and self-closing tags
    let cleaned = text.replace(/<[^>]*>/g, '');

    // Clean up multiple consecutive spaces
    cleaned = cleaned.replace(/  +/g, ' ');

    // Clean up multiple consecutive newlines (keeping at most 2 consecutive newlines)
    cleaned = cleaned.replace(/\n\n\n+/g, '\n\n');

    // Trim whitespace from each line
    cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');

    // Trim leading and trailing whitespace from the entire text
    cleaned = cleaned.trim();

    return cleaned;
}

/**
 * Decodes HTML entities and removes HTML tags from text.
 * This is the main function to clean EDINET XBRL text blocks.
 * 
 * @param text - Text with HTML entities and tags
 * @returns Clean text without HTML entities or tags
 */
export function cleanHtml(text: string | undefined): string | undefined {
    if (!text) return text;

    // First decode HTML entities, then strip tags
    const decoded = decodeHtmlEntities(text);
    const cleaned = stripHtmlTags(decoded);

    return cleaned;
}
