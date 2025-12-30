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
            case 'read': return 'bg-green-100 text-green-800 border-green-200';
            case 'reflect': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'prayer': return 'bg-purple-100 text-purple-800 border-purple-200';
            case 'listen': return 'bg-blue-50 text-brand border-blue-200';
            case 'devotional': return 'bg-orange-100 text-orange-800 border-orange-200';
            case 'scribe': return 'bg-teal-100 text-teal-800 border-teal-200';
            case 'draw': return 'bg-pink-100 text-pink-800 border-pink-200';
            default: return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    return (
        <div className="space-y-3">
            {content.map((item, idx) => (
                <div
                    key={idx}
                    className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow group"
                >
                    <div
                        className="flex-1 cursor-pointer flex items-center space-x-4"
                        onClick={() => onSelect(idx)}
                    >
                        <div className="flex flex-col items-center justify-center w-12 h-12 bg-gray-50 rounded-md border border-gray-100 text-gray-500">
                            <Calendar size={20} />
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full border uppercase tracking-wider font-semibold ${getTypeColor(item.content_type)}`}>
                                    {item.content_type || 'Unknown'}
                                </span>
                                <span className="font-medium text-gray-900">{formatDate(item.date)}</span>
                            </div>
                            <div className="text-sm text-gray-500 mt-1 truncate max-w-md">
                                {item.title || (item.body && item.body.length > 0 ? `${item.body.length} block(s) of content` : 'No content')}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => onMove(idx, -1)}
                            disabled={idx === 0}
                            className="p-1.5 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-30"
                            title="Move Up"
                        >
                            <ArrowUp size={16} />
                        </button>
                        <button
                            onClick={() => onMove(idx, 1)}
                            disabled={idx === content.length - 1}
                            className="p-1.5 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-30"
                            title="Move Down"
                        >
                            <ArrowDown size={16} />
                        </button>
                        <div className="w-px h-6 bg-gray-200 mx-1"></div>
                        <button
                            onClick={() => onSelect(idx)}
                            className="p-1.5 hover:bg-brand-50 hover:text-brand rounded text-gray-500"
                            title="Edit"
                        >
                            <Edit3 size={16} />
                        </button>
                        <button
                            onClick={() => onDelete(idx)}
                            className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded text-gray-500"
                            title="Delete"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            ))}

            {content.length === 0 && (
                <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
                    No content entries yet. Add one above.
                </div>
            )}
        </div>
    );
};

export default ContentList;
