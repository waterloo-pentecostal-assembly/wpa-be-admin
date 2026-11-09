import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { addDays, startOfWeek, todayIso, weekdayOf } from '../series/dates';
import { ALL_WEEKDAYS } from '../series/draftModel';
import { endDateForCount, generateDates, scheduleWeekdays } from '../series/schedule';
import EngagementPlanGrid from './EngagementPlanGrid';
import SchedulePicker from './SchedulePicker';
import { Dialog } from './ui';

function nextMonday() {
    return addDays(startOfWeek(todayIso()), 7);
}

/**
 * Two steps: (1) name + dates, (2) the engagements each weekday starts with.
 * Everything can be changed later; this just gets a usable draft quickly.
 */
export default function NewSeriesWizard({ onCreate, onClose }) {
    const [step, setStep] = useState(1);
    const [title, setTitle] = useState('');
    const [schedule, setSchedule] = useState(() => {
        const start = nextMonday();
        const base = { start, weekdays: [1, 2, 3, 4, 5], excluded: [], extra: [] };
        return { ...base, end: endDateForCount(base, 40) };
    });
    const [plan, setPlan] = useState(() => ['read', 'reflect', 'prayer'].map((type) => ({ type, weekdays: [...ALL_WEEKDAYS] })));
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);

    const dates = generateDates(schedule);
    const dayCount = dates.length;
    const weekdays = scheduleWeekdays(schedule);

    const create = async () => {
        setCreating(true);
        setError(null);
        try {
            await onCreate({ title: title.trim(), schedule, engagementPlan: plan });
        } catch (e) {
            setError(e.message);
            setCreating(false);
        }
    };

    return (
        <Dialog
            title={step === 1 ? 'New series · dates' : 'New series · engagements by weekday'}
            eyebrow={`Step ${step} of 2`}
            onClose={onClose}
            width="max-w-3xl"
            footer={(
                <>
                    {error && <span className="mr-auto self-center text-sm text-red-600">{error}</span>}
                    {step === 1 ? (
                        <>
                            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" disabled={!title.trim() || !dayCount} onClick={() => setStep(2)}>
                                Next <ArrowRight size={16} />
                            </button>
                        </>
                    ) : (
                        <>
                            <button className="btn btn-ghost" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</button>
                            <button className="btn btn-primary" disabled={creating} onClick={create}>
                                <Check size={16} /> Create {dayCount} days
                            </button>
                        </>
                    )}
                </>
            )}
        >
            {step === 1 ? (
                <div className="space-y-5">
                    <div>
                        <label className="label">Series name</label>
                        <input
                            autoFocus
                            className="input text-base font-semibold"
                            placeholder="e.g. Matthew"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && title.trim() && dayCount && setStep(2)}
                        />
                    </div>
                    <SchedulePicker schedule={schedule} onChange={setSchedule} />
                </div>
            ) : (
                <div>
                    <p className="mb-3 text-sm text-gray-500">
                        Choose the engagements for each weekday. Each one starts from a ready-made template you can edit once for the whole series.
                    </p>
                    <EngagementPlanGrid
                        plan={plan}
                        weekdays={weekdays}
                        dayCount={(w) => dates.filter((d) => weekdayOf(d) === w).length}
                        onToggle={(type, w) => setPlan((p) => p.map((row) => (row.type === type
                            ? { ...row, weekdays: row.weekdays.includes(w) ? row.weekdays.filter((x) => x !== w) : [...row.weekdays, w].sort() }
                            : row)))}
                        onToggleRow={(type, on) => setPlan((p) => p.map((row) => (row.type === type ? { ...row, weekdays: on ? [...ALL_WEEKDAYS] : [] } : row)))}
                        onMove={(type, delta) => setPlan((p) => {
                            const i = p.findIndex((row) => row.type === type);
                            const next = [...p];
                            [next[i], next[i + delta]] = [next[i + delta], next[i]];
                            return next;
                        })}
                        onRemove={(type) => setPlan((p) => p.filter((row) => row.type !== type))}
                        onAdd={(type) => setPlan((p) => [...p, { type, weekdays: [...ALL_WEEKDAYS] }])}
                    />
                </div>
            )}
        </Dialog>
    );
}
