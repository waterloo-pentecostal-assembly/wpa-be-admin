import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import DraftLibrary from './DraftLibrary';
import SeriesWorkspace from './SeriesWorkspace';

/**
 * Series builder. The open draft and selected day live in the URL
 * (?draft=…&view=day:…) so a reload or shared link returns to the same spot.
 */
export default function SeriesBuilderPage() {
    const [params, setParams] = useSearchParams();
    const draftId = params.get('draft');
    const view = params.get('view');

    const openDraft = useCallback((id) => setParams({ draft: id }), [setParams]);
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
                <SeriesWorkspace key={draftId} draftId={draftId} selection={view} onSelect={select} onExit={() => setParams({})} />
            ) : (
                <DraftLibrary onOpen={openDraft} />
            )}
        </div>
    );
}
