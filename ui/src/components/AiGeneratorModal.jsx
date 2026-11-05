import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, Key, Calendar } from 'lucide-react';

const AiGeneratorModal = ({ onGenerate, onCancel }) => {
    const [outlineText, setOutlineText] = useState('');
    const [startYear, setStartYear] = useState(new Date().getFullYear());
    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Load saved API key from localStorage on mount
    useEffect(() => {
        const savedKey = localStorage.getItem('wpa_gemini_api_key');
        if (savedKey) {
            setApiKey(savedKey);
        }
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!outlineText.trim()) {
            setError('Please enter the raw outline text.');
            return;
        }

        setLoading(true);
        setError(null);

        // Save API key if provided
        if (apiKey) {
            localStorage.setItem('wpa_gemini_api_key', apiKey);
        } else {
            localStorage.removeItem('wpa_gemini_api_key');
        }

        try {
            const res = await fetch('/api/series/generate-from-outline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    outlineText,
                    startYear: parseInt(startYear),
                    apiKey: apiKey || undefined
                })
            });

            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Failed to generate series content');
            }

            onGenerate(result.data);
        } catch (err) {
            console.error('AI Generation Error:', err);
            setError(err.message || 'An error occurred during generation.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-backdrop z-[60]">
            <div className="modal-panel max-w-3xl max-h-[90vh]">
                {/* Modal Header */}
                <div className="modal-header">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand flex items-center justify-center shrink-0">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-ink">Generate Series with AI Agent</h3>
                            <p className="text-xs text-gray-500">Convert plain text or markdown outlines into structured series JSON</p>
                        </div>
                    </div>
                    <button
                        onClick={onCancel}
                        className="icon-btn"
                        disabled={loading}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
                    {error && (
                        <div className="alert alert-error">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Start Year Input */}
                        <div>
                            <label className="label flex items-center gap-1.5">
                                <Calendar size={14} className="text-gray-400" />
                                Start Year
                            </label>
                            <input
                                type="number"
                                value={startYear}
                                onChange={(e) => setStartYear(e.target.value)}
                                className="input"
                                placeholder="e.g. 2025"
                                required
                                disabled={loading}
                            />
                        </div>

                        {/* API Key Input */}
                        <div>
                            <label className="label flex items-center gap-1.5">
                                <Key size={14} className="text-gray-400" />
                                Gemini API Key (Optional)
                            </label>
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="input"
                                placeholder="Leave empty to use server env API key"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {/* Outline Text Area */}
                    <div>
                        <label className="label">
                            Outline Text / Markdown
                        </label>
                        <textarea
                            value={outlineText}
                            onChange={(e) => setOutlineText(e.target.value)}
                            className="input h-72 font-mono resize-y"
                            placeholder={`Paste your outline here. E.g.,
NUMBERS
Dates: Oct 6 - Nov 28, 2025
...
Oct 6
Read: Num. 1:1-19
Prayer:
- Pray that God will help you to understand...
- Pray that you will value...`}
                            required
                            disabled={loading}
                        />
                    </div>
                </form>

                {/* Modal Footer */}
                <div className="modal-footer">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="btn btn-ghost"
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="btn btn-primary"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Generating Series...</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={16} />
                                <span>Generate Series</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AiGeneratorModal;
