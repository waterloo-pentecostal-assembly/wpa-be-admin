import React, { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCw, Trash2 } from 'lucide-react';
import Header from '../components/Header';
import ConfirmModal from '../components/ConfirmModal';
import { fetchBibleProxyStats, fetchBibleProxyWhoami, purgeBibleProxyCache } from '../api/bibleApi';

// Operations for the Bible proxy (wpa-be-bible-proxy), which serves all of the
// console's scripture: its cache and upstream statistics, who it sees you as,
// and purging its cache. The server forwards your sign-in to the proxy.

const label = (key) => key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function formatValue(key, value) {
    if (typeof value === 'number' && /rate|ratio/i.test(key) && value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
    if (typeof value === 'number') return value.toLocaleString();
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
}

/** Shows any JSON object as nested label/value rows (the proxy's shapes may grow). */
function Fields({ data, depth = 0 }) {
    if (data === null || typeof data !== 'object') return <span>{formatValue('', data)}</span>;
    const entries = Array.isArray(data) ? data.map((v, i) => [String(i + 1), v]) : Object.entries(data);
    if (!entries.length) return <span className="text-gray-400">—</span>;
    return (
        <dl className={depth ? 'mt-1 pl-4 border-l border-gray-200 space-y-1' : 'space-y-2'}>
            {entries.map(([key, value]) => (
                <div key={key} className={value && typeof value === 'object' ? '' : 'flex justify-between gap-4'}>
                    <dt className="text-sm text-gray-500">{label(key)}</dt>
                    <dd className="text-sm font-medium text-ink tabular-nums break-all text-right">
                        {value && typeof value === 'object' ? <Fields data={value} depth={depth + 1} /> : formatValue(key, value)}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

const retryNote = (error) => (error?.retryAfter ? ` (retry in ${error.retryAfter}s)` : '');

export default function ScriptureProxyPage() {
    const [stats, setStats] = useState(null);
    const [whoami, setWhoami] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [scope, setScope] = useState('bibleId');
    const [targetId, setTargetId] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [purging, setPurging] = useState(false);
    const [purgeResult, setPurgeResult] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [s, w] = await Promise.all([fetchBibleProxyStats(), fetchBibleProxyWhoami()]);
            setStats(s);
            setWhoami(w);
        } catch (err) {
            setError(`${err.message}${retryNote(err)}`);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const target = scope === 'all' ? { all: true } : { [scope]: targetId.trim() };
    const canPurge = scope === 'all' || /^[A-Za-z0-9_-]{1,64}$/.test(targetId.trim());
    const targetLabel = scope === 'all' ? 'the entire cache' : `${scope === 'bibleId' ? 'Bible' : 'audio Bible'} ${targetId.trim()}`;

    const purge = async () => {
        setConfirming(false);
        setPurging(true);
        setPurgeResult(null);
        try {
            const result = await purgeBibleProxyCache(target);
            setPurgeResult({ ok: true, message: `Purged ${targetLabel}.`, detail: result });
            load();
        } catch (err) {
            setPurgeResult({ ok: false, message: `${err.message}${retryNote(err)}` });
        } finally {
            setPurging(false);
        }
    };

    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <Header
                title="Scripture Proxy"
                subtitle="The Bible proxy that serves all scripture: cache, quota and purges"
                icon={Database}
                actions={(
                    <button onClick={load} className="btn btn-secondary" title="Refresh">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        <span>Refresh</span>
                    </button>
                )}
            />

            <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
                {error && <div className="card card-body border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <section className="card card-body">
                        <h3 className="card-title mb-4">Statistics</h3>
                        {stats ? <Fields data={stats} /> : <p className="text-sm text-gray-400">{loading ? 'Loading…' : 'Not available'}</p>}
                    </section>

                    <section className="card card-body">
                        <h3 className="card-title mb-4">Signed in to the proxy as</h3>
                        {whoami ? <Fields data={whoami} /> : <p className="text-sm text-gray-400">{loading ? 'Loading…' : 'Not available'}</p>}
                    </section>
                </div>

                <section className="card card-body">
                    <h3 className="card-title mb-1">Purge cache</h3>
                    <p className="text-sm text-gray-500 mb-4">
                        Removes cached API.Bible responses so the next requests fetch fresh content (and count against the
                        API.Bible quota). Use it after a translation&apos;s text changes or when API.Bible asks for content to be removed.
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="section-label">What</span>
                            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
                                <option value="bibleId">One Bible</option>
                                <option value="audioBibleId">One audio Bible</option>
                                <option value="all">Everything</option>
                            </select>
                        </label>
                        {scope !== 'all' && (
                            <label className="flex flex-col gap-1 flex-1 min-w-[16rem]">
                                <span className="section-label">{scope === 'bibleId' ? 'Bible ID' : 'Audio Bible ID'}</span>
                                <input
                                    className="input"
                                    value={targetId}
                                    onChange={(e) => setTargetId(e.target.value)}
                                    placeholder="e.g. de4e12af7f28f599-02"
                                />
                            </label>
                        )}
                        <button className="btn btn-danger" disabled={!canPurge || purging} onClick={() => setConfirming(true)}>
                            <Trash2 size={16} />
                            <span>{purging ? 'Purging…' : 'Purge'}</span>
                        </button>
                    </div>
                    {purgeResult && (
                        <div className={`mt-4 text-sm ${purgeResult.ok ? 'text-green-700' : 'text-red-700'}`}>
                            {purgeResult.message}
                            {purgeResult.detail && <div className="mt-2"><Fields data={purgeResult.detail} /></div>}
                        </div>
                    )}
                </section>
            </main>

            {confirming && (
                <ConfirmModal
                    title="Purge the proxy cache?"
                    message={`This removes ${targetLabel} from the Bible proxy's cache. Content is fetched from API.Bible again on next use.`}
                    confirmText="Purge"
                    isDangerous
                    onConfirm={purge}
                    onCancel={() => setConfirming(false)}
                />
            )}
        </div>
    );
}
