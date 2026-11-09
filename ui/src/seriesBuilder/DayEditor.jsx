import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, ClipboardList } from 'lucide-react';
import {
    addEngagement, detachEngagement, moveEngagement, relinkEngagement, removeEngagement,
    setEngagementValue, typesForDate, updateDay, updateEngagement,
} from '../series/draftModel';
import { ENGAGEMENT_TYPES, typeColors, typeLabel } from '../series/engagementTypes';
import { formatLong } from '../series/dates';
import EngagementCard from './EngagementCard';
import ScriptureInput from './ScriptureInput';
import { Kbd } from './ui';

export default function DayEditor({
    draft,
    day,
    dayIndex,
    lookup,
    issues,
    update,
    onPrev,
    onNext,
    onCopy,
    onEditTemplate,
    onPastePlan,
    readingInputRef,
    toast,
}) {
    const reading = day.reading?.ref ?? '';
    const resolved = reading ? lookup(reading) : null;
    const readingLabel = resolved?.ok ? resolved.label : reading;

    const dayIssues = issues.filter((i) => i.dayId === day.id);
    const issuesFor = (engagementId) => dayIssues.filter((i) => i.engagementId === engagementId);

    // Every type can be added, even one the day already has (e.g. a second Reflect).
    // Planned types the day is missing come first and stand out.
    const presentTypes = new Set(day.engagements.map((e) => e.type));
    const missingDefaults = typesForDate(draft.engagementPlan, day.date).filter((t) => !presentTypes.has(t));
    const otherTypes = ENGAGEMENT_TYPES.map((t) => t.id).filter((t) => !missingDefaults.includes(t));

    const prevDay = draft.days[dayIndex - 1];
    const readingSuggestion = useMemo(() => {
        // Suggest continuing from the previous day's chapter, e.g. "Matthew 3" after "Matthew 2:1-23".
        const prevRef = prevDay?.reading?.ref;
        const m = prevRef && /^(.*?)\s(\d+)(?::[\d,\s-]+)?$/.exec(prevRef);
        return !reading && m ? `${m[1]} ${Number(m[2]) + 1}` : null;
    }, [prevDay, reading]);

    const remove = (engagement) => {
        update((d) => removeEngagement(d, day.id, engagement.id));
        toast(`Removed ${typeLabel(engagement.type)}`, { undo: true });
    };

    return (
        <div className="mx-auto max-w-3xl px-6 py-5">
            {/* Day header */}
            <div className="mb-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className="eyebrow">Day {dayIndex + 1} of {draft.days.length}</p>
                    <h2 className="text-xl font-bold text-ink">{formatLong(day.date)}</h2>
                </div>
                <div className="flex items-center gap-1">
                    <button className="btn btn-secondary btn-sm px-2" onClick={onPrev} disabled={dayIndex === 0} title="Previous day (Alt+↑)"><ChevronLeft size={16} /></button>
                    <button className="btn btn-secondary btn-sm px-2" onClick={onNext} disabled={dayIndex === draft.days.length - 1} title="Next day (Alt+↓)"><ChevronRight size={16} /></button>
                </div>
            </div>

            {/* Day's scripture */}
            <section className="card mb-5 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="label mb-0">Today’s scripture</label>
                    <div className="flex items-center gap-1">
                        <button className="btn btn-ghost btn-sm" onClick={onPastePlan} title="Paste a reading plan for many days">
                            <ClipboardList size={14} /> Paste plan
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onCopy({ kind: 'reading' })} disabled={!reading} title="Copy this scripture to other days">
                            <Copy size={14} /> Copy to…
                        </button>
                    </div>
                </div>
                <ScriptureInput
                    large
                    value={reading}
                    inputRef={readingInputRef}
                    onChange={(ref) => update((d) => updateDay(d, day.id, (x) => ({ ...x, reading: ref ? { ref, title: x.reading?.title ?? '' } : null })))}
                    onSubmitNext={onNext}
                    placeholder='Type a book, e.g. “mat 5:1-12”'
                />
                <div className="flex items-center justify-between gap-3 text-[11px] text-gray-400">
                    <span><Kbd>Enter</Kbd> save · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> save &amp; next day</span>
                    {readingSuggestion && (
                        <button
                            className="font-semibold text-brand hover:text-brand-700"
                            onClick={() => update((d) => updateDay(d, day.id, (x) => ({ ...x, reading: { ref: readingSuggestion, title: '' } })))}
                        >
                            Continue with {readingSuggestion}
                        </button>
                    )}
                </div>
            </section>

            {/* Engagements */}
            <div className="space-y-4">
                {day.engagements.map((engagement, index) => (
                    <EngagementCard
                        key={engagement.id}
                        draft={draft}
                        engagement={engagement}
                        readingLabel={readingLabel}
                        issues={issuesFor(engagement.id)}
                        index={index}
                        count={day.engagements.length}
                        onValueChange={(blockId, patch, coalesce) => update((d) => setEngagementValue(d, day.id, engagement.id, blockId, patch), { coalesce })}
                        onCustomChange={(patch, coalesce) => update((d) => updateEngagement(d, day.id, engagement.id, (e) => ({ ...e, ...patch })), { coalesce })}
                        onMove={(delta) => update((d) => moveEngagement(d, day.id, engagement.id, delta))}
                        onRemove={() => remove(engagement)}
                        onCopy={() => onCopy({ kind: 'engagement', engagementId: engagement.id })}
                        onDetach={() => update((d) => detachEngagement(d, day.id, engagement.id))}
                        onRelink={() => {
                            update((d) => relinkEngagement(d, day.id, engagement.id));
                            toast('Reverted to template', { undo: true });
                        }}
                        onEditTemplate={() => onEditTemplate(engagement.type)}
                    />
                ))}
                {day.engagements.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
                        No engagements on this day yet.
                    </div>
                )}
            </div>

            {/* Add engagement */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-gray-500">Add engagement</span>
                {[...missingDefaults, ...otherTypes].map((type) => (
                    <button
                        key={type}
                        onClick={() => update((d) => addEngagement(d, day.id, type))}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-opacity ${typeColors(type).chip} ${missingDefaults.includes(type) ? '' : 'opacity-60 hover:opacity-100'}`}
                    >
                        <Plus size={12} /> {typeLabel(type)}
                    </button>
                ))}
            </div>
        </div>
    );
}
