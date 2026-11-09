import React, { useState } from 'react';
import { Zap, ShieldCheck } from 'lucide-react';
import { useEnv } from '../contexts/EnvContext';

const EnvSwitcher = () => {
    const { env: currentEnv, loaded } = useEnv();
    const [switching, setSwitching] = useState(false);
    const env = currentEnv ?? 'prod';
    const loading = !loaded || switching;

    const toggleEnv = async () => {
        const newEnv = env === 'prod' ? 'dev' : 'prod';
        setSwitching(true);
        try {
            const res = await fetch('/api/env/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ env: newEnv })
            });
            const data = await res.json();
            if (data.success) {
                // Reload with the new env in the URL so all data is fresh from
                // the new DB. An open series builder draft belongs to the old
                // env, so it is dropped.
                const url = new URL(window.location.href);
                url.searchParams.set('env', data.env);
                url.searchParams.delete('draft');
                url.searchParams.delete('view');
                window.location.replace(url);
                return;
            }
            alert('Failed to switch environment');
        } catch (error) {
            console.error('Error switching env', error);
            alert('Error switching environment');
        }
        setSwitching(false);
    };

    if (loading) {
        return <div className="h-7 w-16 rounded-full bg-white/10 animate-pulse" aria-label="Loading environment" />;
    }

    const isProd = env === 'prod';

    return (
        <button
            onClick={toggleEnv}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-wider transition-colors border ${isProd
                ? 'bg-white/5 border-white/20 text-white hover:bg-white/10'
                : 'bg-amber-400/15 border-amber-400/50 text-amber-200 hover:bg-amber-400/25'
                }`}
            title={`Current Environment: ${env.toUpperCase()}. Click to switch.`}
        >
            {isProd ? <ShieldCheck size={14} className="text-emerald-400" /> : <Zap size={14} />}
            <span>{env.toUpperCase()}</span>
        </button>
    );
};

export default EnvSwitcher;
