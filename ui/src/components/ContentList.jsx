import React from 'react';
import { Calendar, Trash2, ArrowUp, ArrowDown, Edit3 } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';

const ContentList = ({ content, onSelect, onDelete, onMove }) => {
    // Sort content by date (optional, or rely on array order)
    // content is array of { date, content_type, body }

    const formatDate = (dateStr) => {
        if (!dateStr) return 'No Date';
        const date = parseISO(dateStr);
        return isValid(date) ? format(date, 'MMM d, yyyy') : dateStr;
    };

    const getTypeColor = (type) => {
        switch (type) {
            case 'read': return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
            case 'reflect': return 'bg-amber-50 text-amber-700 ring-amber-200';
            case 'prayer': return 'bg-violet-50 text-violet-700 ring-violet-200';
            case 'listen': return 'bg-brand-50 text-brand-700 ring-brand-200';
            case 'devotional': return 'bg-orange-50 text-orange-700 ring-orange-200';
            case 'scribe': return 'bg-teal-50 text-teal-700 ring-teal-200';
            case 'draw': return 'bg-pink-50 text-pink-700 ring-pink-200';
            default: return 'bg-gray-50 text-gray-700 ring-gray-200';
        }
    };

    return (
        <div className="space-y-2">
            {content.map((item, idx) => (
                <div
                    key={idx}
                    className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl hover:border-brand-200 hover:shadow-md transition-all group"
                >
                    <div
                        className="flex-1 min-w-0 cursor-pointer flex items-center gap-4"
                        onClick={() => onSelect(idx)}
                    >
                        <div className="flex items-center justify-center w-11 h-11 bg-gray-50 rounded-lg border border-gray-100 text-gray-400 group-hover:text-brand group-hover:bg-brand-50 group-hover:border-brand-100 transition-colors shrink-0">
                            <Calendar size={20} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className={`text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset uppercase tracking-wider font-bold ${getTypeColor(item.content_type)}`}>
                                    {item.content_type || 'Unknown'}
                                </span>
                                <span className="font-semibold text-ink">{formatDate(item.date)}</span>
                            </div>
                            <div className="text-sm text-gray-500 mt-1 truncate max-w-md">
                                {item.title || (item.body && item.body.length > 0 ? `${item.body.length} block(s) of content` : 'No content')}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                            onClick={() => onMove(idx, -1)}
                            disabled={idx === 0}
                            className="icon-btn p-1.5"
                            title="Move Up"
                        >
                            <ArrowUp size={16} />
                        </button>
                        <button
                            onClick={() => onMove(idx, 1)}
                            disabled={idx === content.length - 1}
                            className="icon-btn p-1.5"
                            title="Move Down"
                        >
                            <ArrowDown size={16} />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-1"></div>
                        <button
                            onClick={() => onSelect(idx)}
                            className="icon-btn p-1.5 hover:bg-brand-50 hover:text-brand"
                            title="Edit"
                        >
                            <Edit3 size={16} />
                        </button>
                        <button
                            onClick={() => onDelete(idx)}
                            className="icon-btn p-1.5 hover:bg-red-50 hover:text-red-600"
                            title="Delete"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            ))}

            {content.length === 0 && (
                <div className="text-center py-10 text-sm text-gray-500 border-2 border-dashed border-gray-200 rounded-xl bg-white/50">
                    No content entries yet. Add one above.
                </div>
            )}
        </div>
    );
};

export default ContentList;
