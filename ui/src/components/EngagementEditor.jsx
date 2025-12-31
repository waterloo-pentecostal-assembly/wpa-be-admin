import React from 'react';
import { X, Plus } from 'lucide-react';

const EngagementEditor = ({ entry, onChange, onCancel, onSave, onAddScripture, loading }) => {
    // entry: { date, content_type, body: [] }

    // Helper to update top-level fields
    const handleFieldChange = (field, value) => {
        onChange({ ...entry, [field]: value });
    };

    // Helper to add a new body block
    const addBodyBlock = (type) => {
        const newBlock = { body_type: type };
        if (type === 'scripture') {
            newBlock.scriptures = [];
            newBlock.bible_version = "Scripture quotations taken from The Holy Bible, New International Version® NIV®";
            newBlock.attribution = "Copyright © 1973 1978 1984 2011 by Biblica, Inc. TM\nUsed by permission. All rights reserved worldwide";
        } else if (type === 'text') {
            newBlock.paragraphs = [''];
        } else if (type === 'question') {
            newBlock.questions = [''];
        } else if (type === 'link') {
            newBlock.text = '';
            newBlock.link = '';
        }

        onChange({ ...entry, body: [...(entry.body || []), newBlock] });
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
            <div className="w-[600px] bg-white h-full shadow-2xl overflow-y-auto flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-800">Edit Engagement</h2>
                    <div className="flex items-center space-x-2">
                        <button onClick={onCancel} className="px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded text-sm">Cancel</button>
                        <button onClick={onSave} className="px-3 py-1.5 bg-brand text-white hover:bg-brand-600 rounded text-sm font-medium">Done</button>
                    </div>
                </div>

                {/* Form */}
                <div className="p-6 flex-1">
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                            <input
                                type="date"
                                value={entry.date || ''}
                                onChange={(e) => handleFieldChange('date', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-brand"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                            <select
                                value={entry.content_type || 'read'}
                                onChange={(e) => handleFieldChange('content_type', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-brand"
                            >
                                <option value="read">Read</option>
                                <option value="reflect">Reflect</option>
                                <option value="prayer">Prayer</option>
                                <option value="listen">Listen</option>
                                <option value="devotional">Devotional</option>
                                <option value="scribe">Scribe</option>
                                <option value="draw">Draw</option>
                                <option value="memorize">Memorize</option>
                            </select>
                        </div>
                    </div>

                    {/* Body Blocks Area */}
                    <div className="mb-6">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-medium text-gray-900">Body Content</label>
                            <div className="flex space-x-2">
                                <button onClick={() => addBodyBlock('text')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-700">+ Text</button>
                                <button onClick={() => addBodyBlock('scripture')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-700">+ Scripture</button>
                                <button onClick={() => addBodyBlock('question')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-700">+ Question</button>
                                <button onClick={() => addBodyBlock('link')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-700">+ Link</button>
                                <button onClick={() => addBodyBlock('image_input')} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-700">+ Image Input</button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {(!entry.body || entry.body.length === 0) && (
                                <div className="p-8 border-2 border-dashed border-gray-200 rounded text-center text-gray-400 text-sm">
                                    No content added yet. Choose a type above.
                                </div>
                            )}
                            {entry.body?.map((block, idx) => (
                                <div key={idx} className="p-4 border border-gray-200 rounded relative group">
                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 cursor-pointer text-gray-400 hover:text-red-500">
                                        <X size={16} onClick={() => {
                                            const newBody = entry.body.filter((_, i) => i !== idx);
                                            onChange({ ...entry, body: newBody });
                                        }} />
                                    </div>
                                    <span className="text-xs font-bold uppercase text-gray-400 mb-2 block">{block.body_type}</span>

                                    {/* Placeholder for specific block editors */}
                                    <div className="text-sm text-gray-500">
                                        {block.body_type === 'text' && (
                                            <textarea
                                                className="w-full p-2 border rounded text-gray-800"
                                                rows={3}
                                                placeholder="Enter paragraphs..."
                                                value={block.paragraphs?.join('\n\n') || ''}
                                                onChange={(e) => {
                                                    const newBody = [...entry.body];
                                                    newBody[idx].paragraphs = e.target.value.split('\n\n');
                                                    onChange({ ...entry, body: newBody });
                                                }}
                                            />
                                        )}
                                        {block.body_type === 'question' && (
                                            <textarea
                                                className="w-full p-2 border rounded text-gray-800"
                                                rows={3}
                                                placeholder="Enter questions (one per line)..."
                                                value={block.questions?.join('\n') || ''}
                                                onChange={(e) => {
                                                    const newBody = [...entry.body];
                                                    newBody[idx].questions = e.target.value.split('\n');
                                                    onChange({ ...entry, body: newBody });
                                                }}
                                            />
                                        )}
                                        {block.body_type === 'link' && (
                                            <div className="space-y-2">
                                                <input
                                                    className="w-full p-2 border rounded"
                                                    placeholder="Link Text"
                                                    value={block.text || ''}
                                                    onChange={(e) => {
                                                        const newBody = [...entry.body];
                                                        newBody[idx].text = e.target.value;
                                                        onChange({ ...entry, body: newBody });
                                                    }}
                                                />
                                                <input
                                                    className="w-full p-2 border rounded"
                                                    placeholder="URL"
                                                    value={block.link || ''}
                                                    onChange={(e) => {
                                                        const newBody = [...entry.body];
                                                        newBody[idx].link = e.target.value;
                                                        onChange({ ...entry, body: newBody });
                                                    }}
                                                />
                                            </div>
                                        )}
                                        {block.body_type === 'scripture' && (
                                            <div className="bg-gray-50 p-4 rounded text-center border border-dashed border-gray-300">
                                                <div className="mb-3 space-y-1">
                                                    {(block.scriptures || []).map((s, sIdx) => (
                                                        <div key={sIdx} className="text-sm bg-white border px-2 py-1 rounded shadow-sm flex justify-between items-center group/item">
                                                            <span><strong>{s.book} {s.chapter}</strong>: {Object.keys(s.verses).join(', ')} ...</span>
                                                            <div className="flex space-x-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={() => onAddScripture(idx, sIdx)} // Pass sIdx to indicate editing existing
                                                                    className="p-1 text-gray-400 hover:text-brand hover:bg-brand-50 rounded"
                                                                    title="Edit"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        const newBody = [...entry.body];
                                                                        newBody[idx].scriptures.splice(sIdx, 1);
                                                                        onChange({ ...entry, body: newBody });
                                                                    }}
                                                                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                                                                    title="Delete"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={() => onAddScripture(idx, null)}
                                                    className="text-sm text-brand hover:underline flex items-center justify-center space-x-1 mx-auto"
                                                >
                                                    <Plus size={14} />
                                                    <span>Add Scripture Passage</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EngagementEditor;
