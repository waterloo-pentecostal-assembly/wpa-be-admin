import React, { useEffect, useRef, useState } from 'react';
import { FileJson, Upload, Loader2, AlertCircle } from 'lucide-react';
import { getRepoSeries, listRepoSeries } from '../api/seriesBuilderApi';
import { Dialog } from './ui';

/** Opens an existing series JSON (from the repo's series folder or this computer) as a new draft. */
export default function ImportDialog({ onImport, onClose }) {
    const [files, setFiles] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const fileRef = useRef(null);

    useEffect(() => {
        listRepoSeries().then(setFiles).catch((e) => {
            setFiles([]);
            setError(e.message);
        });
    }, []);

    const run = async (label, load) => {
        setBusy(label);
        setError(null);
        try {
            const json = await load();
            if (!json?.bible_series && !Array.isArray(json?.series_content)) throw new Error('This file is not a series export ({ bible_series, series_content }).');
            await onImport(json);
        } catch (e) {
            setError(e.message);
            setBusy(null);
        }
    };

    return (
        <Dialog title="Import an existing series" eyebrow="New draft from JSON" onClose={onClose} width="max-w-xl">
            <p className="mb-4 text-sm text-gray-500">
                The series is copied into a new draft. Content repeated across days (like Reflect questions) becomes linked templates automatically.
            </p>
            <button className="btn btn-secondary w-full mb-4" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                {busy === 'local' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Choose a JSON file from this computer
            </button>
            <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) run('local', async () => JSON.parse(await file.text()));
                }}
            />
            {error && <p className="alert alert-error mb-3"><AlertCircle size={16} className="shrink-0" /> {error}</p>}
            <p className="section-label mb-2">Series files on the server</p>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {files === null && <p className="p-4 text-sm text-gray-400">Loading…</p>}
                {files?.map((f) => (
                    <button
                        key={f}
                        disabled={!!busy}
                        onClick={() => run(f, () => getRepoSeries(f))}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        {busy === f ? <Loader2 size={15} className="animate-spin text-brand" /> : <FileJson size={15} className="text-gray-400" />}
                        {f}
                    </button>
                ))}
                {files?.length === 0 && !error && <p className="p-4 text-sm text-gray-400">No files found.</p>}
            </div>
        </Dialog>
    );
}
