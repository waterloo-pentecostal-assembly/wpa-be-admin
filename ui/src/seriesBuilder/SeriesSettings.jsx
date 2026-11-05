import React from 'react';
import { CalendarRange, CloudUpload } from 'lucide-react';
import { describeSchedule } from '../series/schedule';
import { formatShort } from '../series/dates';
import ImageUploader from './ImageUploader';
import PublishStatus from './PublishStatus';

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
                    <h3 className="font-semibold text-ink">Published</h3>
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
