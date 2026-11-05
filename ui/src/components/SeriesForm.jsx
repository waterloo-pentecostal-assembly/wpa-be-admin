import React from 'react';

const SeriesForm = ({ data, onChange }) => {
    const handleChange = (field, value) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="card mb-6">
            <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="card-title">Series Metadata</h2>
            </div>
            <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                    <label className="label">Title</label>
                    <input
                        type="text"
                        value={data.title || ''}
                        onChange={(e) => handleChange('title', e.target.value)}
                        className="input"
                    />
                </div>
                <div>
                    <label className="label">Subtitle</label>
                    <input
                        type="text"
                        value={data.sub_title || ''}
                        onChange={(e) => handleChange('sub_title', e.target.value)}
                        className="input"
                    />
                </div>
                <div className="md:col-span-2">
                    <label className="label">Image GS Location</label>
                    <input
                        type="text"
                        value={data.image_gs_location || ''}
                        onChange={(e) => handleChange('image_gs_location', e.target.value)}
                        className="input font-mono"
                    />
                </div>
                <div className="md:col-span-2 flex flex-wrap gap-3">
                    <label className="flex items-center gap-2 cursor-pointer rounded-full border border-gray-200 bg-gray-50 px-4 py-2 hover:border-gray-300">
                        <input
                            type="checkbox"
                            checked={data.is_active || false}
                            onChange={(e) => handleChange('is_active', e.target.checked)}
                            className="checkbox"
                        />
                        <span className="text-sm font-semibold text-gray-700">Is Active</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer rounded-full border border-gray-200 bg-gray-50 px-4 py-2 hover:border-gray-300">
                        <input
                            type="checkbox"
                            checked={data.is_visible || false}
                            onChange={(e) => handleChange('is_visible', e.target.checked)}
                            className="checkbox"
                        />
                        <span className="text-sm font-semibold text-gray-700">Is Visible</span>
                    </label>
                </div>
            </div>
        </div>
    );
};

export default SeriesForm;
