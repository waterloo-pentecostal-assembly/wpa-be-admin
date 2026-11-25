import React, { useCallback, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal';
import { setSeriesFlags } from '../api/seriesBuilderApi';

// Setting a published series' is_active / is_visible (see SeriesFlags.jsx).

export const FLAG_LABELS = { is_active: 'Active', is_visible: 'Visible' };

const name = (series) => `“${series.title || 'Untitled series'}”`;

/**
 * Changing series flags, with a confirmation where it matters (making a
 * series active, or inactive, or hiding the active series).
 *
 * @param {{ activeSeries?: Array<{ id: string, title: string }>, onChanged: (seriesId: string, flags: { is_active: boolean, is_visible: boolean }, change: { flag: string, value: boolean }) => void }} options
 *   `activeSeries`: the series active now (named in the confirmation).
 * @returns {{ change: (series: object, flag: string, value: boolean) => void, pending: string|null, error: string|null, dialog: React.ReactNode }}
 */
export default function useSeriesFlags({ activeSeries = [], onChanged }) {
    const [confirm, setConfirm] = useState(null); // { series, flag, value }
    const [pending, setPending] = useState(null); // `${seriesId}:${flag}`
    const [error, setError] = useState(null);

    const write = useCallback(async (series, flag, value) => {
        setPending(`${series.id}:${flag}`);
        setError(null);
        try {
            const flags = await setSeriesFlags(series.id, { [flag]: value });
            onChanged(series.id, { is_active: flags.is_active, is_visible: flags.is_visible }, { flag, value });
        } catch (e) {
            setError(`Could not change ${FLAG_LABELS[flag].toLowerCase()} for ${name(series)}: ${e.message}`);
        } finally {
            setPending(null);
        }
    }, [onChanged]);

    const change = useCallback((series, flag, value) => {
        const needsConfirm = flag === 'is_active' || (flag === 'is_visible' && !value && series.is_active);
        if (needsConfirm) setConfirm({ series, flag, value });
        else write(series, flag, value);
    }, [write]);

    let dialog = null;
    if (confirm) {
        const { series, flag, value } = confirm;
        const others = activeSeries.filter((s) => s.id !== series.id);
        const done = () => setConfirm(null);
        const go = () => {
            done();
            write(series, flag, value);
        };
        if (flag === 'is_active' && value) {
            dialog = (
                <ConfirmModal
                    title={`Make ${name(series)} the active series?`}
                    message={(
                        <>
                            This starts the app’s automation in Firebase:{' '}
                            {others.length ? <>{others.map(name).join(', ')} {others.length === 1 ? 'is' : 'are'} made inactive</> : 'every other series is made inactive'},
                            {' '}and <strong>notifications go out to all users</strong> to join a group and to remind them the new series is starting. Sent notifications can’t be taken back.
                            {!series.is_visible && <><br /><br />This series is also hidden, so users won’t find it in the series list until it’s made visible.</>}
                        </>
                    )}
                    confirmText="Make active and notify"
                    isDangerous
                    onCancel={done}
                    onConfirm={go}
                />
            );
        } else if (flag === 'is_active') {
            dialog = (
                <ConfirmModal
                    title={`Make ${name(series)} inactive?`}
                    message="No series will be active in the app until another one is made active."
                    confirmText="Make inactive"
                    onCancel={done}
                    onConfirm={go}
                />
            );
        } else {
            dialog = (
                <ConfirmModal
                    title={`Hide ${name(series)}?`}
                    message="It’s the active series; hiding it takes it out of the app’s series list while it stays active."
                    confirmText="Hide"
                    onCancel={done}
                    onConfirm={go}
                />
            );
        }
    }

    return { change, pending, error, clearError: () => setError(null), dialog };
}

