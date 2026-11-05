import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2, Plus, Image as ImageIcon, CalendarDays, Heading, Loader2 } from 'lucide-react';
import { SCRIPTURE_TOKEN } from '../series/engagementTypes';
import { BLOCK_KINDS, newBlock } from '../series/blocks';
import { fetchLinkInfo } from '../api/seriesBuilderApi';
import ScriptureInput from './ScriptureInput';
import { AutoTextarea } from './ui';

/** Text area with an "Insert {scripture}" button and a live preview of the token. */
function TokenTextarea({ value, onChange, placeholder, readingLabel, minRows = 2, coalesceKey }) {
    const ref = useRef(null);
    const insertToken = () => {
        const el = ref.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const next = value.slice(0, start) + SCRIPTURE_TOKEN + value.slice(end);
        onChange(next, coalesceKey);
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(start + SCRIPTURE_TOKEN.length, start + SCRIPTURE_TOKEN.length);
        });
    };
    const hasToken = value.includes(SCRIPTURE_TOKEN);
    return (
        <div>
            <AutoTextarea
                textareaRef={ref}
                value={value}
                minRows={minRows}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value, coalesceKey)}
            />
            <div className="mt-1 flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0 text-gray-400">
                    {hasToken && readingLabel !== undefined && (
                        readingLabel
                            ? <>{'{scripture}'} → <span className="font-medium text-gray-600">{readingLabel}</span></>
                            : <span className="text-amber-600">{'{scripture}'} needs the day’s scripture</span>
                    )}
                    {hasToken && readingLabel === undefined && <>{'{scripture}'} is replaced with each day’s scripture</>}
                </span>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={insertToken} className="shrink-0 font-semibold text-brand hover:text-brand-700">
                    + Insert {'{scripture}'}
                </button>
            </div>
        </div>
    );
}

function LinkFields({ block, onChange, coalesceKey }) {
    const [looking, setLooking] = useState(false);
    const lookupTitle = async (url) => {
        if (!url || block.text?.trim() || !/youtu\.?be/.test(url)) return;
        setLooking(true);
        try {
            const info = await fetchLinkInfo(url);
            // The channel name (e.g. "PaulBalocheVEVO") is usually noise, so use the title only.
            if (info.title) onChange({ text: info.title });
        } catch {
            // Title lookup is a convenience; the user can type it.
        } finally {
            setLooking(false);
        }
    };
    return (
        <div className="grid gap-2 sm:grid-cols-[3fr_2fr]">
            <input
                className="input font-mono text-xs"
                placeholder="https://youtube.com/watch?v=…"
                value={block.url ?? ''}
                onChange={(e) => onChange({ url: e.target.value }, `${coalesceKey}:url`)}
                onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').trim();
                    if (pasted) setTimeout(() => lookupTitle(pasted), 0);
                }}
                onBlur={(e) => lookupTitle(e.target.value.trim())}
            />
            <div className="relative">
                <input
                    className="input"
                    placeholder={looking ? 'Looking up title…' : 'Link text (song title)'}
                    value={block.text ?? ''}
                    onChange={(e) => onChange({ text: e.target.value }, `${coalesceKey}:text`)}
                />
                {looking && <Loader2 size={14} className="absolute right-2.5 top-2.5 animate-spin text-gray-400" />}
            </div>
        </div>
    );
}

/**
 * Edits the content of one block. `onChange(patch, coalesceKey)`.
 * `readingLabel`: the day's scripture label (string), '' when the day has
 * none, or undefined in template mode (no specific day).
 */
