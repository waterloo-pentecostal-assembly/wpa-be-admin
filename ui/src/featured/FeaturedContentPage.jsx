import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertCircle, BookOpen, CalendarRange, ChevronDown, HeartHandshake, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2, X,
} from 'lucide-react';
import Header from '../components/Header';
import ConfirmModal from '../components/ConfirmModal';
import ScripturePicker from '../components/ScripturePicker';
import { useEnv } from '../contexts/EnvContext';
import { fetchBiblePassage } from '../api/bibleApi';
import { deleteFeatured, listFeatured, saveFeatured } from '../api/featuredApi';
import { referenceFromScriptures } from '../series/scriptureRefs';
import { featuredPassage } from './passageId';
import { addDays, busiestDay, today } from './schedule';

// Featured content on the app's home screen (selected environment): verses
// with a note and pastor's encouragements, each shown for a range
// of days (Toronto time, both ends included). Items can overlap, up to the
// server's maxConcurrent (5) at once. Labels and text limits come from the
// server (src/services/featuredContent.js).

const MAX_TITLE = 120;

const TYPE_UI = {
    verse: { icon: BookOpen, hint: 'A passage and a short note' },
    pastors_encouragement: { icon: HeartHandshake, hint: 'A message from a pastor' },
};
function TypeIcon({ type, ...props }) {
    const Icon = TYPE_UI[type]?.icon ?? Sparkles;
    return <Icon {...props} />;
}

const formatDay = (day, withYear = true) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
});
const formatRange = (start, end) => (start === end ? formatDay(start) : `${formatDay(start, false)} – ${formatDay(end)}`);

const STATUS = {
    current: ['Showing now', 'bg-emerald-50 text-emerald-700'],
    upcoming: ['Upcoming', 'bg-brand-50 text-brand'],
    past: ['Past', 'bg-gray-100 text-gray-500'],
};

/** How an item reads in the list: its title, reference or type. */
const itemLabel = (item, types) => item.title || item.reference || types?.[item.type]?.label || item.type || 'Featured item';

/** The passage box's state: what's typed, the looked-up passage ({ reference, passageId, verses, bible } or { error }). */
function usePassage(initial) {
    const [typed, setTyped] = useState(initial.reference ?? '');
    const [passage, setPassage] = useState(initial.passage_id
        ? { reference: initial.reference, passageId: initial.passage_id, verses: null }
        : null);
    const [looking, setLooking] = useState(false);

    const lookUp = useCallback(async (reference) => {
        const value = reference.trim();
        if (!value) return setPassage(null);
        setLooking(true);
        try {
            const result = await fetchBiblePassage(value, 'default');
            const { passageId, reference: label } = featuredPassage(result);
            setPassage({ reference: label, passageId, verses: result.verses, bible: result.bible });
            setTyped(label);
        } catch (e) {
            setPassage({ error: e.message });
        } finally {
            setLooking(false);
        }
    }, []);

    // An existing passage: show its text too.
    useEffect(() => {
        if (initial.reference) lookUp(initial.reference);
    }, [initial.reference, lookUp]);

    const type = (value) => { setTyped(value); setPassage(null); };
    const clear = () => { setTyped(''); setPassage(null); };
    return { typed, passage, looking, lookUp, type, clear, resolved: passage?.passageId ? passage : null };
}

function PassageField({ state, optional }) {
    const [showPicker, setShowPicker] = useState(false);
    const { typed, passage, looking, lookUp } = state;
    return (
        <div>
            <span className="label">Passage{optional && <span className="font-normal text-gray-400"> (optional)</span>}</span>
            <div className="flex gap-2">
                <input
                    className="input flex-1"
                    value={typed}
                    placeholder="e.g. Philippians 4:6-7"
                    onChange={(e) => state.type(e.target.value)}
                    onBlur={() => typed.trim() && !passage && lookUp(typed)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookUp(typed))}
                />
                <button type="button" className="btn btn-secondary" onClick={() => lookUp(typed)} disabled={looking || !typed.trim()}>
                    {looking ? <Loader2 size={16} className="animate-spin" /> : 'Look up'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPicker(true)}>
                    <BookOpen size={16} /> Browse
                </button>
                {optional && typed && (
                    <button type="button" className="icon-btn" title="No passage" onClick={state.clear}><X size={16} /></button>
                )}
            </div>
            {passage?.error && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600"><AlertCircle size={14} /> {passage.error}</p>}
            {passage?.passageId && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold text-ink">{passage.reference}</span>
                        <span className="font-mono text-xs text-gray-500">{passage.passageId}</span>
                        {passage.bible?.abbreviation && <span className="text-xs text-gray-400">preview in {passage.bible.abbreviation}</span>}
                    </div>
                    {passage.verses && (
                        <p className="mt-1.5 max-h-40 overflow-y-auto leading-relaxed text-gray-700">
                            {passage.verses.map((v) => (
                                <span key={`${v.chapter}:${v.verse}`}><sup className="mr-0.5 text-[10px] text-gray-400">{v.verse}</sup>{v.text} </span>
                            ))}
                        </p>
                    )}
                </div>
            )}
            <p className="mt-1 text-xs text-gray-500">One continuous passage. Only its passage ID is stored; the app shows it in the reader’s translation.</p>
            {showPicker && (
                <ScripturePicker
                    bibleId="default"
                    onCancel={() => setShowPicker(false)}
                    onSelect={(scriptures) => {
                        setShowPicker(false);
                        const reference = referenceFromScriptures(scriptures);
                        state.type(reference);
                        lookUp(reference);
                    }}
                />
            )}
        </div>
    );
}

