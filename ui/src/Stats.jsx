import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from './components/Header';
import { ArrowLeft, BarChart3, MessageSquare, Heart, RefreshCw } from 'lucide-react';

export default function Stats() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchStats = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/stats');
            if (!res.ok) throw new Error('Failed to fetch stats');
            const data = await res.json();
            setStats(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, []);

    // Process histogram data
    // Buckets: 0-10, 10-20, ..., 90-100
    const buckets = new Array(10).fill(1);
    if (stats && stats.progress) {
        stats.progress.forEach(p => {
            // p is percentage 0-100
            // Ensure 100 goes into the last bucket (index 9)
            const val = Number(p);
            const index = Math.min(Math.floor(val / 10), 9);
            buckets[index]++;
        });
    }

    const maxCount = Math.max(...buckets, 1); // Avoid div by zero

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <Header
                title="Stats Dashboard"
                icon={BarChart3}
                actions={
                    <button
                        onClick={fetchStats}
                        className="p-2 text-gray-500 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-100"
                        title="Refresh"
                    >
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                }
            />

            <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
                {error && (
                    <div className="mb-8 bg-red-50 border-l-4 border-red-500 p-4 text-red-700">
                        Error: {error}
                    </div>
                )}

                {loading && !stats ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* Current Series Header */}
                        {stats?.currentSeries && (
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-blue-600 uppercase tracking-wider mb-1">Current Active Series</p>
                                    <h2 className="text-2xl font-bold text-gray-900">{stats.currentSeries.title}</h2>
                                </div>
                            </div>
                        )}

                        {/* KPI Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center space-x-4">
                                <div className="p-4 bg-red-50 text-red-500 rounded-full">
                                    <Heart size={32} />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-500">Prayer Requests</p>
                                    <h2 className="text-3xl font-bold text-gray-900">{stats?.prayerRequests || 0}</h2>
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center space-x-4">
                                <div className="p-4 bg-blue-50 text-blue-500 rounded-full">
                                    <MessageSquare size={32} />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-500">Testimonies</p>
                                    <h2 className="text-3xl font-bold text-gray-900">{stats?.testimonies || 0}</h2>
                                </div>
                            </div>
                        </div>

                        {/* Current Series Engagement */}
                        {stats?.currentSeries && (
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900">Engagement Breakdown</h3>
                                        <p className="text-sm text-gray-500">By Content Type</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {Object.entries(stats.currentSeries.engagement || {}).map(([type, count]) => {
                                        // Calculate max for relative width, defaulting to total count or a reasonable max
                                        const values = Object.values(stats.currentSeries.engagement);
                                        const max = Math.max(...values, 1);
                                        const percentage = Math.round((count / max) * 100);

                                        // Format type label (e.g., "read" -> "Read")
                                        const label = type.charAt(0).toUpperCase() + type.slice(1);

                                        return (
                                            <div key={type} className="flex items-center gap-4">
                                                <div className="w-24 text-sm font-medium text-gray-600 capitalize">{type}</div>
                                                <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${percentage}%` }}
                                                    />
                                                </div>
                                                <div className="w-12 text-sm text-gray-900 font-bold text-right">{count}</div>
                                            </div>
                                        );
                                    })}
                                    {(!stats.currentSeries.engagement || Object.keys(stats.currentSeries.engagement).length === 0) && (
                                        <p className="text-gray-400 italic text-center py-4">No engagement data available yet.</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Histogram */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-lg font-bold text-gray-900">User Progress Distribution</h3>
                                <div className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-medium">
                                    {stats?.progress?.length || 0} Total Users
                                </div>
                            </div>

                            <div className="h-64 flex items-end justify-between space-x-2">
                                {buckets.map((count, i) => {
                                    const height = `${(count / maxCount) * 100}%`;
                                    const label = `${i * 10}-${(i + 1) * 10}%`;
                                    return (
                                        <div key={i} className="flex-1 h-full flex flex-col items-center justify-end group">
                                            <div className="relative w-full flex-1 flex items-end justify-center">
                                                <div
                                                    className="w-full bg-blue-300 group-hover:bg-blue-600 transition-all rounded-t-sm"
                                                    style={{ height: height === '0%' ? '4px' : height }}
                                                ></div>
                                                {/* Tooltip */}
                                                <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 text-white text-xs py-1 px-2 rounded shadow-lg pointer-events-none">
                                                    {count} users
                                                </div>
                                            </div>
                                            <div className="mt-2 text-xs text-gray-500 rotate-45 origin-left sm:rotate-0 translate-y-2 sm:translate-y-0">
                                                {label}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-8 text-center text-sm text-gray-400">
                                Percentage of Series Completed
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
