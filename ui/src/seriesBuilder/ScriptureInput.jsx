import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, AlertCircle, Loader2 } from 'lucide-react';
import ScripturePicker from '../components/ScripturePicker';
import { resolveOne, useScriptureLookup } from '../series/passageStore';
import { referenceFromScriptures } from '../series/scriptureRefs';
import { findBook, loadBooks, loadChapters, splitTyped, suggestBooks } from './bibleBooks';

/**
 * Scripture reference field with book typeahead ("mat" -> Matthew,
 * "1co" -> 1 Corinthians), validation against the NIV data and a Browse
 * button for picking verses visually. Valid references are normalized to
 * their full form ("mt 5:1-12" -> "Matthew 5:1-12").
 *
 * Enter commits; Ctrl/Cmd+Enter commits and calls `onSubmitNext`.
 */
export default function ScriptureInput({
    value,
    onChange,
    placeholder = 'e.g. Matthew 1:18-25',
    onSubmitNext,
    inputRef,
    large = false,
    autoFocus = false,
}) {
    const [text, setText] = useState(value ?? '');
    const [focused, setFocused] = useState(false);
    const [books, setBooks] = useState([]);
    const [highlight, setHighlight] = useState(0);
    const [chapterInfo, setChapterInfo] = useState(null); // { book, chapters }
    const [checking, setChecking] = useState(false);
    const [showPicker, setShowPicker] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const localRef = useRef(null);
    const ref = inputRef ?? localRef;

    const lookup = useScriptureLookup(value ? [value] : []);
    const resolved = value ? lookup(value) : null;

    // Follow external changes (undo, copy, other day) while not editing.
    const [lastValue, setLastValue] = useState(value);
    if (value !== lastValue) {
        setLastValue(value);
        if (!focused) setText(value ?? '');
    }

    useEffect(() => {
        loadBooks().then(setBooks).catch(() => setBooks([]));
    }, []);

    const { bookText, rest } = splitTyped(text);
    const suggestions = useMemo(
        () => (focused && !dismissed && !rest && bookText ? suggestBooks(books, bookText) : []),
        [focused, dismissed, rest, bookText, books],
    );
    const exactBook = findBook(books, bookText);
    const showSuggestions = suggestions.length > 0 && !(exactBook && text.endsWith(' '));

    useEffect(() => {
        if (!exactBook || !focused) return;
        let ignore = false;
        loadChapters(exactBook.name)
            .then((chapters) => !ignore && setChapterInfo({ book: exactBook.name, chapters }))
            .catch(() => {});
        return () => { ignore = true; };
    }, [exactBook, focused]);

    const accept = (book) => {
        setText(`${book.name} `);
        setHighlight(0);
        ref.current?.focus();
    };

    const commit = async (raw = text) => {
        const trimmed = raw.trim();
        if (trimmed === (value ?? '').trim()) return trimmed;
        if (!trimmed) {
            onChange('');
            return '';
        }
        setChecking(true);
        try {
            const result = await resolveOne(trimmed);
            const next = result?.ok ? result.label : trimmed;
            setText(next);
            onChange(next);
            return next;
        } finally {
            setChecking(false);
        }
    };

    const onKeyDown = async (e) => {
        if (showSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
            return;
        }
        if (showSuggestions && (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey))) {
            e.preventDefault();
            accept(suggestions[Math.min(highlight, suggestions.length - 1)]);
            return;
        }
        if (e.key === 'Escape' && showSuggestions) {
            e.stopPropagation();
            setDismissed(true);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            await commit();
            if ((e.metaKey || e.ctrlKey) && onSubmitNext) onSubmitNext();
        }
    };

    // Status line under the field.
    let status = null;
    const chapterNum = /^(\d+)\s*$/.exec(rest)?.[1];
    if (focused && exactBook && chapterInfo?.book === exactBook.name && (!rest.trim() || chapterNum)) {
        const ch = chapterNum ? chapterInfo.chapters.find((c) => c.chapter === Number(chapterNum)) : null;
        status = (
            <span className="text-gray-500">
                {ch ? `${exactBook.name} ${ch.chapter} has ${ch.verseCount} verses` : `${exactBook.name} has ${chapterInfo.chapters.length} chapters`}
            </span>
        );
    } else if (checking || (value && resolved === null)) {
        status = <span className="flex items-center gap-1 text-gray-400"><Loader2 size={12} className="animate-spin" /> Checking…</span>;
    } else if (resolved?.ok && text.trim() === value?.trim()) {
        const verseCount = resolved.passages.reduce((n, p) => n + p.verses.length, 0);
        status = (
            <span className="flex items-center gap-1 text-emerald-700 min-w-0">
                <Check size={12} className="shrink-0" />
                <span className="shrink-0">{verseCount} {verseCount === 1 ? 'verse' : 'verses'}</span>
                <span className="truncate text-gray-400 italic">“{resolved.passages[0]?.verses[0]?.text}”</span>
            </span>
        );
    } else if (resolved && !resolved.ok && text.trim() === value?.trim()) {
        status = <span className="flex items-center gap-1 text-red-600"><AlertCircle size={12} /> {resolved.error}</span>;
    }

    return (
        <div className="relative">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <input
                        ref={ref}
                        value={text}
                        autoFocus={autoFocus}
                        onChange={(e) => {
                            setText(e.target.value);
                            setHighlight(0);
                            setDismissed(false);
                        }}
                        onFocus={() => setFocused(true)}
                        onBlur={() => {
                            setFocused(false);
                            commit();
                        }}
                        onKeyDown={onKeyDown}
                        placeholder={placeholder}
                        spellCheck={false}
                        autoComplete="off"
                        className={`input ${large ? 'text-base font-semibold py-2.5' : ''} ${resolved && !resolved.ok && text.trim() === value?.trim() ? 'border-red-300' : ''}`}
                    />
                    {showSuggestions && (
                        <ul className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                            {suggestions.map((book, i) => (
                                <li key={book.name}>
                                    <button
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            accept(book);
                                        }}
                                        onMouseEnter={() => setHighlight(i)}
                                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${i === highlight ? 'bg-brand-50 text-brand-700' : 'text-gray-700'}`}
                                    >
                                        <span className="font-medium">{book.name}</span>
                                        <span className="text-xs text-gray-400">{book.chapterCount} ch</span>
                                    </button>
                                </li>
                            ))}
                            <li className="px-3 pt-1 pb-0.5 text-[10px] text-gray-400 border-t border-gray-100 mt-1">↑↓ to choose · Tab or Enter to accept</li>
                        </ul>
                    )}
                </div>
                <button type="button" onClick={() => setShowPicker(true)} className="btn btn-secondary px-3" title="Browse verses">
                    <BookOpen size={16} />
                </button>
            </div>
            <div className="mt-1 h-4 text-xs">{status}</div>

            {showPicker && (
                <ScripturePicker
                    onCancel={() => setShowPicker(false)}
                    onSelect={(s) => {
                        setShowPicker(false);
                        const refText = referenceFromScriptures([s]);
                        setText(refText);
                        commit(refText);
                    }}
                />
            )}
        </div>
    );
}