export function BlockContentEditor({ block, onChange, readingLabel, placeholder, coalesceKey = block.id, autoFocus }) {
    switch (block.kind) {
        case 'text':
            return (
                <TokenTextarea
                    value={block.text ?? ''}
                    onChange={(text, key) => onChange({ text }, key)}
                    placeholder={placeholder ?? 'One paragraph per line'}
                    readingLabel={readingLabel}
                    coalesceKey={coalesceKey}
                />
            );
        case 'question':
            return (
                <TokenTextarea
                    value={block.text ?? ''}
                    onChange={(text, key) => onChange({ text }, key)}
                    placeholder={placeholder ?? 'One question per line'}
                    readingLabel={readingLabel}
                    minRows={3}
                    coalesceKey={coalesceKey}
                />
            );
        case 'link':
            return <LinkFields block={block} onChange={onChange} coalesceKey={coalesceKey} />;
        case 'scripture':
            return (
                <div className="space-y-2">
                    {!block.fromDay && (
                        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-semibold">
                            {[['reading', 'Day’s scripture'], ['passage', 'Specific passage']].map(([source, label]) => (
                                <button
                                    key={source}
                                    type="button"
                                    onClick={() => onChange(source === 'reading' ? { source, perDay: false } : { source })}
                                    className={`rounded-md px-2.5 py-1 ${block.source === source ? 'bg-white text-ink shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                    {block.source === 'reading' ? (
                        <p className="text-sm text-gray-500">
                            {readingLabel === undefined
                                ? 'Shows each day’s scripture.'
                                : readingLabel
                                    ? <>Shows <span className="font-medium text-gray-700">{readingLabel}</span></>
                                    : <span className="text-amber-600">Set the day’s scripture above.</span>}
                        </p>
                    ) : block.perDay ? (
                        <p className="text-sm text-gray-500">Chosen on each day.</p>
                    ) : (
                        <ScriptureInput value={block.ref ?? ''} onChange={(ref) => onChange({ ref })} placeholder="e.g. Romans 1:16" autoFocus={autoFocus} />
                    )}
                </div>
            );
        case 'image_input':
            return (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                    <ImageIcon size={15} /> Readers can upload a photo here.
                </p>
            );
        default:
            return null;
    }
}

const KIND_LABEL = Object.fromEntries(BLOCK_KINDS.map((k) => [k.kind, k.label]));

/**
 * Editable list of blocks (custom engagements and templates). In template
 * mode each block can be marked "Per day", making it a field filled in on
 * every day instead of fixed template content.
 */
export function BlockList({ blocks, onChange, readingLabel, templateMode = false }) {
    const [headingOpen, setHeadingOpen] = useState({});
    const update = (id, patch, coalesce) => onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)), coalesce);
    const move = (index, delta) => {
        const next = [...blocks];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        onChange(next);
    };

    return (
        <div className="space-y-3">
            {blocks.map((block, index) => {
                const canPerDay = templateMode && block.kind !== 'image_input' && !(block.kind === 'scripture' && block.source === 'reading');
                const canHeading = block.kind === 'text' || block.kind === 'question';
                const showHeading = canHeading && (block.title || headingOpen[block.id]);
                return (
                    <div key={block.id} className={`group/block rounded-lg border p-3 ${block.perDay ? 'border-dashed border-brand-300 bg-brand-50/40' : 'border-gray-200 bg-white'}`}>
                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{KIND_LABEL[block.kind]}</span>
                            {canPerDay && (
                                <button
                                    type="button"
                                    onClick={() => update(block.id, { perDay: !block.perDay })}
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${block.perDay ? 'bg-brand text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
                                    title="Per-day blocks are filled in on each day instead of being the same everywhere"
                                >
                                    <CalendarDays size={11} /> {block.perDay ? 'Filled in per day' : 'Make per-day'}
                                </button>
                            )}
                            <div className="ml-auto flex items-center gap-0.5 opacity-40 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
                                {canHeading && !showHeading && (
                                    <button type="button" className="icon-btn p-1" title="Add heading" onClick={() => setHeadingOpen((h) => ({ ...h, [block.id]: true }))}>
                                        <Heading size={14} />
                                    </button>
                                )}
                                <button type="button" className="icon-btn p-1" disabled={index === 0} onClick={() => move(index, -1)} title="Move up"><ArrowUp size={14} /></button>
                                <button type="button" className="icon-btn p-1" disabled={index === blocks.length - 1} onClick={() => move(index, 1)} title="Move down"><ArrowDown size={14} /></button>
                                <button type="button" className="icon-btn p-1 hover:bg-red-50 hover:text-red-600" onClick={() => onChange(blocks.filter((b) => b.id !== block.id))} title="Remove block"><Trash2 size={14} /></button>
                            </div>
                        </div>
                        {showHeading && (
                            <input
                                className="input mb-2 font-semibold"
                                placeholder="Heading (optional)"
                                value={block.title ?? ''}
                                onChange={(e) => update(block.id, { title: e.target.value }, `${block.id}:title`)}
                            />
                        )}
                        {block.perDay && block.kind !== 'scripture' ? (
                            <div className="text-sm text-gray-500">
                                <p className="mb-1.5">Filled in on each day. Optional placeholder shown in the empty field:</p>
                                <input
                                    className="input"
                                    value={block.placeholder ?? ''}
                                    placeholder="Placeholder text"
                                    onChange={(e) => update(block.id, { placeholder: e.target.value }, `${block.id}:ph`)}
                                />
                            </div>
                        ) : (
                            <BlockContentEditor
                                block={block}
                                readingLabel={readingLabel}
                                onChange={(patch, coalesce) => update(block.id, patch, coalesce)}
                            />
                        )}
                    </div>
                );
            })}
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1">Add</span>
                {BLOCK_KINDS.map(({ kind, label }) => (
                    <button
                        key={kind}
                        type="button"
                        onClick={() => onChange([...blocks, newBlock(kind)])}
                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                    >
                        <Plus size={12} /> {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
