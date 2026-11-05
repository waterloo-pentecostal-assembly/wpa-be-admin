import React, { useState } from 'react';
import { applySchedule, dayHasContent, scheduleChangeImpact } from '../series/draftModel';
import { formatShort } from '../series/dates';
import { normalizeSchedule } from '../series/schedule';
import SchedulePicker from './SchedulePicker';
import { Dialog } from './ui';

/** Edits an existing draft's schedule, asking how to treat existing content when dates change. */
export default function ScheduleDialog({ draft, update, onClose, toast }) {
    const [schedule, setSchedule] = useState(draft.schedule);
    const [confirming, setConfirming] = useState(null);

    const apply = (strategy) => {
        update((d) => applySchedule(d, schedule, strategy));
        toast('Schedule updated', { undo: true });
        onClose();
    };

    const onSave = () => {
        if (JSON.stringify(normalizeSchedule(schedule)) === JSON.stringify(normalizeSchedule(draft.schedule))) {
            onClose();
            return;
        }
        const impact = scheduleChangeImpact(draft, schedule);
        if (!impact.newCount) return;
        // Only ask when the two strategies would place existing content differently.
        const byOrder = applySchedule(draft, schedule, 'order');
        const contentStays = draft.days.every((d, i) => !dayHasContent(d) || byOrder.days[i]?.date === d.date);
        if (!impact.datesChanged || contentStays) {
            apply('order');
            return;
        }
        setConfirming(impact);
    };

    const lostList = (days) => days.slice(0, 6).map((d) => formatShort(d.date)).join(', ') + (days.length > 6 ? ` +${days.length - 6} more` : '');

    return (
        <Dialog
            title="Schedule"
            eyebrow="Series dates"
            onClose={onClose}
            width="max-w-3xl"
            footer={confirming ? (
                <button className="btn btn-ghost" onClick={() => setConfirming(null)}>Back</button>
            ) : (
                <>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={onSave}>Apply schedule</button>
                </>
            )}
        >
            {confirming ? (
                <div className="space-y-3">
                    <p className="text-sm text-gray-600">The dates changed. What should happen to the content you already entered?</p>
                    <button className="w-full rounded-xl border border-gray-200 p-4 text-left hover:border-brand hover:bg-brand-50" onClick={() => apply('order')}>
                        <div className="font-semibold text-ink">Keep the sequence</div>
                        <div className="text-sm text-gray-500">Day 1 stays day 1, day 2 stays day 2… content moves to the new dates. Best when the start date moved.</div>
                        {confirming.lostByOrder.length > 0 && (
                            <div className="mt-1 text-xs text-red-600">Drops {confirming.lostByOrder.length} day(s) with content at the end: {lostList(confirming.lostByOrder)}</div>
                        )}
                    </button>
                    <button className="w-full rounded-xl border border-gray-200 p-4 text-left hover:border-brand hover:bg-brand-50" onClick={() => apply('date')}>
                        <div className="font-semibold text-ink">Keep content on its dates</div>
                        <div className="text-sm text-gray-500">Days that are still in the schedule keep their content; new dates start empty. Best when skipping a holiday.</div>
                        {confirming.lostByDate.length > 0 && (
                            <div className="mt-1 text-xs text-red-600">Drops {confirming.lostByDate.length} day(s) with content: {lostList(confirming.lostByDate)}</div>
                        )}
                    </button>
                    <p className="text-xs text-gray-400">You can undo either choice with Ctrl+Z.</p>
                </div>
            ) : (
                <SchedulePicker schedule={schedule} onChange={setSchedule} />
            )}
        </Dialog>
    );
}
