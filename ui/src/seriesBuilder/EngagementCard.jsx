import React, { useState, useRef, useEffect } from 'react';
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Link2, Unlink, Trash2, Pencil, AlertTriangle } from 'lucide-react';
import { effectiveBlocks, effectiveTitle } from '../series/draftModel';
import { SCRIPTURE_TOKEN, typeColors } from '../series/engagementTypes';
import { BlockContentEditor, BlockList } from './BlockEditor';
import { TypeChip } from './ui';

function Menu({ items }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    return (
        <div className="relative" ref={ref}>
            <button className="icon-btn p-1.5" onClick={() => setOpen((o) => !o)} title="More actions"><MoreHorizontal size={16} /></button>
            {open && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    {items.filter(Boolean).map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.label}
                                onClick={() => {
                                    setOpen(false);
                                    item.onClick();
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}
                            >
                                <Icon size={15} /> {item.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function substitute(text, label) {
    if (!text) return text;
    return label ? text.split(SCRIPTURE_TOKEN).join(label) : text;
}

/** Read-only rendering of a fixed template block inside a linked card. */
function TemplateBlockPreview({ block, readingLabel }) {
    switch (block.kind) {
        case 'text':
        case 'question': {
            const lines = (block.text ?? '').split('\n').filter((l) => l.trim());
            const missingReading = !readingLabel && (block.text ?? '').includes(SCRIPTURE_TOKEN);
            return (
                <div className={`text-sm ${missingReading ? 'text-amber-700' : 'text-gray-600'}`}>
                    {block.title && <p className="font-semibold text-gray-700">{block.title}</p>}
                    {block.kind === 'question' ? (
                        <ol className="list-decimal pl-5 space-y-0.5">
                            {/* Clamp an inner element: line-clamp on the <li> replaces display: list-item and hides the number. */}
                            {lines.map((l, i) => <li key={i}><span className="line-clamp-1">{substitute(l, readingLabel)}</span></li>)}
                        </ol>
                    ) : (
                        lines.map((l, i) => <p key={i} className="line-clamp-2">{substitute(l, readingLabel)}</p>)
                    )}
                </div>
            );
        }
        case 'scripture':
            return (
                <p className="text-sm">
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                        {block.source === 'reading' ? (readingLabel || <span className="text-amber-700">Day’s scripture not set</span>) : block.ref}
                    </span>
                </p>
            );
        case 'link':
            return <p className="text-sm text-brand underline truncate">{block.text || block.url}</p>;
        case 'image_input':
            return <p className="text-sm text-gray-400">📷 Photo upload</p>;
        default:
            return null;
    }
}

/**
 * One engagement on one day. Linked engagements show the template (muted)
 * with only their per-day fields editable; custom ones are fully editable.
 */
export default function EngagementCard({
    draft,
    engagement,
    readingLabel,
    issues,
    index,
    count,
    onValueChange,
    onCustomChange,
    onMove,
    onRemove,
    onCopy,
    onDetach,
    onRelink,
    onEditTemplate,
    autoFocusFirstField,
}) {
    const colors = typeColors(engagement.type);
    const blocks = effectiveBlocks(draft, engagement);
    const template = draft.templates[engagement.type];
    const perDay = engagement.linked ? (template?.blocks ?? []).filter((b) => b.perDay) : [];
    const firstPerDayId = perDay[0]?.id;
    const errorCount = issues.filter((i) => i.level === 'error').length;

    return (
        <section className={`card border-l-4 ${colors.bar} overflow-visible`}>
            <header className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
                <TypeChip type={engagement.type} />
                {engagement.linked ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400" title="Uses the series template">
                        <Link2 size={12} /> Template
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600" title="Custom content for this day only">
                        <Unlink size={12} /> Custom
                    </span>
                )}
                {issues.length > 0 && (
                    <span
                        className={`inline-flex items-center gap-1 text-xs ${errorCount ? 'text-red-600' : 'text-amber-600'}`}
                        title={issues.map((i) => i.message).join('\n')}
                    >
                        <AlertTriangle size={12} /> {issues.length}
                    </span>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                    <button className="icon-btn p-1.5" onClick={onCopy} title="Copy to other days…"><Copy size={15} /></button>
                    <button className="icon-btn p-1.5" disabled={index === 0} onClick={() => onMove(-1)} title="Move up"><ArrowUp size={15} /></button>
                    <button className="icon-btn p-1.5" disabled={index === count - 1} onClick={() => onMove(1)} title="Move down"><ArrowDown size={15} /></button>
                    <Menu
                        items={[
                            { label: 'Copy to other days…', icon: Copy, onClick: onCopy },
                            engagement.linked
                                ? { label: 'Customize this day only', icon: Unlink, onClick: onDetach }
                                : { label: 'Revert to template', icon: Link2, onClick: onRelink },
                            { label: 'Edit template', icon: Pencil, onClick: onEditTemplate },
                            { label: 'Remove from this day', icon: Trash2, onClick: onRemove, danger: true },
                        ]}
                    />
                </div>
            </header>

            <div className="px-4 py-3 space-y-3">
                {engagement.linked ? (
                    <>
                        {effectiveTitle(draft, engagement) && <p className="text-sm font-semibold text-gray-700">{effectiveTitle(draft, engagement)}</p>}
                        {blocks.map((block) => {
                            const templateBlock = template.blocks.find((b) => b.id === block.id);
                            if (!templateBlock?.perDay) {
                                return <TemplateBlockPreview key={block.id} block={block} readingLabel={readingLabel} />;
                            }
                            return (
                                <div key={block.id}>
                                    <BlockContentEditor
                                        block={{ ...block, kind: templateBlock.kind, source: templateBlock.source }}
                                        readingLabel={readingLabel}
                                        placeholder={templateBlock.placeholder || undefined}
                                        coalesceKey={`${engagement.id}:${block.id}`}
                                        autoFocus={autoFocusFirstField && block.id === firstPerDayId}
                                        onChange={(patch, coalesce) => onValueChange(block.id, patch, coalesce)}
                                    />
                                </div>
                            );
                        })}
                        {!perDay.length && blocks.length === 0 && <p className="text-sm text-gray-400">The template is empty.</p>}
                    </>
                ) : (
                    <>
                        <input
                            className="input text-sm"
                            placeholder="Engagement title (optional)"
                            value={engagement.title ?? ''}
                            onChange={(e) => onCustomChange({ title: e.target.value }, `${engagement.id}:title`)}
                        />
                        <BlockList
                            blocks={engagement.blocks}
                            readingLabel={readingLabel}
                            onChange={(nextBlocks, coalesce) => onCustomChange({ blocks: nextBlocks }, coalesce)}
                        />
                    </>
                )}
            </div>
        </section>
    );
}
