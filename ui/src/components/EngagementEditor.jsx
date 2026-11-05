import React from 'react';
import { X, Plus, Pencil } from 'lucide-react';

const EngagementEditor = ({ entry, onChange, onCancel, onSave, onAddScripture }) => {
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

    const blockTypes = [
        { type: 'text', label: 'Text' },
        { type: 'scripture', label: 'Scripture' },
        { type: 'question', label: 'Question' },
        { type: 'link', label: 'Link' },
        { type: 'image_input', label: 'Image Input' },
    ];

    return (
        <div className="fixed inset-0 bg-ink/50 backdrop-blur-[2px] flex justify-end z-50">
            <div className="w-full max-w-[640px] bg-white h-full shadow-2xl flex flex-col animate-slide-in">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-4 shrink-0">
                    <div>
                        <p className="eyebrow">Content Entry</p>
                        <h2 className="text-lg font-bold text-ink">Edit Engagement</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
                        <button onClick={onSave} className="btn btn-primary">Done</button>
                    </div>
                </div>

                {/* Form */}
                <div className="p-6 flex-1 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div>
                            <label className="label">Date</label>
                            <input
                                type="date"
                                value={entry.date || ''}
                                onChange={(e) => handleFieldChange('date', e.target.value)}
                                className="input"
                            />
                        </div>
                        <div>
                            <label className="label">Type</label>
                            <select
                                value={entry.content_type || 'read'}
                                onChange={(e) => handleFieldChange('content_type', e.target.value)}
                                className="input"
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
                        <div className="mb-3">
                            <h3 className="section-label mb-2">Body Content</h3>
                            <div className="flex flex-wrap gap-2">
                                {blockTypes.map(({ type, label }) => (
                                    <button
                                        key={type}
                                        onClick={() => addBodyBlock(type)}
                                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 transition-colors"
                                    >
                                        <Plus size={12} />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3">
                            {(!entry.body || entry.body.length === 0) && (
                                <div className="p-8 border-2 border-dashed border-gray-200 rounded-xl text-center text-gray-400 text-sm">
                                    No content added yet. Choose a type above.
                                </div>
                            )}
                            {entry.body?.map((block, idx) => (
                                <div key={idx} className="p-4 border border-gray-200 rounded-xl bg-white relative group hover:border-gray-300 transition-colors">
                                    <button
                                        className="absolute top-2.5 right-2.5 icon-btn p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 hover:text-red-500"
                                        title="Remove block"
                                        onClick={() => {
                                            const newBody = entry.body.filter((_, i) => i !== idx);
                                            onChange({ ...entry, body: newBody });
                                        }}
                                    >
                                        <X size={16} />
                                    </button>
                                    <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-brand-700 bg-brand-50 rounded-full px-2 py-0.5 mb-3">{block.body_type}</span>

                                    {/* Placeholder for specific block editors */}
                                    <div className="text-sm text-gray-500">
                                        {block.body_type === 'text' && (
                                            <textarea
                                                className="input"
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
                                                className="input"
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
                                                    className="input"
                                                    placeholder="Link Text"
                                                    value={block.text || ''}
                                                    onChange={(e) => {
                                                        const newBody = [...entry.body];
                                                        newBody[idx].text = e.target.value;
                                                        onChange({ ...entry, body: newBody });
                                                    }}
                                                />
                                                <input
                                                    className="input"
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
                                            <div className="bg-gray-50 p-3 rounded-lg border border-dashed border-gray-300">
                                                {(block.scriptures || []).length > 0 && (
                                                    <div className="mb-3 space-y-1.5">
                                                        {(block.scriptures || []).map((s, sIdx) => (
                                                            <div key={sIdx} className="text-sm text-gray-700 bg-white border border-gray-200 px-3 py-2 rounded-lg shadow-xs flex justify-between items-center gap-3 group/item">
                                                                <span className="min-w-0">
                                                                    {s.title && <span className="font-semibold text-brand block">{s.title}</span>}
                                                                    <strong className="text-ink">{s.book} {s.chapter}</strong>: {Object.keys(s.verses).join(', ')} ...
                                                                </span>
                                                                <div className="flex gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100 transition-opacity">
                                                                    <button
                                                                        onClick={() => onAddScripture(idx, sIdx)} // Pass sIdx to indicate editing existing
                                                                        className="icon-btn p-1 hover:text-brand hover:bg-brand-50"
                                                                        title="Edit"
                                                                    >
                                                                        <Pencil size={14} />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            const newBody = [...entry.body];
                                                                            newBody[idx].scriptures.splice(sIdx, 1);
                                                                            onChange({ ...entry, body: newBody });
                                                                        }}
                                                                        className="icon-btn p-1 hover:text-red-500 hover:bg-red-50"
                                                                        title="Delete"
                                                                    >
                                                                        <X size={14} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => onAddScripture(idx, null)}
                                                    className="btn btn-ghost-brand btn-sm mx-auto flex"
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
