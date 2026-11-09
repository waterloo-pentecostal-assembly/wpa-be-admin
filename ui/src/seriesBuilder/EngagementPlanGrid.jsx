import React from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { WEEKDAY_SHORT } from '../series/dates';
import { ENGAGEMENT_TYPES, typeColors, typeLabel } from '../series/engagementTypes';
import { TypeChip } from './ui';

/**
 * Which engagements each weekday has: one row per engagement type, one
 * column per weekday the series meets. E.g. Devotional ticked only under Mon.
 *
 * `plan` = [{ type, weekdays }]. `dayCount(weekday)` (optional) shows how
 * many days each column covers; `typeCount(type)` how many days a row covers.
 */
export default function EngagementPlanGrid({ plan, weekdays, onToggle, onToggleRow, onMove, onRemove, onAdd, dayCount, typeCount }) {
    const unused = ENGAGEMENT_TYPES.map((t) => t.id).filter((id) => !plan.some((p) => p.type === id));
    return (
        <div>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-100 text-xs text-gray-500">
                            <th className="px-3 py-2 text-left font-semibold">Engagement</th>
                            {weekdays.map((w) => (
                                <th key={w} className="w-14 px-1 py-2 text-center font-semibold">
                                    {WEEKDAY_SHORT[w]}
                                    {dayCount && <div className="text-[10px] font-normal text-gray-400">{dayCount(w)} days</div>}
                                </th>
                            ))}
                            <th className="w-24 px-2 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {plan.map(({ type, weekdays: on }, index) => {
                            const all = weekdays.every((w) => on.includes(w));
                            return (
                                <tr key={type} className="border-b border-gray-50 last:border-0">
                                    <td className="px-3 py-1.5">
                                        <button
                                            type="button"
                                            onClick={() => onToggleRow(type, !all)}
                                            className="flex items-center gap-2"
                                            title={all ? 'Remove from every weekday' : 'Add to every weekday'}
                                        >
                                            <TypeChip type={type} />
                                            {typeCount && <span className="text-xs text-gray-400">{typeCount(type)} days</span>}
                                        </button>
                                    </td>
                                    {weekdays.map((w) => {
                                        const checked = on.includes(w);
                                        return (
                                            <td key={w} className="px-1 py-1.5 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => onToggle(type, w)}
                                                    aria-pressed={checked}
                                                    title={`${typeLabel(type)} on ${WEEKDAY_SHORT[w]}`}
                                                    className={`h-7 w-9 rounded-md text-xs font-bold transition-colors ${checked ? `${typeColors(type).dot} text-white` : 'bg-gray-100 text-gray-300 hover:bg-gray-200'}`}
                                                >
                                                    {checked ? '✓' : ''}
                                                </button>
                                            </td>
                                        );
                                    })}
                                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                        <button type="button" className="icon-btn p-1" disabled={index === 0} onClick={() => onMove(type, -1)} title="Move up"><ArrowUp size={14} /></button>
                                        <button type="button" className="icon-btn p-1" disabled={index === plan.length - 1} onClick={() => onMove(type, 1)} title="Move down"><ArrowDown size={14} /></button>
                                        <button type="button" className="icon-btn p-1 hover:bg-red-50 hover:text-red-600" onClick={() => onRemove(type)} title="Remove from every day"><X size={14} /></button>
                                    </td>
                                </tr>
                            );
                        })}
                        {!plan.length && (
                            <tr><td colSpan={weekdays.length + 2} className="px-3 py-4 text-center text-sm text-gray-400">No engagements yet. Add one below.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            {unused.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs font-semibold text-gray-500">Add</span>
                    {unused.map((type) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => onAdd(type)}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset opacity-70 hover:opacity-100 ${typeColors(type).chip}`}
                        >
                            <Plus size={12} /> {typeLabel(type)}
                        </button>
                    ))}
                </div>
            )}
            <p className="mt-2 text-xs text-gray-400">Click a box to turn an engagement on or off for that weekday, or click its name for every weekday. Single days can still be changed in the day editor.</p>
        </div>
    );
}
