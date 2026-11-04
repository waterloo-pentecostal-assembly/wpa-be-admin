import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { fetchBibleBooks, fetchBibleChapters, fetchBibleVerses } from '../api/bibleApi';

const ScripturePicker = ({ onSelect, onCancel, initialSelection }) => {
    // Initialize state from initialSelection if provided
    const [selectedBook, setSelectedBook] = useState(initialSelection?.book || null);
    const [selectedChapter, setSelectedChapter] = useState(
        initialSelection?.chapter != null ? Number(initialSelection.chapter) : null
    );
    const [selectedVerses, setSelectedVerses] = useState(initialSelection?.verses || {}); // { verseNum: text }
    const [title, setTitle] = useState(initialSelection?.title || '');
    const [lastClickedVerse, setLastClickedVerse] = useState(null);

    // Bible data loaded on demand from the NIV Bible API: books on open,
    // then chapters for the selected book and verses for the chapter.
    // Fetched chapters/verses are stored with the selection they belong to,
    // so the visible lists (and their loading states) can be derived from
    // the current selection instead of being reset inside effects.
    const [books, setBooks] = useState([]); // [{ name, chapterCount }]
    const [loadingBooks, setLoadingBooks] = useState(true);
    const [chaptersData, setChaptersData] = useState(null); // { book, chapters: [{ chapter, verseCount }] }
    const [versesData, setVersesData] = useState(null); // { book, chapter, verses: [{ verse, text }] }
    const [loadError, setLoadError] = useState(null);

    const chapters = chaptersData?.book === selectedBook ? chaptersData.chapters : [];
    const loadingChapters = !!selectedBook && chaptersData?.book !== selectedBook;
    const versesLoaded = versesData?.book === selectedBook && versesData?.chapter === selectedChapter;
    const chapterVerses = versesLoaded ? versesData.verses : [];
    const loadingVerses = !!selectedBook && selectedChapter != null && !versesLoaded;

    // Initial state set via useState above.
    // Since component remounts on open, we don't need to listen for prop changes.

    useEffect(() => {
        let ignore = false;
        fetchBibleBooks()
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
    }, []);

    useEffect(() => {
        if (!selectedBook) return;
        let ignore = false;
        fetchBibleChapters(selectedBook)
            .then((data) => {
                if (!ignore) setChaptersData({ book: selectedBook, chapters: data.chapters });
            })
            .catch((err) => {
                if (!ignore) {
                    setChaptersData({ book: selectedBook, chapters: [] });
                    setLoadError(err.message);
                }
            });
        return () => { ignore = true; };
    }, [selectedBook]);

    useEffect(() => {
        if (!selectedBook || selectedChapter == null) return;
        let ignore = false;
        fetchBibleVerses(selectedBook, selectedChapter)
            .then((data) => {
                if (!ignore) setVersesData({ book: selectedBook, chapter: selectedChapter, verses: data.verses });
            })
            .catch((err) => {
                if (!ignore) {
                    setVersesData({ book: selectedBook, chapter: selectedChapter, verses: [] });
                    setLoadError(err.message);
                }
            });
        return () => { ignore = true; };
    }, [selectedBook, selectedChapter]);

    const handleBookSelect = (book) => {
        if (selectedBook === book) return;
        setLoadError(null);
        setSelectedBook(book);
        setSelectedChapter(null);
        setSelectedVerses({});
        setLastClickedVerse(null);
    };

    const handleChapterSelect = (ch) => {
        if (selectedChapter === ch) return;
        setLoadError(null);
        setSelectedChapter(ch);
        setSelectedVerses({});
        setLastClickedVerse(null);
    };

    const handleVerseClick = (vNum, text, e) => {
        if (e.shiftKey && lastClickedVerse !== null) {
            const start = Math.min(lastClickedVerse, vNum);
            const end = Math.max(lastClickedVerse, vNum);

            const newVerses = { ...selectedVerses };

            // Add all verses in range
            chapterVerses.forEach(({ verse, text: verseText }) => {
                if (verse >= start && verse <= end) {
                    newVerses[String(verse)] = verseText;
                }
            });
            setSelectedVerses(newVerses);
        } else {
            toggleVerse(vNum, text);
            setLastClickedVerse(vNum);
        }
    };

    const toggleVerse = (verseNum, text) => {
        const key = String(verseNum);
        const newVerses = { ...selectedVerses };
        if (newVerses[key]) {
            delete newVerses[key];
        } else {
            newVerses[key] = text;
        }
        setSelectedVerses(newVerses);
    };

    const handleConfirm = () => {
        if (!selectedBook || selectedChapter == null || Object.keys(selectedVerses).length === 0) return;

        // Sort verses numerically
        const sortedVerseKeys = Object.keys(selectedVerses).sort((a, b) => parseInt(a) - parseInt(b));
        const sortedVerses = {};
        sortedVerseKeys.forEach(k => sortedVerses[k] = selectedVerses[k]);

        onSelect({
            book: selectedBook,
            chapter: String(selectedChapter),
            title: title,
            verses: sortedVerses
        });
    };

    const allVersesSelected = chapterVerses.length > 0
        && chapterVerses.every(({ verse }) => selectedVerses[String(verse)]);

    const toggleSelectAll = () => {
        if (!selectedBook || selectedChapter == null || chapterVerses.length === 0) return;

        if (allVersesSelected) {
            setSelectedVerses({});
        } else {
            const allVerses = {};
            chapterVerses.forEach(({ verse, text }) => { allVerses[String(verse)] = text; });
            setSelectedVerses(allVerses);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-8">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl h-[80vh] flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl gap-4">
                    <h3 className="font-bold text-lg whitespace-nowrap">Select Scripture</h3>

                    <input
                        type="text"
                        placeholder="Title (Optional, e.g. 'The Parable of the Sower')"
                        className="flex-1 p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />

                    <div className="space-x-2 flex-shrink-0">
                        <button onClick={onCancel} className="px-3 py-1 text-gray-600 hover:bg-gray-200 rounded">Cancel</button>
                        <button
                            onClick={handleConfirm}
                            disabled={Object.keys(selectedVerses).length === 0}
                            className="px-4 py-1 bg-brand text-white rounded hover:bg-brand-600 disabled:opacity-50"
                        >
                            Confirm Selection
                        </button>
                    </div>
                </div>

                {loadError && (
                    <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
                        Failed to load Bible data: {loadError}
                    </div>
                )}

                <div className="flex-1 overflow-hidden flex divide-x divide-gray-200">
                    {/* Books */}
                    <div className="w-1/4 overflow-y-auto p-2">
                        <h4 className="font-semibold text-xs text-gray-500 uppercase mb-2 px-2">Book</h4>
                        {loadingBooks && <div className="px-3 py-2 text-sm text-gray-400">Loading books...</div>}
                        {books.map(({ name }) => (
                            <div
                                key={name}
                                onClick={() => handleBookSelect(name)}
                                className={`px-3 py-2 rounded cursor-pointer text-sm ${selectedBook === name ? 'bg-brand-100 text-brand font-medium' : 'hover:bg-gray-50'}`}
                            >
                                {name}
                            </div>
                        ))}
                    </div>

                    {/* Chapters */}
                    <div className="w-24 overflow-y-auto p-2 bg-gray-50/50">
                        <h4 className="font-semibold text-xs text-gray-500 uppercase mb-2 px-2">Ch</h4>
                        {loadingChapters && <div className="px-3 py-2 text-sm text-gray-400">Loading...</div>}
                        {chapters.map(({ chapter }) => (
                            <div
                                key={chapter}
                                onClick={() => handleChapterSelect(chapter)}
                                className={`px-3 py-2 rounded cursor-pointer text-sm text-center ${selectedChapter === chapter ? 'bg-brand-100 text-brand font-medium' : 'hover:bg-gray-100'}`}
                            >
                                {chapter}
                            </div>
                        ))}
                    </div>

                    {/* Verses */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-semibold text-xs text-gray-500 uppercase">Verses</h4>
                            {selectedBook && selectedChapter != null && chapterVerses.length > 0 && (
                                <button
                                    onClick={toggleSelectAll}
                                    className="text-xs text-brand hover:underline font-medium"
                                >
                                    {allVersesSelected ? 'Deselect All' : 'Select All'}
                                </button>
                            )}
                        </div>
                        {loadingVerses ? (
                            <div className="text-gray-400 text-center mt-10">Loading verses...</div>
                        ) : selectedBook && selectedChapter != null ? (
                            <div className="grid grid-cols-1 gap-1">
                                {chapterVerses.map(({ verse, text }) => (
                                    <div
                                        key={verse}
                                        onClick={(e) => handleVerseClick(verse, text, e)}
                                        className={`p-2 rounded border cursor-pointer text-sm flex space-x-3 hover:border-brand-300 ${selectedVerses[String(verse)] ? 'bg-brand-50 border-brand-200' : 'border-transparent'}`}
                                    >
                                        <div className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full border ${selectedVerses[String(verse)] ? 'bg-brand border-brand text-white' : 'border-gray-300 text-gray-400'}`}>
                                            {selectedVerses[String(verse)] ? <Check size={14} /> : <span className="text-xs">{verse}</span>}
                                        </div>
                                        <p className="text-gray-800 leading-relaxed">{text}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-gray-400 text-center mt-10">Select a book and chapter to view verses</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScripturePicker;
