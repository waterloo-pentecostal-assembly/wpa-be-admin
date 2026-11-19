import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2, Wrench } from 'lucide-react';
import Header from '../components/Header';
import { useEnv } from '../contexts/EnvContext';
import { countOldContent, deleteOldContent } from '../api/maintenanceApi';

// Maintenance for the selected environment. For now: delete prayer requests
// and testimonies older than a date (with any subcollections).

const KINDS = ['prayer_requests', 'testimonies'];
const LABELS = { prayer_requests: 'Prayer requests', testimonies: 'Testimonies' };
const NOUNS = { prayer_requests: 'prayer requests', testimonies: 'testimonies' };

/** YYYY-MM-DD for a local date. */
const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const oneYearAgo = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return ymd(d);
};
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const formatDay = (day) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/** Asks before deleting; in prod the environment name has to be typed. */
function ConfirmDeleteDialog({ env, before, items, onConfirm, onCancel }) {
    const [typed, setTyped] = useState('');
    const needsTyping = env === 'prod';
    const ready = !needsTyping || typed.trim() === 'prod';
    return (
        <div className="modal-backdrop z-50">
            <div className="modal-panel max-w-md">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="p-3 rounded-full shrink-0 bg-red-100 text-red-600">
                            <AlertTriangle size={22} />
                        </div>
                        <div className="flex-1 text-sm text-gray-600 leading-relaxed">
                            <h3 className="text-lg font-bold text-ink mb-1.5">Permanently delete?</h3>
                            <p>
                                From <strong>{env}</strong>, everything dated before {formatDay(before)}:
                            </p>
                            <ul className="list-disc pl-5 my-2">
                                {items.map(({ kind, count }) => (
                                    <li key={kind}><strong>{count.toLocaleString()}</strong> {NOUNS[kind]}</li>
                                ))}
                            </ul>
                            <p>This can&apos;t be undone.</p>
                            {needsTyping && (
                                <label className="block mt-4">
                                    <span className="label">This is PROD. Type <code>prod</code> to confirm.</span>
                                    <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
                                </label>
                            )}
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
                    <button onClick={onConfirm} className="btn btn-danger" disabled={!ready}>Delete</button>
                </div>
            </div>
        </div>
    );
}

export default function MaintenancePage() {
    const { env } = useEnv();
    const [before, setBefore] = useState(oneYearAgo);
    const [selected, setSelected] = useState(() => new Set(KINDS));
    const [counts, setCounts] = useState(null); // { before, env, kinds }
    const [counting, setCounting] = useState(false);
    const [error, setError] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [result, setResult] = useState(null);

    const count = useCallback(async (day) => {
        if (!isDay(day)) return;
        setCounting(true);
        setError(null);
        try {
            setCounts(await countOldContent(day));
        } catch (err) {
            setCounts(null);
            setError(err.message);
        } finally {
            setCounting(false);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => count(before), 300);
        return () => clearTimeout(timer);
    }, [before, count]);

    const current = counts && counts.before === before ? counts : null;
    const items = current
        ? KINDS.filter((kind) => selected.has(kind) && current.kinds[kind]?.older > 0).map((kind) => ({ kind, count: current.kinds[kind].older }))
        : [];

    const toggle = (kind) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        return next;
    });

    const runDelete = async () => {
        setConfirming(false);
        setDeleting(true);
        setResult(null);
        try {
            const res = await deleteOldContent({ before, kinds: items.map((i) => i.kind), env: current.env });
            const parts = Object.entries(res.deleted).map(([kind, n]) => `${n.toLocaleString()} ${NOUNS[kind]}`);
            setResult({ ok: true, message: `Deleted ${parts.join(' and ')} dated before ${formatDay(before)} from ${res.env}.` });
        } catch (err) {
            setResult({ ok: false, message: err.message });
        } finally {
            setDeleting(false);
            count(before);
        }
    };

    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <Header
                title="Maintenance"
                subtitle={`Clean up old data${env ? ` in ${env}` : ''}`}
                icon={Wrench}
                actions={(
                    <button onClick={() => count(before)} className="btn btn-secondary" title="Count again">
                        <RefreshCw size={16} className={counting ? 'animate-spin' : ''} />
                        <span>Refresh</span>
                    </button>
                )}
            />

            <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-8 space-y-6">
                <section className="card card-body">
                    <h3 className="card-title mb-1">Delete old prayer requests and testimonies</h3>
                    <p className="text-sm text-gray-500 mb-5">
                        Permanently deletes the ones dated before the day you choose (Toronto time), with anything stored
                        under them. Entries without a date are never deleted.
                        {env === 'prod' && <strong className="text-red-700"> You are working on PROD.</strong>}
                    </p>

                    <label className="block max-w-xs mb-5">
                        <span className="label">Delete content dated before</span>
                        <input type="date" className="input" value={before} max={ymd(new Date())} onChange={(e) => setBefore(e.target.value)} />
                    </label>

                    <div className="space-y-3 mb-6">
                        {KINDS.map((kind) => {
                            const info = current?.kinds[kind];
                            return (
                                <label key={kind} className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
                                    <input type="checkbox" className="checkbox" checked={selected.has(kind)} onChange={() => toggle(kind)} />
                                    <span className="flex-1 text-sm font-semibold text-ink">{LABELS[kind]}</span>
                                    <span className="text-sm text-gray-500 tabular-nums">
                                        {info
                                            ? <><strong className="text-ink">{info.older.toLocaleString()}</strong> older of {info.total.toLocaleString()}</>
                                            : (counting ? 'Counting…' : '—')}
                                    </span>
                                </label>
                            );
                        })}
                    </div>

                    {error && <div className="mb-4 text-sm text-red-700">{error}</div>}

                    <button className="btn btn-danger" disabled={!items.length || deleting || counting} onClick={() => setConfirming(true)}>
                        <Trash2 size={16} />
                        <span>
                            {deleting
                                ? 'Deleting…'
                                : items.length
                                    ? `Delete ${items.reduce((n, i) => n + i.count, 0).toLocaleString()}`
                                    : 'Nothing to delete'}
                        </span>
                    </button>

                    {result && (
                        <div className={`mt-4 text-sm ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.message}</div>
                    )}
                </section>
            </main>

            {confirming && current && (
                <ConfirmDeleteDialog
                    env={current.env}
                    before={before}
                    items={items}
                    onConfirm={runDelete}
                    onCancel={() => setConfirming(false)}
                />
            )}
        </div>
    );
}
