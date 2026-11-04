import express from 'express';
import { BibleServiceError } from '../services/bibleService.js';

// Bible text is static for the life of the process, so responses can be
// cached by the browser instead of refetched on every picker open.
const CACHE_CONTROL = 'public, max-age=86400';

/**
 * Builds the NIV Bible router. Mount it at `/api/bible/niv`, giving:
 *
 * - GET /books                                    -> all books
 * - GET /books/:book/chapters                     -> chapters for a book
 * - GET /books/:book/chapters/:chapter/verses     -> verses for a chapter
 * - GET /passage?ref=Romans%204%3A1-6             -> verses for a typed reference
 *
 * @param {import('../services/bibleService.js').BibleService|null} bibleService
 *   When null (niv.json unavailable), every endpoint returns 503.
 * @returns {import('express').Router}
 */
export function createBibleRouter(bibleService) {
    const router = express.Router();

    function handle(handler) {
        return (req, res) => {
            if (!bibleService) {
                return res.status(503).json({ error: 'NIV Bible data not available' });
            }
            try {
                res.set('Cache-Control', CACHE_CONTROL);
                return res.json(handler(req));
            } catch (error) {
                if (error instanceof BibleServiceError) {
                    return res.status(error.status).json({ error: error.message });
                }
                console.error('Error in Bible API:', error);
                return res.status(500).json({ error: error.message });
            }
        };
    }

    // Get all books
    router.get('/books', handle(() => bibleService.getBooks()));

    // Get chapters for a book
    router.get('/books/:book/chapters', handle((req) => bibleService.getChapters(req.params.book)));

    // Get verses for a book chapter
    router.get(
        '/books/:book/chapters/:chapter/verses',
        handle((req) => bibleService.getVerses(req.params.book, req.params.chapter)),
    );

    // Get verses for a free-text reference, e.g. ?ref=Romans 4:1-6
    router.get('/passage', handle((req) => bibleService.getPassage(req.query.ref)));

    return router;
}
