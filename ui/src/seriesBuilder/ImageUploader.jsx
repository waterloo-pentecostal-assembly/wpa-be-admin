import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { getImagePreviewUrl, uploadSeriesImage } from '../api/seriesBuilderApi';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * Picks a cover image from the computer, uploads it to the selected
 * environment's Firebase Storage bucket and stores the gs:// location.
 */
export default function ImageUploader({ value, seriesTitle, env, onChange }) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [dragging, setDragging] = useState(false);

    // Signed URL for an existing gs:// image.
    useEffect(() => {
        if (!value) {
            setPreviewUrl(null);
            return undefined;
        }
        let ignore = false;
        getImagePreviewUrl(value)
            .then(({ url }) => !ignore && setPreviewUrl(url))
            .catch(() => !ignore && setPreviewUrl(null));
        return () => { ignore = true; };
    }, [value]);

    const upload = async (file) => {
        if (!file) return;
        if (!ACCEPT.split(',').includes(file.type)) {
            setError('Choose a JPEG, PNG, WebP or GIF image.');
            return;
        }
        setError(null);
        setUploading(true);
        const localUrl = URL.createObjectURL(file);
        setPreviewUrl(localUrl);
        try {
            const result = await uploadSeriesImage(file, seriesTitle);
            onChange(result.gsUri);
        } catch (err) {
            setError(err.message);
            setPreviewUrl(null);
        } finally {
            setUploading(false);
        }
    };

    const bucket = /^gs:\/\/([^/]+)\//.exec(value ?? '')?.[1];
    const bucketLooksDev = bucket?.includes('-dev');

    return (
        <div>
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    upload(e.dataTransfer.files?.[0]);
                }}
                onClick={() => !uploading && inputRef.current?.click()}
                className={`relative flex aspect-[16/9] w-full max-w-md cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${dragging ? 'border-brand bg-brand-50' : 'border-gray-300 bg-gray-50 hover:border-brand-300'}`}
            >
                {previewUrl ? (
                    <img src={previewUrl} alt="Series cover" className="h-full w-full object-cover" />
                ) : (
                    <div className="text-center text-sm text-gray-500">
                        <ImagePlus size={28} className="mx-auto mb-2 text-gray-400" />
                        {value ? 'Preview unavailable' : 'Drop an image or click to choose'}
                    </div>
                )}
                {uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-semibold text-gray-700">
                        <Loader2 size={18} className="mr-2 animate-spin" /> Uploading to {env ?? 'Firebase'}…
                    </div>
                )}
                {previewUrl && !uploading && (
                    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
                        <RefreshCw size={12} /> Replace
                    </span>
                )}
            </div>
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
            }} />
            {error && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600"><AlertCircle size={14} /> {error}</p>}
            <div className="mt-2">
                <input
                    className="input font-mono text-xs"
                    value={value ?? ''}
                    placeholder="gs://… (filled in automatically after upload)"
                    onChange={(e) => onChange(e.target.value, 'meta:image')}
                />
                <p className="mt-1 text-xs text-gray-400">
                    Uploads go to the <span className="font-semibold">{env ?? '…'}</span> bucket under bible_series/&lt;series name&gt;/.
                    {bucket && ((env === 'prod' && bucketLooksDev) || (env === 'dev' && !bucketLooksDev)) && (
                        <span className="text-amber-600"> This image is in {bucket}, which doesn’t match the {env} environment.</span>
                    )}
                </p>
            </div>
        </div>
    );
}
