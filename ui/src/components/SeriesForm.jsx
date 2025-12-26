import React from 'react';

const SeriesForm = ({ data, onChange }) => {
    const handleChange = (field, value) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Series Metadata</h2>
            <div className="grid grid-cols-1 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                    <input
                        type="text"
                        value={data.title || ''}
                        onChange={(e) => handleChange('title', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand focus:border-brand"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
                    <input
                        type="text"
                        value={data.sub_title || ''}
                        onChange={(e) => handleChange('sub_title', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand focus:border-brand"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Image GS Location</label>
                    <input
                        type="text"
                        value={data.image_gs_location || ''}
                        onChange={(e) => handleChange('image_gs_location', e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand focus:border-brand"
                    />
                </div>
                <div className="flex space-x-6">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={data.is_active || false}
                            onChange={(e) => handleChange('is_active', e.target.checked)}
                            className="h-4 w-4 text-brand rounded border-gray-300 focus:ring-brand"
                        />
                        <span className="text-sm font-medium text-gray-700">Is Active</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={data.is_visible || false}
                            onChange={(e) => handleChange('is_visible', e.target.checked)}
                            className="h-4 w-4 text-brand rounded border-gray-300 focus:ring-brand"
                        />
                        <span className="text-sm font-medium text-gray-700">Is Visible</span>
                    </label>
                </div>
            </div>
        </div>
    );
};

export default SeriesForm;
