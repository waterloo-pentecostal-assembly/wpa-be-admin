import React, { useState, useEffect } from 'react';
import { Database, Zap, ShieldCheck } from 'lucide-react';

const EnvSwitcher = () => {
    const [env, setEnv] = useState('prod');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/env/current')
            .then(res => res.json())
            .then(data => {
                setEnv(data.env);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch env', err);
                setLoading(false);
            });
    }, []);

    const toggleEnv = async () => {
        const newEnv = env === 'prod' ? 'dev' : 'prod';
        setLoading(true);
        try {
            const res = await fetch('/api/env/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ env: newEnv })
            });
            const data = await res.json();
            if (data.success) {
                setEnv(data.env);
                // Reload the page to ensure all data is fresh from new DB
                window.location.reload();
            } else {
                alert('Failed to switch environment');
            }
        } catch (error) {
            console.error('Error switching env', error);
            alert('Error switching environment');
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="text-white/50 text-xs">...</div>;

    return (
        <button
            onClick={toggleEnv}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${env === 'prod'
                    ? 'bg-blue-900 border-blue-700 text-blue-100 hover:bg-blue-800'
                    : 'bg-amber-900 border-amber-700 text-amber-100 hover:bg-amber-800'
                }`}
            title={`Current Environment: ${env.toUpperCase()}. Click to switch.`}
        >
            {env === 'prod' ? <ShieldCheck size={14} /> : <Zap size={14} />}
            <span>{env.toUpperCase()}</span>
        </button>
    );
};

export default EnvSwitcher;
