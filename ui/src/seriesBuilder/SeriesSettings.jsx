import React, { useEffect, useState } from 'react';
import { BookOpen, CalendarRange, CloudUpload } from 'lucide-react';
import { fetchTranslations } from '../api/bibleApi';
import { describeSchedule } from '../series/schedule';
import { formatShort } from '../series/dates';
import ImageUploader from './ImageUploader';
import PublishStatus, { CopyId } from './PublishStatus';

/**
 * Bible translation for the series' scripture (API.Bible). Blank follows the
 * server's default; picking one stores its ID on the draft so the series
 * keeps it even if the default changes.
 */
function TranslationPicker({ value, onChange }) {
    const [state, setState] = useState({ loading: true, error: null, default: null, bibles: [] });

    useEffect(() => {
        let ignore = false;
        fetchTranslations()
            .then((r) => !ignore && setState({ loading: false, error: null, default: r.default, bibles: r.bibles }))
            .catch((error) => !ignore && setState({ loading: false, error: error.message, default: null, bibles: [] }));
        return () => { ignore = true; };
    }, []);

    const label = (b) => `${b.abbreviation ? `${b.abbreviation} · ` : ''}${b.name}`;
    const fallback = state.bibles.find((b) => b.id === state.default);
    const unknown = value && !state.loading && !state.bibles.some((b) => b.id === value);

    return (
        <div>
            <label className="label flex items-center gap-1.5"><BookOpen size={13} /> Bible translation</label>
            <select
                className="input"
                value={value ?? ''}
                disabled={state.loading}
                onChange={(e) => onChange(e.target.value || null)}
            >
                <option value="">{state.loading ? 'Loading translations…' : `Default${fallback ? ` (${label(fallback)})` : ''}`}</option>
                {state.bibles.map((b) => <option key={b.id} value={b.id}>{label(b)}</option>)}
                {unknown && <option value={value}>{value} (not enabled)</option>}
            </select>
            <p className="mt-1 text-xs text-gray-500">
                {state.error
                    ? <span className="text-red-600">Couldn’t load translations: {state.error}</span>
                    : 'Scripture text and its copyright notice come from this translation. Changing it updates every passage in the series the next time it’s published or updated.'}
            </p>
        </div>
    );
}

export default function SeriesSettings({ draft, update, env, publishes, onEditSchedule }) {
    const meta = draft.meta;
    const setMeta = (patch, coalesce) => update((d) => ({ ...d, meta: { ...d.meta, ...patch } }), { coalesce });
    const first = draft.days[0]?.date;
    const last = draft.days.at(-1)?.date;

    return (
        <div className="mx-auto max-w-3xl px-6 py-5">
            <p className="eyebrow">Series details</p>
            <h2 className="mb-5 text-xl font-bold text-ink">{meta.title || 'Untitled series'}</h2>

            <div className="card p-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label className="label">Title</label>
                        <input className="input" value={meta.title} onChange={(e) => setMeta({ title: e.target.value }, 'meta:title')} placeholder="e.g. Matthew" />
                    </div>
                    <div>
                        <label className="label">Subtitle</label>
                        <input className="input" value={meta.sub_title} onChange={(e) => setMeta({ sub_title: e.target.value }, 'meta:sub')} placeholder="Optional" />
                    </div>
                </div>
                <TranslationPicker value={meta.bible_id ?? null} onChange={(bible_id) => setMeta({ bible_id })} />
                <div>
                    <label className="label">Cover image</label>
                    <ImageUploader
                        value={meta.image_gs_location}
                        seriesTitle={meta.title}
                        env={env}
                        onChange={(gs, coalesce) => setMeta({ image_gs_location: gs }, coalesce)}
                    />
                </div>
                <div className="flex flex-wrap gap-3">
                    {[['is_active', 'Active', 'The current series in the app'], ['is_visible', 'Visible', 'Shown in the app’s series list']].map(([key, label, hint]) => (
                        <label key={key} className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 hover:border-gray-300" title={hint}>
                            <input type="checkbox" className="checkbox" checked={!!meta[key]} onChange={(e) => setMeta({ [key]: e.target.checked })} />
                            <span className="text-sm font-semibold text-gray-700">{label}</span>
                            <span className="text-xs text-gray-400">{hint}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="card mt-5 flex items-center gap-4 p-5">
                <CalendarRange size={22} className="text-brand shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{describeSchedule(draft.schedule)} · {draft.days.length} days</div>
                    <div className="text-sm text-gray-500">{first ? `${formatShort(first)} – ${formatShort(last)}` : 'No dates'}</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={onEditSchedule}>Edit schedule</button>
            </div>

            <div className="card mt-5 p-5">
                <div className="mb-3 flex items-center gap-2">
                    <CloudUpload size={18} className="text-brand" />
                    <h3 className="font-semibold text-ink">{publishes.seriesId ? 'Published' : 'Not published'}</h3>
                    {publishes.seriesId && <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">Series ID <CopyId id={publishes.seriesId} /></span>}
                </div>
                {publishes.local ? (
                    <p className="text-sm text-gray-500">This draft is only in this browser, so publishes aren’t recorded.</p>
                ) : publishes.publishes.length === 0 ? (
                    <p className="text-sm text-gray-500">{publishes.error ? `Couldn’t load publish history: ${publishes.error}` : 'Not published yet.'}</p>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {[...publishes.publishes].reverse().map((p) => (
                            <li key={p.id} className="py-3 first:pt-0 last:pb-0"><PublishStatus publish={p} /></li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
