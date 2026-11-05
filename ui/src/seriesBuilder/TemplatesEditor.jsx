import React, { useEffect, useRef } from 'react';
import {
    createTemplate, linkedCount, movePlanType, removeTypeEverywhere, toggleTypeWeekday, updateTemplate, weekdayToggleImpact,
} from '../series/draftModel';
import { WEEKDAY_LONG, weekdayOf } from '../series/dates';
import { typeColors, typeLabel } from '../series/engagementTypes';
import { scheduleWeekdays } from '../series/schedule';
import { BlockList } from './BlockEditor';
import EngagementPlanGrid from './EngagementPlanGrid';
import { TypeChip } from './ui';

/**
 * Series templates: the shared content of each engagement type. Linked
 * engagements on every day render these; blocks marked per-day become the
 * fields filled in on each day.
 */
export default function TemplatesEditor({ draft, update, focusType, toast }) {
    const refs = useRef({});
    useEffect(() => {
        if (focusType) refs.current[focusType]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [focusType]);

    const plan = draft.engagementPlan ?? [];
    const planned = plan.map((p) => p.type);
    const daysWithType = (type) => draft.days.some((d) => d.engagements.some((e) => e.type === type));
    // Templates for planned types, plus any type still used on individual days.
    const types = [
        ...planned.filter((t) => draft.templates[t]),
        ...Object.keys(draft.templates).filter((t) => !planned.includes(t) && daysWithType(t)),
    ];
    const weekdays = scheduleWeekdays(draft.schedule);
    const daysWith = (type) => draft.days.filter((d) => d.engagements.some((e) => e.type === type)).length;

    const toggle = (type, weekday) => {
        const impact = weekdayToggleImpact(draft, type, weekday);
        update((d) => toggleTypeWeekday(d, type, weekday));
        const where = `${impact.count} ${WEEKDAY_LONG[weekday]}${impact.count === 1 ? '' : 's'}`;
        toast(impact.adding
            ? `Added ${typeLabel(type)} to ${where}`
            : `Removed ${typeLabel(type)} from ${where}${impact.withContent ? ` (${impact.withContent} had content)` : ''}`, { undo: true });
    };

    const toggleRow = (type, on) => {
        const row = plan.find((p) => p.type === type);
        const changes = weekdays.filter((w) => (row?.weekdays.includes(w) ?? false) !== on);
        update((d) => changes.reduce((acc, w) => toggleTypeWeekday(acc, type, w), d));
        toast(on ? `Added ${typeLabel(type)} to every weekday` : `Removed ${typeLabel(type)} from every weekday`, { undo: true });
    };

    return (
        <div className="mx-auto max-w-3xl px-6 py-5">
            <p className="eyebrow">Templates</p>
            <h2 className="text-xl font-bold text-ink">Shared engagement content</h2>
            <p className="mt-1 mb-5 text-sm text-gray-500">
                Every day using a template shows this content, with <code className="rounded bg-gray-100 px-1">{'{scripture}'}</code> replaced by that day’s scripture.
                Mark a block <span className="font-semibold text-brand">per-day</span> to fill it in on each day (e.g. prayer points or a song link).
            </p>

            <section className="mb-6">
                <h3 className="mb-2 text-sm font-bold text-ink">Engagements by weekday</h3>
                <EngagementPlanGrid
                    plan={plan}
                    weekdays={weekdays}
                    typeCount={daysWith}
                    dayCount={(w) => draft.days.filter((d) => weekdayOf(d.date) === w).length}
                    onToggle={toggle}
                    onToggleRow={toggleRow}
                    onMove={(type, delta) => update((d) => movePlanType(d, type, delta))}
                    onRemove={(type) => {
                        update((d) => removeTypeEverywhere(d, type));
                        toast(`Removed ${typeLabel(type)} from every day`, { undo: true });
                    }}
                    onAdd={(type) => toggleRow(type, true)}
                />
            </section>

            <div className="space-y-6">
                {types.map((type) => {
                    const template = draft.templates[type];
                    const used = linkedCount(draft, type);
                    const total = draft.days.filter((d) => d.engagements.some((e) => e.type === type)).length;
                    return (
                        <section key={type} ref={(el) => { refs.current[type] = el; }} className={`card border-l-4 ${typeColors(type).bar} scroll-mt-4 ${focusType === type ? 'ring-2 ring-brand-200' : ''}`}>
                            <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
                                <TypeChip type={type} />
                                <span className="text-xs text-gray-500">
                                    On {total} of {draft.days.length} days{total > used ? ` · ${total - used} customized` : ''}
                                </span>
                            </header>
                            <div className="space-y-3 p-4">
                                <input
                                    className="input text-sm"
                                    placeholder="Engagement title (optional, usually blank)"
                                    value={template.title ?? ''}
                                    onChange={(e) => update((d) => updateTemplate(d, type, (t) => ({ ...t, title: e.target.value })), { coalesce: `tpl:${type}:title` })}
                                />
                                <BlockList
                                    templateMode
                                    blocks={template.blocks}
                                    onChange={(blocks, coalesce) => update((d) => updateTemplate(d, type, (t) => ({ ...t, blocks })), { coalesce: coalesce ? `tpl:${coalesce}` : null })}
                                />
                                <div className="text-right">
                                    <button
                                        className="text-xs text-gray-400 hover:text-gray-700"
                                        onClick={() => {
                                            update((d) => updateTemplate(d, type, () => createTemplate(type)));
                                            toast(`Reset ${typeLabel(type)} template`, { undo: true });
                                        }}
                                    >
                                        Reset to default
                                    </button>
                                </div>
                            </div>
                        </section>
                    );
                })}
            </div>

        </div>
    );
}
