// User Manager: search the app's users (Firebase Authentication accounts and
// Firestore profiles, merged) and act on them. Search, filter, sort, page and
// the open user live in the URL so a view can be shared or reloaded.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, UserPlus, Users, X } from 'lucide-react';
import Header from '../components/Header';
import { Toasts } from '../seriesBuilder/ui';
import { useEnv } from '../contexts/EnvContext';
import * as api from '../api/usersApi';
import { formatDate } from './format';
import { Avatar, RelativeTime, StatusBadges } from './shared';
import { CreateUserDialog, LinkDialog } from './dialogs';
import UserDetailPanel from './UserDetailPanel';

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active', title: 'Not deactivated, with a verified email' },
    { key: 'disabled', label: 'Deactivated' },
    { key: 'pending_approval', label: 'Awaiting approval', title: 'Profiles an admin hasn\'t approved yet (is_verified off)' },
    { key: 'email_unverified', label: 'Email not verified', title: 'Users who haven\'t clicked the link in their verification email' },
    { key: 'admins', label: 'Admins' },
    { key: 'reported', label: 'Reported' },
    { key: 'missing_profile', label: 'No profile', title: 'Sign-in accounts without a Firestore profile' },
    { key: 'missing_account', label: 'No account', title: 'Firestore profiles without a sign-in account' },
];

const SORTS = [
    { key: 'created_desc', label: 'Newest first' },
    { key: 'created_asc', label: 'Oldest first' },
    { key: 'last_sign_in_desc', label: 'Recently signed in' },
    { key: 'name_asc', label: 'Name A–Z' },
    { key: 'email_asc', label: 'Email A–Z' },
];

function useToasts() {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(0);
    const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
    const toast = useCallback((message, tone = 'info') => {
        const id = ++nextId.current;
        setToasts((list) => [...list, { id, message, tone }]);
        setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000);
    }, [dismiss]);
    return { toasts, toast, dismiss };
}