function TextField({ label, value, onChange, max, required, multiline, placeholder, rows = 4 }) {
    const Input = multiline ? 'textarea' : 'input';
    return (
        <label className="block">
            <span className="label">{label}{!required && <span className="font-normal text-gray-400"> (optional)</span>}</span>
            <Input
                className="input"
                style={multiline ? { minHeight: `${rows * 1.5 + 1}rem` } : undefined}
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
            />
            {(multiline || value.length > max * 0.8) && (
                <span className={`mt-1 block text-right text-xs ${value.length > max ? 'text-red-600' : 'text-gray-400'}`}>{value.length} / {max}</span>
            )}
        </label>
    );
}

/**
 * Picks the author from the users tagged as pastors (`authors`: [{ uid, name }]).
 * An edited item's author stays pickable even if they're no longer tagged.
 */
function AuthorField({ value, onChange, authors, current, env }) {
    const options = current?.uid && !authors.some((a) => a.uid === current.uid)
        ? [...authors, { uid: current.uid, name: current.name ? `${current.name} (no longer tagged as a pastor)` : 'A deleted user' }]
        : authors;
    return (
        <label className="block">
            <span className="label">Pastor</span>
            <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!options.length}>
                <option value="">Pick a pastor…</option>
                {options.map((a) => <option key={a.uid} value={a.uid}>{a.name}</option>)}
            </select>
            {!authors.length && (
                <span className="mt-1 block text-xs text-amber-700">
                    No users are tagged as pastors in {env}. Tag them in <Link to="/users" className="underline">User Manager</Link> (Tag as pastor).
                </span>
            )}
        </label>
    );
}

