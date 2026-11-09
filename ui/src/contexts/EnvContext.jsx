// The server's environment (prod or dev), loaded once for the whole app.
// It applies to every open tab; switching reloads the page.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentEnv } from '../api/seriesBuilderApi';

// eslint-disable-next-line react-refresh/only-export-components
export const ENVS = ['prod', 'dev'];

const EnvContext = createContext({ env: null, loaded: false });

export function EnvProvider({ children }) {
    const [env, setEnv] = useState(undefined);
    useEffect(() => {
        getCurrentEnv().then((r) => setEnv(r.env)).catch(() => setEnv(null));
    }, []);
    return (
        <EnvContext.Provider value={{ env: ENVS.includes(env) ? env : null, loaded: env !== undefined }}>
            {children}
        </EnvContext.Provider>
    );
}

/** @returns {{ env: 'prod'|'dev'|null, loaded: boolean }} `env` is null if it couldn't be loaded. */
// eslint-disable-next-line react-refresh/only-export-components
export const useEnv = () => useContext(EnvContext);
