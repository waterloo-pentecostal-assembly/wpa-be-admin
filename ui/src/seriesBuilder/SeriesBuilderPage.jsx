import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { useEnv } from '../contexts/EnvContext';
import DraftLibrary from './DraftLibrary';
import SeriesWorkspace from './SeriesWorkspace';

/**
 * Series builder. The open draft and selected day live in the URL
 * (?env=dev&draft=…&view=day:…) so a reload or shared link returns to the
 * same spot. `env` is kept in step by EnvGate; drafts belong to that env.
 */
export default function SeriesBuilderPage() {
    const [params, setParams] = useSearchParams();
    const { env } = useEnv();
    const draftId = params.get('draft');
    const view = params.get('view');

    const withEnv = useCallback((rest = {}) => (env ? { env, ...rest } : rest), [env]);
    const openDraft = useCallback((id) => setParams(withEnv({ draft: id })), [setParams, withEnv]);
    const select = useCallback((nextView, { replace = true } = {}) => {
        setParams((p) => {
            const next = new URLSearchParams(p);
            next.set('view', nextView);
            return next;
        }, { replace });
    }, [setParams]);

    return (
        <div className="flex h-screen flex-col bg-canvas">
            <Header />
            {draftId ? (
                <SeriesWorkspace key={draftId} draftId={draftId} selection={view} onSelect={select} onExit={() => setParams(withEnv())} />
            ) : (
                <DraftLibrary onOpen={openDraft} />
            )}
        </div>
    );
}