/** Add / edit form for one featured item. */
function ItemForm({ initial, types, items, authors, maxConcurrent, env, onSaved, onCancel }) {
    const [type, setType] = useState(initial.type ?? 'verse');
    const [start, setStart] = useState(initial.start);
    const [end, setEnd] = useState(initial.end);
    const [title, setTitle] = useState(initial.title ?? '');
    const [authorUid, setAuthorUid] = useState(initial.author_uid ?? '');
    const currentAuthor = initial.author_uid ? { uid: initial.author_uid, name: initial.author } : null;
    const [body, setBody] = useState(initial.body ?? '');
    const [note, setNote] = useState(initial.note ?? '');
    const passage = usePassage(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const maxBody = types[type]?.maxBody ?? 1000;
    const isVerse = type === 'verse';
    const datesOk = start && end && end >= start;
    const peak = busiestDay(items.filter((item) => item.id !== initial.id), start, end);
    const full = peak.count >= maxConcurrent;

    // Verses need a passage; for the others it's optional, but a typed one must be looked up (or cleared).
    const passageOk = passage.resolved || (!isVerse && !passage.typed.trim());
    const textOk = isVerse
        ? note.length <= maxBody
        : body.trim() && body.length <= maxBody && title.length <= MAX_TITLE
            && authorUid;
    const ready = datesOk && !full && passageOk && textOk && !passage.looking;

    const save = async () => {
        setSaving(true);
        setError(null);
        const { passageId = '', reference = '' } = passage.resolved ?? {};
        const content = isVerse
            ? { passage_id: passageId, reference, note }
            : { title, author_uid: authorUid, body, passage_id: passageId, reference };
        try {
            onSaved(await saveFeatured(initial.id, { type, start, end, ...content }, env));
        } catch (e) {
            setError(e.message);
            setSaving(false);
        }
    };

    return (
        <section className="card card-body space-y-5">
            <h3 className="card-title">{initial.id ? `Edit ${types[type]?.label.toLowerCase() ?? 'featured item'}` : 'New featured item'}</h3>

            {!initial.id && (
                <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(types).map(([key, spec]) => {
                        const selected = key === type;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setType(key)}
                                className={`rounded-lg border p-3 text-left transition ${selected ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-gray-200 hover:border-gray-300'}`}
                            >
                                <span className="flex items-center gap-2 font-semibold text-ink"><TypeIcon type={key} size={16} className={selected ? 'text-brand' : 'text-gray-500'} /> {spec.label}</span>
                                <span className="mt-0.5 block text-xs text-gray-500">{TYPE_UI[key]?.hint}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                    <span className="label">First day</span>
                    <input type="date" className="input" value={start} onChange={(e) => {
                        setStart(e.target.value);
                        if (e.target.value && end < e.target.value) setEnd(e.target.value);
                    }} />
                </label>
                <label className="block">
                    <span className="label">Last day</span>
                    <input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
                </label>
            </div>
            <div className="-mt-3 space-y-1 text-xs">
                <p className="text-gray-500">
                    Shown on the home screen from the start of the first day to the end of the last day (Toronto time)
                    {datesOk && <> · {Math.round((new Date(end) - new Date(start)) / 86400000) + 1} days</>}.
                </p>
                {datesOk && peak.count > 0 && (
                    <p className={full ? 'font-semibold text-red-600' : 'text-gray-500'}>
                        {full
                            ? `${formatDay(peak.day)} already has ${peak.count} featured items (${peak.items.map((item) => itemLabel(item, types)).join(', ')}). At most ${maxConcurrent} can show at once: pick other days or shorten one of them.`
                            : `Up to ${peak.count} other item${peak.count === 1 ? '' : 's'} also show${peak.count === 1 ? 's' : ''} during these days (${peak.count + 1} of ${maxConcurrent}).`}
                    </p>
                )}
            </div>

            {isVerse ? (
                <>
                    <PassageField state={passage} />
                    <TextField label="Note" value={note} onChange={setNote} max={maxBody} multiline placeholder="A short reflection or why this verse" />
                </>
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <AuthorField value={authorUid} onChange={setAuthorUid} authors={authors} current={currentAuthor} env={env} />
                        <TextField label="Title" value={title} onChange={setTitle} max={MAX_TITLE} placeholder="e.g. You are not alone" />
                    </div>
                    <TextField
                        label="Message"
                        value={body}
                        onChange={setBody}
                        max={maxBody}
                        required
                        multiline
                        rows={6}
                        placeholder="A word of encouragement. Line breaks are kept."
                    />
                    <PassageField state={passage} optional />
                </>
            )}

            {!passageOk && passage.typed.trim() && !passage.looking && (
                <p className="text-xs text-amber-700">Look up the passage{isVerse ? '' : ' or clear it'} before saving.</p>
            )}
            {error && <p className="alert alert-error"><AlertCircle size={16} className="shrink-0" /> {error}</p>}

            <div className="flex justify-end gap-2">
                <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={!ready || saving}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : null} Save{env === 'prod' ? ' to prod' : ''}
                </button>
            </div>
        </section>
    );
}

function ItemRow({ item, types, onEdit, onDelete, disabled }) {
    const [label, tone] = STATUS[item.status];
    const known = !!types[item.type];
    // `author` is the author's current name, looked up by the server from author_uid ('' if their profile is gone).
    const author = item.author_uid ? item.author || 'a deleted user' : item.author;
    const details = [author && `From ${author}`, item.title && item.reference]
        .filter(Boolean);
    const text = item.type === 'verse' ? item.note : item.body;
    return (
        <li className="flex items-start gap-3 px-4 py-3">
            <TypeIcon type={item.type} size={18} className="mt-0.5 shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{itemLabel(item, types)}</span>
                    {item.type === 'verse' && <span className="font-mono text-xs text-gray-400">{item.passage_id}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{label}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                    <span>{types[item.type]?.label ?? `Unknown type: ${item.type}`}</span>
                    <span className="flex items-center gap-1"><CalendarRange size={12} /> {formatRange(item.start, item.end)}</span>
                    {details.map((d) => <span key={d}>{d}</span>)}
                </div>
                {text && <p className="mt-1 line-clamp-2 text-sm text-gray-600">{text}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
                <button className="icon-btn" title={known ? 'Edit' : 'This console can’t edit this type'} onClick={onEdit} disabled={disabled || !known}><Pencil size={15} /></button>
                <button className="icon-btn hover:bg-red-50 hover:text-red-600" title="Delete" onClick={onDelete} disabled={disabled}><Trash2 size={15} /></button>
            </div>
        </li>
    );
}

export default function FeaturedContentPage() {
    const { env } = useEnv();
    const [data, setData] = useState(null); // { env, maxConcurrent, types, items }
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(null); // item being edited, or { new: true, start, end }
    const [deleting, setDeleting] = useState(null);
    const [showPast, setShowPast] = useState(false);
    const [note, setNote] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await listFeatured());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load, env]);

    const items = data?.items ?? [];
    const types = data?.types ?? {};
    const maxConcurrent = data?.maxConcurrent ?? 5;
    const current = items.filter((item) => item.status === 'current');
    const upcoming = items.filter((item) => item.status === 'upcoming').reverse(); // soonest first
    const past = items.filter((item) => item.status === 'past');
    const shownEnv = data?.env ?? env;
    const label = (item) => itemLabel(item, types);

    const remove = async () => {
        const target = deleting;
        setDeleting(null);
        setError(null);
        try {
            await deleteFeatured(target.id, shownEnv);
            setNote(`Deleted ${label(target)} (${formatRange(target.start, target.end)}).`);
        } catch (e) {
            setError(e.message);
        }
        load();
    };

    const row = (item) => (
        <ItemRow
            key={item.id}
            item={item}
            types={types}
            disabled={!!editing}
            onEdit={() => { setNote(null); setEditing(item); }}
            onDelete={() => setDeleting(item)}
        />
    );

    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <Header
                title="Featured Content"
                subtitle={`What the app’s home screen features${shownEnv ? ` in ${shownEnv}` : ''}`}
                icon={Sparkles}
                actions={(
                    <button onClick={load} className="btn btn-secondary" title="Reload">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        <span>Refresh</span>
                    </button>
                )}
            />

            <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-8 space-y-6">
                <section className="card card-body">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <p className="eyebrow">Showing now{data ? ` · ${current.length} of ${maxConcurrent}` : ''}</p>
                            {current.length ? (
                                <ul className="mt-1 space-y-1.5">
                                    {current.map((item) => (
                                        <li key={item.id} className="flex items-start gap-2">
                                            <TypeIcon type={item.type} size={16} className="mt-1 shrink-0 text-brand" />
                                            <div className="min-w-0">
                                                <span className="font-semibold text-ink">{label(item)}</span>
                                                <span className="text-sm text-gray-500"> · {types[item.type]?.label ?? item.type}, until the end of {formatDay(item.end, false)}</span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mt-1 text-sm text-gray-500">{data ? 'Nothing is featured today.' : 'Loading…'}</p>
                            )}
                        </div>
                        {!editing && (
                            <button
                                className="btn btn-primary shrink-0"
                                onClick={() => { setNote(null); setEditing({ new: true, start: today(), end: addDays(today(), 6) }); }}
                                disabled={!data}
                            >
                                <Plus size={16} /> Add
                            </button>
                        )}
                    </div>
                    <p className="mt-3 text-xs text-gray-500">Verses with a note and pastor’s encouragements. Up to {maxConcurrent} can show at the same time.</p>
                    {shownEnv === 'prod' && <p className="mt-1 text-xs font-semibold text-red-700">You are working on PROD: changes show in the live app.</p>}
                </section>

                {error && <p className="alert alert-error"><AlertCircle size={16} className="shrink-0" /> {error}</p>}
                {note && <p className="alert alert-success">{note}</p>}

                {editing && (
                    <ItemForm
                        key={editing.id ?? 'new'}
                        initial={editing}
                        types={types}
                        items={items}
                        authors={data?.authors ?? []}
                        maxConcurrent={maxConcurrent}
                        env={shownEnv}
                        onCancel={() => setEditing(null)}
                        onSaved={(saved) => {
                            setEditing(null);
                            setNote(`Saved ${label(saved)} for ${formatRange(saved.start, saved.end)}.`);
                            load();
                        }}
                    />
                )}

                <section className="card overflow-hidden">
                    <h3 className="card-title px-4 pt-4 pb-2">Current and upcoming</h3>
                    {current.length || upcoming.length ? (
                        <ul className="divide-y divide-gray-100">{[...current, ...upcoming].map(row)}</ul>
                    ) : (
                        <p className="px-4 pb-4 text-sm text-gray-500">Nothing scheduled.</p>
                    )}
                    {past.length > 0 && (
                        <div className="border-t border-gray-100">
                            <button className="flex w-full items-center gap-1 px-4 py-3 text-sm font-semibold text-gray-600" onClick={() => setShowPast((s) => !s)}>
                                <ChevronDown size={14} className={showPast ? 'rotate-180' : ''} /> Past ({past.length})
                            </button>
                            {showPast && <ul className="divide-y divide-gray-100 border-t border-gray-100">{past.map(row)}</ul>}
                        </div>
                    )}
                </section>
            </main>

            {deleting && (
                <ConfirmModal
                    title={`Delete ${label(deleting)}?`}
                    message={`This ${types[deleting.type]?.label.toLowerCase() ?? 'item'} for ${formatRange(deleting.start, deleting.end)} will be removed from ${shownEnv}${deleting.status === 'current' ? ', and taken off the home screen now' : ''}.`}
                    confirmText="Delete"
                    isDangerous
                    onCancel={() => setDeleting(null)}
                    onConfirm={remove}
                />
            )}
        </div>
    );
}
