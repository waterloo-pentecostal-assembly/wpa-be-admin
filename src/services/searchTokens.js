// Search tokens: precomputed prefixes the app searches with (Firestore has no
// case-insensitive or substring queries). The app queries
// `search_tokens array-contains <word>` on users and challenge_groups, and
// never writes the field itself.
//
// Must stay identical to the app's searchTokens() in
// lib/domain/common/search.dart (wpa-be-app) and to the backend triggers in
// wpa-be-firebase (functions-v2/src/search.js); see
// specs/search-tokens-functions.md. Don't "improve" it: no Unicode
// normalization or trimming, lengths in UTF-16 code units, default sort.

export const SEARCH_TOKENS_FIELD = 'search_tokens';
const MIN_TOKEN_LENGTH = 2;
const MAX_TOKEN_LENGTH = 15;
const NON_WORD_CHARS = /[^\p{L}\p{N}]+/u;

const asText = (value) => (typeof value === 'string' ? value : '');

/** Every 2- to 15-character prefix of each word in `text`, deduplicated and sorted. */
export const searchTokens = (text) => {
    const tokens = new Set();
    const words = asText(text).toLowerCase().split(NON_WORD_CHARS);
    for (const word of words) {
        const max = Math.min(word.length, MAX_TOKEN_LENGTH);
        for (let n = MIN_TOKEN_LENGTH; n <= max; n++) {
            tokens.add(word.slice(0, n));
        }
    }
    return [...tokens].sort();
};

/**
 * A search query's words, as the app looks them up: split and lower-cased
 * like the tokenizer, one-letter words dropped, longer words cut to 15
 * characters (the longest token), duplicates removed.
 */
export const searchQueryWords = (query) => [...new Set(asText(query).toLowerCase().split(NON_WORD_CHARS)
    .filter((word) => word.length >= MIN_TOKEN_LENGTH)
    .map((word) => word.slice(0, MAX_TOKEN_LENGTH)))];

export const userSearchText = (data = {}) => `${asText(data.first_name)} ${asText(data.last_name)}`;

export const groupSearchText = (data = {}) => `${asText(data.name)} ${asText(data.description)}`;

export const sameTokens = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((t, i) => t === b[i]);

/** The tokens to write, or null when nothing needs writing (deleted, or already correct). */
export const tokensUpdate = (data, toText) => {
    if (!data) return null;
    const tokens = searchTokens(toText(data));
    return sameTokens(tokens, data[SEARCH_TOKENS_FIELD]) ? null : tokens;
};

/** The collections with search tokens, the fields their text comes from, and how it's built. */
export const SEARCHABLE_COLLECTIONS = {
    users: { fields: ['first_name', 'last_name'], toText: userSearchText },
    challenge_groups: { fields: ['name', 'description'], toText: groupSearchText },
};
