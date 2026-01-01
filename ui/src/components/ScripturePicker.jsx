import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';

const ScripturePicker = ({ nivData, onSelect, onCancel, initialSelection }) => {
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedChapter, setSelectedChapter] = useState(null);
    const [selectedVerses, setSelectedVerses] = useState({}); // { verseNum: text }
    const [title, setTitle] = useState('');

    // Initialize state from initialSelection if provided
    useEffect(() => {
        if (initialSelection && nivData) {
            setSelectedBook(initialSelection.book);
            setSelectedChapter(initialSelection.chapter);
            setSelectedVerses(initialSelection.verses || {});
            setTitle(initialSelection.title || '');
        } else if (!initialSelection) {
            // Reset if opening fresh
            setSelectedBook(null);
            setSelectedChapter(null);
            setSelectedVerses({});
            setTitle('');
        }
    }, [initialSelection, nivData]);

    // Reset downstream selections when upstream changes
    // We only reset if the change didn't come from the initialization
    useEffect(() => {
        if (initialSelection && selectedBook === initialSelection.book) {
            // Book matches initial, preserve chapter unless user explicitly changed it?
            // If user changes book, selectedBook !== initialSelection.book (unless they pick the same one).
            return;
        }
        setSelectedChapter(null);
        setSelectedVerses({});
    }, [selectedBook]);

    useEffect(() => {
        if (initialSelection && selectedChapter === initialSelection.chapter && selectedBook === initialSelection.book) {
            return;
        }
        setSelectedVerses({});
    }, [selectedChapter]);

    const [lastClickedVerse, setLastClickedVerse] = useState(null);

    // Reset last clicked when chapter changes
    useEffect(() => {
        setLastClickedVerse(null);
    }, [selectedChapter]);

    const books = nivData ? Object.keys(nivData) : [];
    const chapters = selectedBook && nivData ? Object.keys(nivData[selectedBook]) : [];
    const verses = selectedBook && selectedChapter && nivData ? nivData[selectedBook][selectedChapter] : {};

    const handleVerseClick = (vNum, text, e) => {
        if (e.shiftKey && lastClickedVerse !== null) {
            const start = Math.min(lastClickedVerse, parseInt(vNum));
            const end = Math.max(lastClickedVerse, parseInt(vNum));

            const newVerses = { ...selectedVerses };

            // Add all verses in range
            Object.entries(verses).forEach(([key, val]) => {
                const kInt = parseInt(key);
                if (kInt >= start && kInt <= end) {
                    newVerses[key] = val;
                }
            });
            setSelectedVerses(newVerses);
        } else {
            toggleVerse(vNum, text);
            setLastClickedVerse(parseInt(vNum));
        }
    };

    const toggleVerse = (verseNum, text) => {
        const newVerses = { ...selectedVerses };
        if (newVerses[verseNum]) {
            delete newVerses[verseNum];
        } else {
            newVerses[verseNum] = text;
        }
        setSelectedVerses(newVerses);
    };

    const handleConfirm = () => {
        if (!selectedBook || !selectedChapter || Object.keys(selectedVerses).length === 0) return;

        // Sort verses numerically
        const sortedVerseKeys = Object.keys(selectedVerses).sort((a, b) => parseInt(a) - parseInt(b));
        const sortedVerses = {};
        sortedVerseKeys.forEach(k => sortedVerses[k] = selectedVerses[k]);

        onSelect({
            book: selectedBook,
            chapter: selectedChapter,
            title: title,
            verses: sortedVerses
        });
    };

    const toggleSelectAll = () => {
        if (!selectedBook || !selectedChapter || !verses) return;

        const allVerseNums = Object.keys(verses);
        const allSelected = allVerseNums.every(v => selectedVerses[v]);

        if (allSelected) {
            setSelectedVerses({});
        } else {
            setSelectedVerses(verses);
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

                <div className="flex-1 overflow-hidden flex divide-x divide-gray-200">
                    {/* Books */}
                    <div className="w-1/4 overflow-y-auto p-2">
                        <h4 className="font-semibold text-xs text-gray-500 uppercase mb-2 px-2">Book</h4>
                        {books.map(book => (
                            <div
                                key={book}
                                onClick={() => setSelectedBook(book)}
                                className={`px-3 py-2 rounded cursor-pointer text-sm ${selectedBook === book ? 'bg-brand-100 text-brand font-medium' : 'hover:bg-gray-50'}`}
                            >
                                {book}
                            </div>
                        ))}
                    </div>

                    {/* Chapters */}
                    <div className="w-24 overflow-y-auto p-2 bg-gray-50/50">
                        <h4 className="font-semibold text-xs text-gray-500 uppercase mb-2 px-2">Ch</h4>
                        {chapters.map(ch => (
                            <div
                                key={ch}
                                onClick={() => setSelectedChapter(ch)}
                                className={`px-3 py-2 rounded cursor-pointer text-sm text-center ${selectedChapter === ch ? 'bg-brand-100 text-brand font-medium' : 'hover:bg-gray-100'}`}
                            >
                                {ch}
                            </div>
                        ))}
                    </div>

                    {/* Verses */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-semibold text-xs text-gray-500 uppercase">Verses</h4>
                            {selectedBook && selectedChapter && (
                                <button
                                    onClick={toggleSelectAll}
                                    className="text-xs text-brand hover:underline font-medium"
                                >
                                    {Object.keys(verses).every(v => selectedVerses[v]) ? 'Deselect All' : 'Select All'}
                                </button>
                            )}
                        </div>
                        {selectedBook && selectedChapter ? (
                            <div className="grid grid-cols-1 gap-1">
                                {Object.entries(verses).map(([vNum, text]) => (
                                    <div
                                        key={vNum}
                                        onClick={() => toggleVerse(vNum, text)}
                                        className={`p-2 rounded border cursor-pointer text-sm flex space-x-3 hover:border-brand-300 ${selectedVerses[vNum] ? 'bg-brand-50 border-brand-200' : 'border-transparent'}`}
                                    >
                                        <div className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full border ${selectedVerses[vNum] ? 'bg-brand border-brand text-white' : 'border-gray-300 text-gray-400'}`}>
                                            {selectedVerses[vNum] ? <Check size={14} /> : <span className="text-xs">{vNum}</span>}
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
