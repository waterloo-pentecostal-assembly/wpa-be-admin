import React from 'react';
import { Loader2 } from 'lucide-react';
import { FLAG_LABELS } from './useSeriesFlags';

// A published series' is_active / is_visible, set straight on the series in
// the app (not through a draft). Making a series active starts the app's
// automation in Firebase: every other series is made inactive and
// notifications go out to all users (join a group, the new series is starting).

const FLAG_HINTS = {
    is_active: 'The current series in the app. Making a series active makes every other series inactive and sends notifications to all users.',
    is_visible: 'Shown in the app’s series list',
};

/** A small on/off switch; doesn't open the card or row it sits in. */
export function FlagSwitch({ label, on, onToggle, disabled = false, busy = false, title, tone = 'brand' }) {
    const track = on ? (tone === 'emerald' ? 'bg-emerald-500' : 'bg-brand') : 'bg-gray-300';
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            disabled={disabled || busy}
            title={title}
            onClick={(e) => {
                e.stopPropagation();
                onToggle(!on);
            }}
            className="inline-flex items-center gap-1.5 rounded-full py-0.5 text-xs font-semibold text-gray-600 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
            <span className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${track}`}>
                <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </span>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {label}
        </button>
    );
}

/** "Active" / "Hidden" badges for a series. */
export function FlagBadges({ series }) {
    return (
        <>
            {series.is_active && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Active</span>}
            {!series.is_visible && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">Hidden</span>}
        </>
    );
}

/** Active and Visible switches for one published series (`series` has id, title, is_active, is_visible). */
export function SeriesFlagSwitches({ series, flags, disabled = false }) {
    return (
        <span className="inline-flex items-center gap-3">
            {['is_active', 'is_visible'].map((flag) => (
                <FlagSwitch
                    key={flag}
                    label={FLAG_LABELS[flag]}
                    on={!!series[flag]}
                    tone={flag === 'is_active' ? 'emerald' : 'brand'}
                    title={FLAG_HINTS[flag]}
                    disabled={disabled || !!flags.pending}
                    busy={flags.pending === `${series.id}:${flag}`}
                    onToggle={(value) => flags.change(series, flag, value)}
                />
            ))}
        </span>
    );
}
