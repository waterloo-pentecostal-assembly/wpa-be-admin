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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
                {/* Modal Header */}
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
                    <div className="flex items-center space-x-2">
                        <div className="bg-brand-50 p-2 rounded-lg text-brand">
                            <Sparkles size={20} className="text-blue-600" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-gray-800">Generate Series with AI Agent</h3>
                            <p className="text-xs text-gray-500">Convert plain text or markdown outlines into structured series JSON</p>
                        </div>
                    </div>
                    <button 
                        onClick={onCancel} 
                        className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        disabled={loading}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Start Year Input */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Calendar size={14} className="text-gray-400" />
                                Start Year
                            </label>
                            <input
                                type="number"
                                value={startYear}
                                onChange={(e) => setStartYear(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                                placeholder="e.g. 2025"
                                required
                                disabled={loading}
                            />
                        </div>

                        {/* API Key Input */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Key size={14} className="text-gray-400" />
                                Gemini API Key (Optional)
                            </label>
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                                placeholder="Leave empty to use server env API key"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {/* Outline Text Area */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                            Outline Text / Markdown
                        </label>
                        <textarea
                            value={outlineText}
                            onChange={(e) => setOutlineText(e.target.value)}
                            className="w-full h-72 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent resize-y"
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
                <div className="p-4 border-t bg-gray-50 flex justify-end space-x-3 rounded-b-xl">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 active:scale-95 transition-all shadow flex items-center space-x-2"
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
