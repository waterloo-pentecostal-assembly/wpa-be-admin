// Saved message templates for the Notification Hub: a bar to load, save and
// update them, and dialogs to name and manage them. Templates live in the
// selected environment's Firestore (admin_notification_templates).
import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Check, ChevronDown, FileText, Loader2, Pencil, Save, Search, Settings2, Trash2, Users, X } from 'lucide-react';
import { Dialog } from '../seriesBuilder/ui';
import { RelativeTime } from '../users/shared';

// A search box appears in the menu once there are more templates than this.
const SEARCH_FROM = 6;

/**
 * A full-width dropdown showing the loaded template, with a save button
 * beside it; once the loaded template has been edited, a bar under it
 * offers to update it or save a new one. `dirty` is whether the form
 * differs from the loaded template; `canSave` whether the message is
 * complete enough to save.
 */
export function TemplatesBar({ templates, error, loadedId, dirty, canSave, describeAudience, onLoad, onSaveNew, onUpdate, onManage }) {
    const loaded = templates?.find((t) => t.id === loadedId) ?? null;
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const buttonRef = useRef(null);

    // Clicking elsewhere closes the menu.
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const close = () => {
        setOpen(false);
        buttonRef.current?.focus();
    };

    const label = templates === null
        ? <span className="text-gray-400">Loading templates…</span>
        : loaded
            ? <span className="font-semibold text-ink">{loaded.name}</span>
            : <span className="text-gray-500">{templates.length ? 'Start from a saved template' : 'No saved templates yet'}</span>;

    return (
        <div>
            <div className="flex items-stretch gap-2">
                <div ref={rootRef} className="relative min-w-0 flex-1">
                    <button
                        ref={buttonRef}
                        type="button"
                        aria-haspopup="listbox"
                        aria-expanded={open}
                        aria-label={loaded ? `Template: ${loaded.name}. Choose another template` : 'Choose a saved template'}
                        disabled={templates === null}
                        onClick={() => setOpen((o) => !o)}
                        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
                        className={`flex w-full items-center gap-2.5 rounded-lg border bg-white px-3 py-2 text-left text-sm shadow-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${open ? 'border-brand ring-2 ring-brand/20' : 'border-gray-300 hover:border-gray-400'}`}
                    >
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${loaded ? 'bg-brand text-white' : 'bg-brand-50 text-brand'}`}>
                            <FileText size={14} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                        <TemplateMenu
                            templates={templates}
                            loadedId={loadedId}
                            describeAudience={describeAudience}
                            canSave={canSave}
                            onPick={(t) => { close(); onLoad(t); }}
                            onSaveNew={() => { setOpen(false); onSaveNew(); }}
                            onManage={() => { setOpen(false); onManage(); }}
                            onClose={close}
                        />
                    )}
                </div>
                <button
                    type="button"
                    onClick={onSaveNew}
                    disabled={!canSave}
                    aria-label="Save as template"
                    title={canSave ? 'Save this message as a new template' : 'Enter a title and message to save a template'}
                    className="flex w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-brand shadow-xs transition-colors hover:border-brand hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:border-gray-300 disabled:hover:bg-white"
                >
                    <BookmarkPlus size={17} />
                </button>
            </div>
            {loaded && dirty && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="flex-1 whitespace-nowrap">Changed from the saved template</span>
                    <span className="flex items-center gap-1.5">
                        <button type="button" className="btn btn-secondary btn-sm py-1" disabled={!canSave} onClick={onUpdate} title={`Save these changes to "${loaded.name}"`}>
                            <Save size={13} /> Update
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm py-1 text-amber-900 hover:bg-amber-100" disabled={!canSave} onClick={onSaveNew}>
                            Save as new
                        </button>
                    </span>
                </div>
            )}
            {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        </div>
    );
}

/** The dropdown list: search (when there are many), templates, and Manage. */
function TemplateMenu({ templates, loadedId, describeAudience, canSave, onPick, onSaveNew, onManage, onClose }) {
    const [query, setQuery] = useState('');
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = templates.filter((t) => terms.every((term) => `${t.name} ${t.title} ${t.body}`.toLowerCase().includes(term)));
    const [active, setActive] = useState(() => Math.max(0, shown.findIndex((t) => t.id === loadedId)));
    const searchRef = useRef(null);
    const listRef = useRef(null);
    const index = Math.min(active, Math.max(0, shown.length - 1));

    useEffect(() => {
        (searchRef.current ?? listRef.current)?.focus();
    }, []);
    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [index]);

    const onKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(index + 1, shown.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(index - 1, 0)); }
        else if (e.key === 'Enter' && shown[index]) { e.preventDefault(); onPick(shown[index]); }
    };

    return (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl animate-pop-in" onKeyDown={onKeyDown}>
            {templates.length >= SEARCH_FROM && (
                <div className="relative border-b border-gray-100 p-2">
                    <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input ref={searchRef} className="input py-1.5 pl-8 text-sm" placeholder="Search templates…" value={query}
                        onChange={(e) => { setQuery(e.target.value); setActive(0); }} aria-label="Search templates" />
                </div>
            )}
            {templates.length === 0 ? (
                <div className="px-4 py-5 text-center text-sm text-gray-500">
                    <p className="font-medium text-gray-700">No saved templates yet</p>
                    <p className="mt-1 text-xs">Write a message, then save it here to reuse it.</p>
                </div>
            ) : (
                <ul ref={listRef} role="listbox" tabIndex={-1} aria-label="Saved templates" className="max-h-72 overflow-y-auto py-1 focus:outline-none">
                    {shown.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No templates match.</li>}
                    {shown.map((t, i) => {
                        const selected = t.id === loadedId;
                        return (
                            <li
                                key={t.id}
                                role="option"
                                aria-selected={selected}
                                data-index={i}
                                onMouseEnter={() => setActive(i)}
                                onClick={() => onPick(t)}
                                className={`mx-1 flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 ${i === index ? 'bg-brand-50' : ''}`}
                            >
                                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-brand">{selected && <Check size={15} />}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-ink">{t.name}</span>
                                    <span className="block truncate text-xs text-gray-500">{t.title}</span>
                                    {t.audience && (
                                        <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                                            <Users size={11} className="shrink-0" /><span className="truncate">{describeAudience(t.audience)}</span>
                                        </span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
            <div className="flex border-t border-gray-100 bg-gray-50 text-sm font-semibold">
                <button type="button" onClick={onSaveNew} disabled={!canSave}
                    title={canSave ? undefined : 'Enter a title and message first'}
                    className="flex flex-1 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-left text-brand hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent">
                    <BookmarkPlus size={15} /> Save as template
                </button>
                {templates.length > 0 && (
                    <button type="button" onClick={onManage}
                        className="flex items-center gap-2 whitespace-nowrap border-l border-gray-100 px-4 py-2.5 text-gray-600 hover:bg-gray-100 hover:text-ink">
                        <Settings2 size={15} /> Manage
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * Names a new template, or renames/updates the loaded one. Group audiences
 * can be saved with it; lists of users and tokens can't.
 */
export function TemplateDialog({ mode, initialName = '', initialIncludeAudience = false, audienceLabel, canSaveAudience, onClose, onSave }) {
    const [name, setName] = useState(initialName);
    const [includeAudience, setIncludeAudience] = useState(canSaveAudience && initialIncludeAudience);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (e) => {
        e?.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await onSave({ name: name.trim(), includeAudience });
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    return (
        <Dialog
            title={mode === 'update' ? 'Update template' : 'Save as template'}
            onClose={busy ? () => {} : onClose}
            width="max-w-md"
            footer={(
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {mode === 'update' ? 'Save changes' : 'Save template'}
                    </button>
                </>
            )}
        >
            <form onSubmit={submit} className="space-y-4 text-sm">
                <div>
                    <label className="label" htmlFor="template-name">Name</label>
                    <input id="template-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus
                        placeholder="e.g. Weekly catch-up reminder" />
                </div>
                <p className="text-gray-600">Saves the title, message (with its placeholders) and data payload.</p>
                {canSaveAudience ? (
                    <label className="flex items-start gap-2.5">
                        <input type="checkbox" className="checkbox mt-0.5" checked={includeAudience} onChange={(e) => setIncludeAudience(e.target.checked)} />
                        <span>
                            <span className="font-medium text-gray-800">Also save the audience</span>
                            <span className="block text-xs text-gray-500">{audienceLabel}. Loading the template selects it again.</span>
                        </span>
                    </label>
                ) : (
                    <p className="text-xs text-gray-500">
                        Recipients aren&apos;t saved: only groups (such as Behind on series) can be saved with a template, not lists of users or tokens.
                        {mode === 'update' && initialIncludeAudience && ' Saving removes the audience this template had.'}
                    </p>
                )}
                {error && <p className="text-red-600">{error}</p>}
            </form>
        </Dialog>
    );
}

/** Lists templates to load, rename or delete. */
export function ManageTemplatesDialog({ templates, describeAudience, onClose, onLoad, onRename, onDelete }) {
    const [editing, setEditing] = useState(null); // { id, name }
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);

    const run = async (id, action) => {
        setBusy(id);
        setError(null);
        try {
            await action();
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            setBusy(null);
        }
    };

    return (
        <Dialog title="Saved templates" onClose={onClose} width="max-w-2xl" bodyClassName="p-0">
            {error && <p className="px-6 pt-4 text-sm text-red-600">{error}</p>}
            {templates.length === 0 && <p className="px-6 py-6 text-sm text-gray-500">No saved templates.</p>}
            <ul className="divide-y divide-gray-100">
                {templates.map((t) => (
                    <li key={t.id} className="flex items-start gap-4 px-6 py-3">
                        <div className="min-w-0 flex-1">
                            {editing?.id === t.id ? (
                                <form
                                    className="flex items-center gap-2"
                                    onSubmit={async (e) => {
                                        e.preventDefault();
                                        if (await run(t.id, () => onRename(t, editing.name.trim()))) setEditing(null);
                                    }}
                                >
                                    <input className="input py-1 text-sm" value={editing.name} maxLength={80} autoFocus aria-label="Template name"
                                        onChange={(e) => setEditing({ id: t.id, name: e.target.value })} />
                                    <button className="icon-btn" type="submit" disabled={busy === t.id || !editing.name.trim()} title="Save name"><Check size={16} /></button>
                                    <button className="icon-btn" type="button" onClick={() => setEditing(null)} title="Cancel"><X size={16} /></button>
                                </form>
                            ) : (
                                <div className="font-semibold text-ink truncate">{t.name}</div>
                            )}
                            <div className="mt-0.5 text-sm text-gray-700 truncate">{t.title}</div>
                            <div className="text-xs text-gray-500 line-clamp-1">{t.body}</div>
                            <div className="mt-1 text-xs text-gray-400">
                                {t.audience ? `Audience: ${describeAudience(t.audience)} · ` : ''}
                                Updated <RelativeTime iso={t.updatedAt} empty="—" />{t.updatedBy ? ` by ${t.updatedBy}` : ''}
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            {confirmDelete === t.id ? (
                                <>
                                    <span className="text-xs text-gray-600">Delete?</span>
                                    <button className="btn btn-danger btn-sm" disabled={busy === t.id}
                                        onClick={async () => { if (await run(t.id, () => onDelete(t))) setConfirmDelete(null); }}>
                                        {busy === t.id ? <Loader2 size={14} className="animate-spin" /> : 'Delete'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)}>Keep</button>
                                </>
                            ) : (
                                <>
                                    <button className="btn btn-secondary btn-sm" onClick={() => onLoad(t)}>Load</button>
                                    <button className="icon-btn" onClick={() => setEditing({ id: t.id, name: t.name })} title="Rename"><Pencil size={15} /></button>
                                    <button className="icon-btn" onClick={() => setConfirmDelete(t.id)} title="Delete"><Trash2 size={15} /></button>
                                </>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </Dialog>
    );
}
