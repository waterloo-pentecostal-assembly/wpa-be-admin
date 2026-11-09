import React from 'react';
import { ExternalLink, Camera, AlertTriangle, AlertCircle } from 'lucide-react';
import { compileEngagement } from '../series/compile';
import { typeLabel } from '../series/engagementTypes';
import { formatLong } from '../series/dates';
import { TypeChip } from './ui';

function BodyBlock({ block }) {
    switch (block.body_type) {
        case 'text':
            return (
                <div className="space-y-2">
                    {block.title && <h5 className="font-semibold text-gray-900">{block.title}</h5>}
                    {block.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
                </div>
            );
        case 'question':
            return (
                <div>
                    {block.title && <h5 className="mb-1 font-semibold text-gray-900">{block.title}</h5>}
                    <ol className="space-y-2">
                        {block.questions.map((q, i) => (
                            <li key={i} className="rounded-lg bg-gray-50 p-2">
                                <p>{q}</p>
                                <div className="mt-1.5 h-6 rounded border border-dashed border-gray-300 bg-white" />
                            </li>
                        ))}
                    </ol>
                </div>
            );
        case 'link':
            return (
                <a href={block.link} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 font-medium text-brand-700 hover:bg-brand-100">
                    <ExternalLink size={14} className="shrink-0" /> <span className="truncate">{block.text}</span>
                </a>
            );
        case 'scripture':
            return (
                <div className="space-y-3">
                    {block.scriptures.map((s, i) => (
                        <div key={i}>
                            <h5 className="mb-1 font-semibold text-gray-900">{s.title || `${s.book} ${s.chapter}`}</h5>
                            <p className="font-serif leading-relaxed">
                                {Object.entries(s.verses).map(([n, t]) => (
                                    <span key={n}><sup className="mr-0.5 text-[9px] font-sans font-bold text-gray-400">{n}</sup>{t} </span>
                                ))}
                            </p>
                        </div>
                    ))}
                    <p className="text-[9px] leading-tight text-gray-400">{block.bible_version}</p>
                </div>
            );
        case 'image_input':
            return (
                <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-4 text-gray-400">
                    <Camera size={16} /> Upload a photo
                </div>
            );
        default:
            return null;
    }
}

/** Approximate rendering of the selected day as readers will see it, built from the compiled JSON. */
export default function PreviewPane({ draft, day, lookup }) {
    if (!day) {
        return (
            <aside className="hidden w-[360px] shrink-0 border-l border-gray-200 bg-gray-50 p-6 text-sm text-gray-400 xl:block">
                Select a day to preview it.
            </aside>
        );
    }
    const compiled = day.engagements.map((e) => ({ engagement: e, ...compileEngagement(draft, day, e, lookup) }));
    return (
        <aside className="hidden w-[360px] shrink-0 flex-col border-l border-gray-200 bg-gray-100 xl:flex">
            <div className="border-b border-gray-200 bg-white px-4 py-2.5">
                <p className="section-label">Preview</p>
                <p className="text-sm font-semibold text-ink">{formatLong(day.date)}</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {compiled.map(({ engagement, entry, issues }) => (
                    <article key={engagement.id} className="rounded-2xl bg-white p-4 text-[13px] leading-relaxed text-gray-700 shadow-sm">
                        <div className="mb-2 flex items-center gap-2">
                            <TypeChip type={engagement.type} />
                            {entry.title && <span className="font-semibold text-gray-900">{entry.title}</span>}
                        </div>
                        {issues.map((issue, i) => (
                            <p key={i} className={`mb-2 flex items-start gap-1.5 text-xs ${issue.level === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                                {issue.level === 'error' ? <AlertCircle size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                                {issue.message.replace(`${typeLabel(engagement.type)}: `, '')}
                            </p>
                        ))}
                        <div className="space-y-3">
                            {entry.body.map((block, i) => <BodyBlock key={i} block={block} />)}
                        </div>
                    </article>
                ))}
                {!compiled.length && <p className="p-4 text-center text-sm text-gray-400">Nothing on this day.</p>}
            </div>
        </aside>
    );
}
