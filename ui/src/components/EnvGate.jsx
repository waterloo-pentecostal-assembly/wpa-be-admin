import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { switchEnv } from '../api/seriesBuilderApi';
import { ENVS, useEnv } from '../contexts/EnvContext';

// Page state that belongs to one environment (series builder drafts, the
// User Manager's selected user), dropped when staying on the other one.
const ENV_SCOPED_PARAMS = ['draft', 'view', 'user'];

function EnvMismatch({ linkEnv, serverEnv, onStay }) {
    const [switching, setSwitching] = useState(false);
    const [error, setError] = useState(null);
    const doSwitch = async () => {
        setSwitching(true);
        try {
            await switchEnv(linkEnv);
            window.location.reload();
        } catch (e) {
            setError(e.message);
            setSwitching(false);
        }
    };
    return (
        <div className="flex h-screen items-center justify-center bg-canvas p-6">
            <div className="card max-w-md p-6 text-sm">
                <p className="mb-2 flex items-center gap-2 font-semibold text-ink">
                    <AlertTriangle size={18} className="text-amber-500" /> This link is for {linkEnv}
                </p>
                <p className="mb-4 text-gray-600">
                    The admin console is on <strong>{serverEnv}</strong>. Switching changes the environment for every open tab.
                </p>
                {error && <p className="alert alert-error mb-3">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button className="btn btn-ghost" onClick={onStay} disabled={switching}>Stay on {serverEnv}</button>
                    <button className={`btn ${linkEnv === 'prod' ? 'btn-dark' : 'btn-primary'}`} onClick={doSwitch} disabled={switching}>
                        {switching && <Loader2 size={16} className="animate-spin" />} Switch to {linkEnv}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Keeps `?env=` in every page's URL in step with the server's environment, so
 * a reload or shared link says which environment it is for. A link naming the
 * other environment asks before switching: the server's environment applies to
 * every tab, so a link never switches it silently.
 */
export default function EnvGate({ children }) {
    const { env, loaded } = useEnv();
    const [params, setParams] = useSearchParams();
    const linkEnv = ENVS.includes(params.get('env')) ? params.get('env') : null;

    // Pages reached without an env (links, redirects) get the server's.
    useEffect(() => {
        if (!env || linkEnv) return;
        setParams((p) => {
            const next = new URLSearchParams(p);
            next.set('env', env);
            return next;
        }, { replace: true });
    }, [env, linkEnv, setParams]);

    if (!loaded) {
        return <div className="flex h-screen items-center justify-center bg-canvas text-sm text-gray-500"><Loader2 size={18} className="mr-2 animate-spin" /> Loading…</div>;
    }
    if (env && linkEnv && linkEnv !== env) {
        const stay = () => setParams((p) => {
            const next = new URLSearchParams(p);
            next.set('env', env);
            for (const key of ENV_SCOPED_PARAMS) next.delete(key);
            return next;
        }, { replace: true });
        return <EnvMismatch linkEnv={linkEnv} serverEnv={env} onStay={stay} />;
    }
    return children;
}
