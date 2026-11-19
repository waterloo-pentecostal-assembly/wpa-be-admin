// A stand-in for ApiBibleClient that serves in-memory Bible data
// ({ [book]: { [chapter]: { [verse]: text } } }, e.g. niv.json) with the
// same interface, so ApiBibleService and everything above it run as they do
// against the Bible proxy, without network or credentials. `auths` records
// the credentials each `withAuth` copy was made with.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKS } from '../../src/services/bibleCanon.js';
import { ApiBibleError } from '../../src/services/apiBibleClient.js';
import { ApiBibleService } from '../../src/services/apiBibleService.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NIV_FILE = path.join(ROOT, 'src', 'data', 'niv.json');

// Name and copyright chosen so compiled blocks carry the same bible_version
// and attribution lines as the NIV series in src/data/bible_series.
export const TEST_BIBLE = {
    id: 'test-niv',
    abbreviation: 'NIV',
    name: 'The Holy Bible, New International Version® NIV®',
    language: 'English',
    copyright: 'Copyright © 1973 1978 1984 2011 by Biblica, Inc. TM\nUsed by permission. All rights reserved worldwide',
};

let nivData = null;
export function loadNiv() {
    nivData ??= JSON.parse(fs.readFileSync(NIV_FILE, 'utf8'));
    return nivData;
}

export class FakeApiBibleClient {
    /**
     * @param {Record<string, object>} bibles - bibleId -> { info, data }
     */
    constructor(bibles) {
        this.bibles = bibles;
        this.requestCount = 0;
        this.chapterRequests = [];
        this.auths = [];
    }

    withAuth(auth) {
        this.auths.push(auth);
        return this;
    }

    clearCache() {}

    #bible(bibleId) {
        const bible = this.bibles[bibleId];
        if (!bible) throw new ApiBibleError(`Not found in API.Bible (bible ${bibleId})`, 404, 404);
        return bible;
    }

    async listBibles({ ids = null } = {}) {
        this.requestCount++;
        return Object.values(this.bibles)
            .map((b) => b.info)
            .filter((info) => !ids?.length || ids.includes(info.id))
            .map(({ id, abbreviation, name, language }) => ({ id, abbreviation, name, language, description: '' }));
    }

    async getBible(bibleId) {
        this.requestCount++;
        return { ...this.#bible(bibleId).info };
    }

    async getBooks(bibleId) {
        this.requestCount++;
        const { data } = this.#bible(bibleId);
        return BOOKS.filter((b) => data[b.name]).map((b) => ({
            id: b.id,
            name: b.name,
            chapters: Object.keys(data[b.name]).map(Number).sort((x, y) => x - y),
        }));
    }

    async getChapter(bibleId, chapterId) {
        this.requestCount++;
        this.chapterRequests.push(chapterId);
        const { data, info } = this.#bible(bibleId);
        const [bookId, chapter] = chapterId.split('.');
        const book = BOOKS.find((b) => b.id === bookId);
        const verses = book && data[book.name]?.[chapter];
        if (!verses) throw new ApiBibleError(`Not found in API.Bible (chapter ${chapterId})`, 404, 404);
        return { id: chapterId, reference: `${book.name} ${chapter}`, copyright: info.copyright, verses: { ...verses } };
    }
}

/**
 * ApiBibleService over the bundled niv.json (as TEST_BIBLE, the default),
 * plus any extra translations given as { [id]: { info, data } }.
 */
export function createTestBible({ extra = {}, allowedBibleIds = [] } = {}) {
    const client = new FakeApiBibleClient({ [TEST_BIBLE.id]: { info: TEST_BIBLE, data: loadNiv() }, ...extra });
    const service = new ApiBibleService(client, { defaultBibleId: TEST_BIBLE.id, allowedBibleIds });
    return { service, client };
}
