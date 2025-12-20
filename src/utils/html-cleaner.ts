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

    let decoded = text;

    // First pass: Decode &amp; to & (this handles double-encoded entities like &amp;apos;)
    decoded = decoded.replace(/&amp;/g, '&');

    // Second pass: Decode other named entities (now &amp;apos; has become &apos; and will be decoded to ')
    const entities: [RegExp, string][] = [
        [/&lt;/g, '<'],
        [/&gt;/g, '>'],
        [/&quot;/g, '"'],
        [/&apos;/g, "'"],
        [/&#39;/g, "'"],
        [/&#x27;/gi, "'"],
        [/&nbsp;/g, ' '],
    ];

    for (const [pattern, char] of entities) {
        decoded = decoded.replace(pattern, char);
    }

    // Third pass: Replace numeric HTML entities (&#xxx; and &#xHH;)
    // Add bounds checking to ensure character codes are within valid Unicode range
    decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
        const code = parseInt(dec, 10);
        // Valid Unicode range is 0x0 to 0x10FFFF
        if (code >= 0 && code <= 0x10FFFF) {
            return String.fromCharCode(code);
        }
        return match; // Return original if out of range
    });
    decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/gi, (match, hex) => {
        const code = parseInt(hex, 16);
        // Valid Unicode range is 0x0 to 0x10FFFF
        if (code >= 0 && code <= 0x10FFFF) {
            return String.fromCharCode(code);
        }
        return match; // Return original if out of range
    });

    return decoded;
}

/**
 * Removes HTML tags from a string.
 * This is a simple regex-based approach suitable for cleaning XBRL text blocks.
 * 
 * IMPORTANT: This function is for EXTRACTING text content from HTML, not for sanitizing
 * untrusted input for HTML rendering. The output is plain text and should not be
 * rendered as HTML. For HTML sanitization, use a dedicated library like DOMPurify.
 * 
 * @param text - Text containing HTML tags
 * @returns Text with HTML tags removed
 */
export function stripHtmlTags(text: string): string {
    if (!text) return text;

    // Remove HTML tags
    // This regex matches opening tags, closing tags, and self-closing tags
    // Note: This is safe for text extraction, but NOT for HTML sanitization
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
