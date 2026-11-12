// Picks users to notify. Each chosen user gets all of their devices, or only
// the devices ticked (loaded from the User Manager's user details).
import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Search, Smartphone, X } from 'lucide-react';
import * as usersApi from '../api/usersApi';
import { Avatar, StatusBadges } from '../users/shared';

/** @typedef {{ uid: string, name: string, email: string|null, photoUrl?: string, mode: 'all'|'some', deviceIds: string[], devices?: object[]|null, devicesError?: string }} Chosen */

export default function UserPicker({ chosen, onChange }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const q = query.trim();
        if (!q) {
            setResults(null);
            return undefined;
        }
        let ignore = false;
        const timer = setTimeout(() => {
            setSearching(true);
            usersApi.searchUsers({ q })
                .then((r) => { if (!ignore) { setResults(r.users.slice(0, 8)); setError(null); } })
                .catch((e) => { if (!ignore) setError(e.message); })
                .finally(() => { if (!ignore) setSearching(false); });
        }, 250);
        return () => { ignore = true; clearTimeout(timer); };
    }, [query]);

    const update = (uid, changes) => onChange(chosen.map((c) => (c.uid === uid ? { ...c, ...changes } : c)));
    const remove = (uid) => onChange(chosen.filter((c) => c.uid !== uid));
    const add = (user) => {
        if (chosen.some((c) => c.uid === user.uid)) return;
        onChange([...chosen, { uid: user.uid, name: user.name, email: user.email, photoUrl: user.photoUrl, disabled: user.disabled, mode: 'all', deviceIds: [], devices: null }]);
    };

    // Device lists load when a user is switched to "selected devices".
    const chooseSome = async (person) => {
        update(person.uid, { mode: 'some' });
        if (person.devices) return;
        try {
            const { user } = await usersApi.getUser(person.uid);
            onChange((current) => current.map((c) => (c.uid === person.uid ? { ...c, devices: user.devices ?? [], devicesError: null } : c)));
        } catch (e) {
            onChange((current) => current.map((c) => (c.uid === person.uid ? { ...c, devices: [], devicesError: e.message } : c)));
        }
    };

    const toggleDevice = (person, deviceId) => {
        const ids = new Set(person.deviceIds);
        if (ids.has(deviceId)) ids.delete(deviceId); else ids.add(deviceId);
        update(person.uid, { deviceIds: [...ids] });
    };

    return (
        <div className="space-y-3">
            <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    className="input pl-9"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search users by name, email or uid…"
                    aria-label="Search users"
                />
                {searching && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {results && (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {results.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">No users match.</li>}
                    {results.map((user) => {
                        const added = chosen.some((c) => c.uid === user.uid);
                        return (
                            <li key={user.uid} className="flex items-center gap-3 px-3 py-2">
                                <Avatar user={user} size="h-8 w-8 text-[11px]" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-ink">{user.name || user.email || user.uid}</div>
                                    <div className="truncate text-xs text-gray-500">{user.email}</div>
                                </div>
                                <StatusBadges user={user} />
                                <button type="button" className="btn btn-secondary btn-sm" disabled={added} onClick={() => add(user)}>
                                    {added ? 'Added' : <><Plus size={14} /> Add</>}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {chosen.length > 0 ? (
                <ul className="space-y-2">
                    {chosen.map((person) => (
                        <li key={person.uid} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                            <div className="flex items-center gap-3">
                                <Avatar user={person} size="h-8 w-8 text-[11px]" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-ink">
                                        {person.name || person.email || person.uid}
                                        {person.disabled && <span className="ml-2 text-xs font-normal text-red-600">deactivated</span>}
                                    </div>
                                    <div className="truncate text-xs text-gray-500">{person.email ?? person.uid}</div>
                                </div>
                                <div className="flex rounded-full bg-gray-100 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Devices">
                                    <button type="button" role="radio" aria-checked={person.mode === 'all'} onClick={() => update(person.uid, { mode: 'all' })}
                                        className={`rounded-full px-2.5 py-1 ${person.mode === 'all' ? 'bg-white text-ink shadow-sm' : 'text-gray-500'}`}>All devices</button>
                                    <button type="button" role="radio" aria-checked={person.mode === 'some'} onClick={() => chooseSome(person)}
                                        className={`rounded-full px-2.5 py-1 ${person.mode === 'some' ? 'bg-white text-ink shadow-sm' : 'text-gray-500'}`}>Selected</button>
                                </div>
                                <button type="button" className="icon-btn" onClick={() => remove(person.uid)} title="Remove"><X size={16} /></button>
                            </div>
                            {person.mode === 'some' && (
                                <div className="mt-2 border-t border-gray-100 pt-2">
                                    {!person.devices && <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" /> Loading devices…</p>}
                                    {person.devicesError && <p className="text-xs text-red-600">{person.devicesError}</p>}
                                    {person.devices && !person.devicesError && person.devices.length === 0 && <p className="text-xs text-gray-500">This user has no registered devices.</p>}
                                    {person.devices?.map((d) => (
                                        <label key={d.id} className={`flex items-center gap-2 py-1 text-xs ${d.hasToken ? '' : 'opacity-50'}`}>
                                            <input type="checkbox" className="checkbox" disabled={!d.hasToken} checked={person.deviceIds.includes(d.id)} onChange={() => toggleDevice(person, d.id)} />
                                            <Smartphone size={13} className="text-gray-400" />
                                            <span className="font-mono text-gray-700">{d.token ?? d.id}</span>
                                            <span className="truncate text-gray-500">{deviceDescription(d)}</span>
                                            {!d.hasToken && <span className="text-amber-700">no push token</span>}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-gray-500">Search above and add the users to notify.</p>
            )}
        </div>
    );
}

const DEVICE_FIELDS = ['platform', 'os', 'device_type', 'model', 'device_name', 'name', 'app_version'];

/** A short label for a device from whichever descriptive fields it has. */
function deviceDescription(device) {
    return DEVICE_FIELDS.map((k) => device[k]).filter((v) => typeof v === 'string' && v).join(' · ');
}