export default function UserManagerPage() {
    const { env } = useEnv();
    const [params, setParams] = useSearchParams();
    const q = params.get('q') ?? '';
    const filter = params.get('filter') ?? 'all';
    const sort = params.get('sort') ?? 'created_desc';
    const page = Number(params.get('page')) || 1;
    const selected = params.get('user');

    const [search, setSearch] = useState(q);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState({ n: 0, refresh: false });
    // Loading while the latest request hasn't come back.
    const requestKey = JSON.stringify([q, filter, sort, page, reload.n]);
    const [settledKey, setSettledKey] = useState(null);
    const loading = settledKey !== requestKey;
    const [creating, setCreating] = useState(false);
    const [createdLink, setCreatedLink] = useState(null);
    const { toasts, toast, dismiss } = useToasts();

    const update = useCallback((changes, { resetPage = true } = {}) => {
        setParams((current) => {
            const next = new URLSearchParams(current);
            for (const [key, value] of Object.entries(changes)) {
                if (value === null || value === '' || value === undefined) next.delete(key);
                else next.set(key, String(value));
            }
            if (resetPage && !('page' in changes)) next.delete('page');
            return next;
        }, { replace: !('user' in changes) });
    }, [setParams]);

    // Typing searches after a short pause.
    useEffect(() => {
        if (search.trim() === q) return undefined;
        const timer = setTimeout(() => update({ q: search.trim() }), 250);
        return () => clearTimeout(timer);
    }, [search, q, update]);

    useEffect(() => {
        let ignore = false;
        api.searchUsers({ q, filter, sort, page, refresh: reload.refresh })
            .then((result) => {
                if (ignore) return;
                setData(result);
                setError(null);
            })
            .catch((err) => { if (!ignore) setError(err.message); })
            .finally(() => { if (!ignore) setSettledKey(requestKey); });
        return () => { ignore = true; };
    }, [q, filter, sort, page, reload, requestKey]);

    const refresh = () => setReload(({ n }) => ({ n: n + 1, refresh: true }));
    const openUser = (uid) => update({ user: uid }, { resetPage: false });
    const closeUser = useCallback(() => update({ user: null }, { resetPage: false }), [update]);

    // Changes made in the panel show in the row straight away; the list is
    // then re-queried (from the server's updated cache) for filters and counts.
    const requery = useCallback(() => setReload(({ n }) => ({ n: n + 1, refresh: false })), [setReload]);
    const onChanged = useCallback((user) => {
        setData((current) => current && { ...current, users: current.users.map((u) => (u.uid === user.uid ? user : u)) });
        requery();
    }, [setData, requery]);
    const onDeleted = useCallback((uid) => {
        closeUser();
        setData((current) => current && { ...current, users: current.users.filter((u) => u.uid !== uid), total: current.total - 1 });
        requery();
    }, [closeUser, setData, requery]);

    const onCreate = async (fields) => {
        const { user, resetLink } = await api.createUser(fields);
        setCreating(false);
        toast(`Created ${user.email}.`);
        if (resetLink) setCreatedLink({ link: resetLink, email: user.email });
        requery();
        openUser(user.uid);
    };

    const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
    const last = data ? first + data.users.length - 1 : 0;

    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <Header
                title="User Manager"
                subtitle="Search and manage app users"
                icon={Users}
                actions={(
                    <>
                        <button className="btn btn-secondary" onClick={refresh} disabled={loading} title="Reload users from Firebase">
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                        <button className="btn btn-primary" onClick={() => setCreating(true)}>
                            <UserPlus size={16} /> New user
                        </button>
                    </>
                )}
            />

            <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6 space-y-4">
                {/* Search + sort */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <input
                            type="search"
                            autoFocus
                            className="input pl-9 pr-9 py-2.5"
                            placeholder="Search by name, email or user ID"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && update({ q: search.trim() })}
                        />
                        {search && (
                            <button className="icon-btn p-1 absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearch('')} title="Clear search"><X size={14} /></button>
                        )}
                    </div>
                    <select className="input sm:w-56" value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort">
                        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-2">
                    {FILTERS.map((f) => {
                        const active = filter === f.key;
                        const count = data?.counts?.[f.key];
                        return (
                            <button
                                key={f.key}
                                title={f.title}
                                onClick={() => update({ filter: f.key === 'all' ? null : f.key })}
                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-ink text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-900'}`}
                            >
                                {f.label}
                                {count !== undefined && <span className={active ? 'text-white/60' : 'text-gray-400'}>{count}</span>}
                            </button>
                        );
                    })}
                </div>

                {error && <p className="alert alert-error"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}</p>}

                {/* Results */}
                <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-left">
                                <tr className="section-label">
                                    <th className="px-4 py-3 font-bold">User</th>
                                    <th className="px-4 py-3 font-bold">Status</th>
                                    <th className="px-4 py-3 font-bold hidden md:table-cell">Joined</th>
                                    <th className="px-4 py-3 font-bold hidden md:table-cell">Last sign-in</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {data?.users.map((user) => (
                                    <tr
                                        key={user.uid}
                                        onClick={() => openUser(user.uid)}
                                        className={`cursor-pointer transition-colors hover:bg-brand-50/50 ${selected === user.uid ? 'bg-brand-50' : ''} ${user.disabled ? 'text-gray-500' : ''}`}
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <Avatar user={user} />
                                                <div className="min-w-0">
                                                    <div className="font-semibold text-ink truncate">{user.name || <span className="text-gray-400 font-normal">No name</span>}</div>
                                                    <div className="text-gray-500 truncate">{user.email ?? <span className="font-mono text-xs">{user.uid}</span>}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3"><StatusBadges user={user} /></td>
                                        <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap text-gray-600">{formatDate(user.createdAt)}</td>
                                        <td className="px-4 py-3 hidden md:table-cell whitespace-nowrap text-gray-600"><RelativeTime iso={user.lastSignInAt} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {!data && loading && (
                        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                            <Loader2 size={18} className="animate-spin text-brand" /> Loading users… this can take a moment the first time.
                        </div>
                    )}
                    {data && !data.users.length && (
                        <div className="py-16 text-center text-sm text-gray-500">
                            No users match{q ? <> “{q}”</> : ''}{filter !== 'all' ? ` in ${FILTERS.find((f) => f.key === filter)?.label}` : ''}.
                        </div>
                    )}

                    {data && data.total > 0 && (
                        <div className="flex items-center justify-between gap-4 border-t border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
                            <span>
                                {first}–{last} of {data.total}
                                {data.loadedAt && <> · loaded <RelativeTime iso={data.loadedAt} /></>}
                            </span>
                            <div className="flex items-center gap-1">
                                <button className="icon-btn p-1.5" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 })} title="Previous page"><ChevronLeft size={16} /></button>
                                <span className="px-2">Page {data.page} of {data.pageCount}</span>
                                <button className="icon-btn p-1.5" disabled={data.page >= data.pageCount} onClick={() => update({ page: data.page + 1 })} title="Next page"><ChevronRight size={16} /></button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {selected && (
                <UserDetailPanel key={selected} uid={selected} env={env ?? 'this environment'} onClose={closeUser} onChanged={onChanged} onDeleted={onDeleted} toast={toast} />
            )}
            {creating && <CreateUserDialog env={env ?? 'this environment'} onCreate={onCreate} onClose={() => setCreating(false)} />}
            {createdLink && <LinkDialog kind="reset" link={createdLink.link} email={createdLink.email} onClose={() => setCreatedLink(null)} />}
            <Toasts toasts={toasts} onDismiss={dismiss} />
        </div>
    );
}
