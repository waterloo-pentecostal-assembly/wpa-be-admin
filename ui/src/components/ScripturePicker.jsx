import React, { useState, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { fetchBibleBooks, fetchBibleChapters, fetchBibleVerses } from '../api/bibleApi';
import {
    chapterLabel, chapterSelection, countVerses, countsByBook, removeChapter, selectionFromScriptures,
    selectionToScriptures, updateChapter,
} from '../series/scriptureSelection';

/**
 * Picks verses from any number of books and chapters (e.g. Ezra 4:2-6 and
 * Genesis 1:1-4): moving to another book or chapter keeps what is already
 * selected. `onSelect` receives output-format scriptures
 * ([{ book, chapter, title, verses }], see selectionToScriptures);
 * `initialSelection` takes the same shape (or a single object).
 * Section headings from the translation are shown between verses for
 * orientation; they can't be selected and aren't part of the result.
 */
const ScripturePicker = ({ onSelect, onCancel, initialSelection, bibleId = 'default' }) => {
    const [selection, setSelection] = useState(() => selectionFromScriptures(initialSelection));
    // The chapter being viewed; starts on the first selected one.
    const [viewBook, setViewBook] = useState(() => selection[0]?.book ?? null);
    const [viewChapter, setViewChapter] = useState(() => selection[0]?.chapter ?? null);
    const [lastClickedVerse, setLastClickedVerse] = useState(null);

    // Bible data loaded on demand from the Bible API (API.Bible, in the
    // series' translation): books on open, then chapters for the viewed book
    // and verses for the viewed chapter. Fetched chapters/verses are stored
    // with the book/chapter they belong to, so the visible lists (and their
    // loading states) can be derived from what is viewed instead of being
    // reset inside effects.
    const [books, setBooks] = useState([]); // [{ name, chapterCount }]
    const [loadingBooks, setLoadingBooks] = useState(true);
    const [chaptersData, setChaptersData] = useState(null); // { book, chapters: [{ chapter, verseCount }] }
    const [versesData, setVersesData] = useState(null); // { book, chapter, verses: [{ verse, text }], headings: [{ verse, text }] }
    const [loadError, setLoadError] = useState(null);

    const chapters = chaptersData?.book === viewBook ? chaptersData.chapters : [];
    const loadingChapters = !!viewBook && chaptersData?.book !== viewBook;
    const versesLoaded = versesData?.book === viewBook && versesData?.chapter === viewChapter;
    const chapterVerses = versesLoaded ? versesData.verses : [];
    // Headings by the verse they come before (display only).
    const headingsBefore = new Map();
    for (const { verse, text } of versesLoaded ? versesData.headings : []) {
        if (!headingsBefore.has(String(verse))) headingsBefore.set(String(verse), []);
        headingsBefore.get(String(verse)).push(text);
    }
    const loadingVerses = !!viewBook && viewChapter != null && !versesLoaded;

    const viewedSelection = viewBook && viewChapter != null ? chapterSelection(selection, viewBook, viewChapter) : {};
    const isSelected = (verse) => Object.hasOwn(viewedSelection, String(verse));
    const bookCounts = countsByBook(selection);
    const selectedCount = countVerses(selection);

    useEffect(() => {
        let ignore = false;
        fetchBibleBooks(bibleId)
            .then((data) => {
                if (!ignore) setBooks(data.books);
            })
            .catch((err) => {
                if (!ignore) setLoadError(err.message);
            })
            .finally(() => {
                if (!ignore) setLoadingBooks(false);
            });
        return () => { ignore = true; };
    }, [bibleId]);

    useEffect(() => {
        if (!viewBook) return;
        let ignore = false;
        fetchBibleChapters(viewBook, bibleId)
            .then((data) => {
                if (!ignore) setChaptersData({ book: viewBook, chapters: data.chapters });
            })
            .catch((err) => {
                if (!ignore) {
                    setChaptersData({ book: viewBook, chapters: [] });
                    setLoadError(err.message);
                }
            });
        return () => { ignore = true; };
    }, [viewBook, bibleId]);

    useEffect(() => {
        if (!viewBook || viewChapter == null) return;
        let ignore = false;
        fetchBibleVerses(viewBook, viewChapter, bibleId)
            .then((data) => {
                if (!ignore) setVersesData({ book: viewBook, chapter: viewChapter, verses: data.verses, headings: data.headings ?? [] });
            })
            .catch((err) => {
                if (!ignore) {
                    setVersesData({ book: viewBook, chapter: viewChapter, verses: [], headings: [] });
                    setLoadError(err.message);
                }
            });
        return () => { ignore = true; };
    }, [viewBook, viewChapter, bibleId]);

    const view = (book, chapter) => {
        setLoadError(null);
        setViewBook(book);
        setViewChapter(chapter);
        setLastClickedVerse(null);
    };

    const handleBookSelect = (book) => {
        if (viewBook !== book) view(book, null);
    };

    const handleChapterSelect = (ch) => {
        if (viewChapter !== ch) view(viewBook, ch);
    };

    const changeViewed = (changes) => setSelection((s) => updateChapter(s, viewBook, viewChapter, changes));

    const handleVerseClick = (vNum, text, e) => {
        if (e.shiftKey && lastClickedVerse !== null) {
            const start = Math.min(lastClickedVerse, vNum);
            const end = Math.max(lastClickedVerse, vNum);
            const changes = {};
            for (const { verse, text: verseText } of chapterVerses) {
                if (verse >= start && verse <= end) changes[String(verse)] = verseText;
            }
            changeViewed(changes);
        } else {
            changeViewed({ [String(vNum)]: isSelected(vNum) ? null : text });
            setLastClickedVerse(vNum);
        }
    };

    const allVersesSelected = chapterVerses.length > 0
        && chapterVerses.every(({ verse }) => isSelected(verse));

    const toggleSelectAll = () => {
        if (!viewBook || viewChapter == null || chapterVerses.length === 0) return;
        const changes = {};
        for (const { verse, text } of chapterVerses) changes[String(verse)] = allVersesSelected ? null : text;
        changeViewed(changes);
    };

    const handleConfirm = () => {
        if (selectedCount === 0) return;
        onSelect(selectionToScriptures(selection));
    };

    // Chapters of the viewed book that have selected verses.
    const chapterCounts = new Map(selection.filter((item) => item.book === viewBook).map((item) => [item.chapter, Object.keys(item.verses).length]));

    return (
        <div className="modal-backdrop z-[60] sm:p-8">
            <div className="modal-panel max-w-5xl h-[80vh]">
                <div className="modal-header">
                    <div className="shrink-0">
                        <p className="eyebrow">Scripture</p>
                        <h3 className="text-lg font-bold text-ink whitespace-nowrap">Select Scripture</h3>
                    </div>

                    <div className="flex gap-2 shrink-0 ml-auto">
                        <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
                        <button
                            onClick={handleConfirm}
                            disabled={selectedCount === 0}
                            className="btn btn-primary"
                        >
                            Confirm Selection
                            {selectedCount > 0 && (
                                <span className="rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{selectedCount}</span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Everything selected so far, across books and chapters */}
                <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-6 py-2">
                    <span className="section-label mr-1">Selected</span>
                    {selection.length === 0 ? (
                        <span className="text-xs text-gray-400">Nothing yet. Pick verses from as many books and chapters as you need.</span>
                    ) : (
                        selectionToScriptures(selection).map((s) => {
                            const item = { book: s.book, chapter: Number(s.chapter), verses: s.verses };
                            const viewing = item.book === viewBook && item.chapter === viewChapter;
                            const label = chapterLabel(item);
                            return (
                                <span
                                    key={`${item.book}|${item.chapter}`}
                                    className={`inline-flex items-center rounded-full border text-xs font-medium ${viewing ? 'border-brand bg-brand text-white' : 'border-brand-200 bg-white text-brand-700'}`}
                                >
                                    <button type="button" onClick={() => view(item.book, item.chapter)} className="py-1 pl-2.5 pr-1" title={`Show ${label}`}>
                                        {label}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelection((sel) => removeChapter(sel, item.book, item.chapter))}
                                        className={`mr-1 rounded-full p-0.5 ${viewing ? 'hover:bg-white/20' : 'hover:bg-brand-50'}`}
                                        aria-label={`Remove ${label}`}
                                        title={`Remove ${label}`}
                                    >
                                        <X size={12} />
                                    </button>
                                </span>
                            );
                        })
                    )}
                    {selection.length > 1 && (
                        <button type="button" onClick={() => setSelection([])} className="btn btn-ghost btn-sm ml-auto">Clear all</button>
                    )}
                </div>

                {loadError && (
                    <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
                        Failed to load Bible data: {loadError}
                    </div>
                )}

                <div className="flex-1 overflow-hidden flex divide-x divide-gray-200">
                    {/* Books */}
                    <div className="w-1/4 overflow-y-auto p-3">
                        <h4 className="section-label mb-2 px-2">Book</h4>
                        {loadingBooks && <div className="px-3 py-2 text-sm text-gray-400">Loading books...</div>}
                        {books.map(({ name }) => (
                            <div
                                key={name}
                                onClick={() => handleBookSelect(name)}
                                className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${viewBook === name ? 'bg-brand text-white font-semibold' : 'text-gray-700 hover:bg-gray-100'}`}
                            >
                                <span>{name}</span>
                                {bookCounts[name] > 0 && (
                                    <span
                                        className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${viewBook === name ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}
                                        title={`${bookCounts[name]} selected`}
                                    >
                                        {bookCounts[name]}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Chapters */}
                    <div className="w-24 overflow-y-auto p-3 bg-gray-50">
                        <h4 className="section-label mb-2 text-center">Ch</h4>
                        {loadingChapters && <div className="py-2 text-sm text-gray-400 text-center">Loading...</div>}
                        {chapters.map(({ chapter }) => (
                            <div
                                key={chapter}
                                onClick={() => handleChapterSelect(chapter)}
                                title={chapterCounts.has(chapter) ? `${chapterCounts.get(chapter)} selected` : undefined}
                                className={`relative px-3 py-1.5 rounded-lg cursor-pointer text-sm text-center tabular-nums transition-colors ${viewChapter === chapter ? 'bg-brand text-white font-semibold' : chapterCounts.has(chapter) ? 'bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100' : 'text-gray-700 hover:bg-gray-200'}`}
                            >
                                {chapter}
                                {chapterCounts.has(chapter) && (
                                    <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${viewChapter === chapter ? 'bg-white' : 'bg-brand'}`} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Verses */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="flex justify-between items-center mb-2 px-1">
                            <h4 className="section-label">
                                {viewBook && viewChapter != null ? `${viewBook} ${viewChapter}` : 'Verses'}
                            </h4>
                            {viewBook && viewChapter != null && chapterVerses.length > 0 && (
                                <button
                                    onClick={toggleSelectAll}
                                    className="btn btn-ghost-brand btn-sm"
                                >
                                    {allVersesSelected ? 'Deselect All' : 'Select All'}
                                </button>
                            )}
                        </div>
                        {loadingVerses ? (
                            <div className="text-gray-400 text-sm text-center mt-10">Loading verses...</div>
                        ) : viewBook && viewChapter != null ? (
                            <div className="grid grid-cols-1 gap-1">
                                {chapterVerses.map(({ verse, text }) => (
                                    <React.Fragment key={verse}>
                                        {headingsBefore.get(String(verse))?.map((heading, i) => (
                                            <h5 key={`h${i}`} className="px-2 pt-3 pb-0.5 text-sm font-semibold text-gray-500 select-none">{heading}</h5>
                                        ))}
                                        <div
                                            onClick={(e) => handleVerseClick(verse, text, e)}
                                            className={`p-2 rounded-lg border cursor-pointer text-sm flex gap-3 select-none transition-colors ${isSelected(verse) ? 'bg-brand-50 border-brand-200' : 'border-transparent hover:bg-gray-50 hover:border-gray-200'}`}
                                        >
                                            <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-full border ${isSelected(verse) ? 'bg-brand border-brand text-white' : 'border-gray-300 text-gray-400'}`}>
                                                {isSelected(verse) ? <Check size={14} /> : <span className="text-xs tabular-nums">{verse}</span>}
                                            </div>
                                            <p className="text-gray-800 leading-relaxed">{text}</p>
                                        </div>
                                    </React.Fragment>
                                ))}
                            </div>
                        ) : (
                            <div className="text-gray-400 text-sm text-center mt-10">Select a book and chapter to view verses</div>
                        )}
                    </div>
                </div>
                <div className="px-6 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
                    Tip: hold <kbd className="rounded border border-gray-300 bg-white px-1 font-sans">Shift</kbd> and click to select a range of verses. Switching book or chapter keeps your selection, so you can combine passages.
                </div>
            </div>
        </div>
    );
};

export default ScripturePicker;
