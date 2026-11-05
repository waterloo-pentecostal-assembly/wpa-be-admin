// Publish records for a draft, polled while a publish is running.
import { useCallback, useEffect, useState } from 'react';
import { getPublishes } from '../api/seriesBuilderApi';
import { isLocalId } from './localDrafts';
import { isActive } from './publishes';

const POLL_MS = 2000;

export function usePublishes(draftId) {
    const [publishes, setPublishes] = useState([]);
    const [error, setError] = useState(null);
    const [tick, setTick] = useState(0);
    const local = isLocalId(draftId);

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        if (local) return undefined;
        let ignore = false;
        getPublishes(draftId)
            .then((list) => {
                if (ignore) return;
                setPublishes(list);
                setError(null);
            })
            .catch((e) => !ignore && setError(e.message));
        return () => { ignore = true; };
    }, [draftId, local, tick]);

    const active = publishes.some((p) => isActive(p));
    useEffect(() => {
        if (!active) return undefined;
        const timer = setTimeout(refresh, POLL_MS);
        return () => clearTimeout(timer);
    }, [active, publishes, refresh]);

    return { publishes, error, refresh, local };
}
