import React, { useEffect, useState } from 'react';
import Header from './components/Header';
import { request } from './api/seriesBuilderApi';
import { BarChart3, MessageSquare, Heart, RefreshCw, Users } from 'lucide-react';

export default function Stats() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [dateFilter, setDateFilter] = useState('');

    const fetchStats = React.useCallback(async () => {
        try {
            setLoading(true);
            const queryParams = new URLSearchParams();
            if (dateFilter) queryParams.append('from', dateFilter);

            setStats(await request(`/api/stats?${queryParams.toString()}`));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [dateFilter]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

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

    const kpis = [
        { label: 'Total Users', value: stats?.totalUsers, icon: Users },
        { label: 'Prayer Requests', value: stats?.prayerRequests, icon: Heart },
        { label: 'Testimonies', value: stats?.testimonies, icon: MessageSquare },
    ];

    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <Header
                title="Stats Dashboard"
                subtitle="App usage and engagement at a glance"
                icon={BarChart3}
                actions={
                    <>
                        <label className="flex items-center gap-2 bg-white pl-3 pr-2 py-1.5 rounded-full border border-gray-300 shadow-xs focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">From</span>
                            <input
                                type="date"
                                value={dateFilter}
                                onChange={(e) => setDateFilter(e.target.value)}
                                className="text-sm border-none focus:outline-none text-gray-700 bg-transparent p-0"
                            />
                        </label>
                        <button
                            onClick={fetchStats}
                            className="btn btn-secondary"
                            title="Refresh"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            <span>Refresh</span>
                        </button>
                    </>
                }
            />

            <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
                {error && (
                    <div className="alert alert-error mb-6">
                        Error: {error}
                    </div>
                )}

                {loading && !stats ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-100 border-t-brand"></div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* KPI Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {kpis.map(({ label, value, icon }) => {
                                const Icon = icon;
                                return (
                                    <div key={label} className="card card-body flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand flex items-center justify-center shrink-0">
                                            <Icon size={24} />
                                        </div>
                                        <div>
                                            <p className="section-label">{label}</p>
                                            {loading ? (
                                                <div className="h-8 w-24 bg-gray-200 rounded animate-pulse mt-1"></div>
                                            ) : (
                                                <p className="font-display text-3xl font-bold text-ink">{value || 0}</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {stats?.currentSeries && (
                            <div className="card overflow-hidden">
                                {/* Current Series Header */}
                                <div className="px-6 py-5 bg-gradient-to-r from-ink-800 to-ink-700">
                                    <p className="text-xs font-bold tracking-[0.2em] uppercase text-brand-300 mb-1">Current Active Series</p>
                                    <h2 className="text-2xl font-bold text-white">{stats.currentSeries.title}</h2>
                                </div>

                                {/* Current Series Engagement */}
                                <div className="card-body">
                                    <div className="mb-6">
                                        <h3 className="card-title">Engagement Breakdown</h3>
                                        <p className="text-sm text-gray-500">By Content Type</p>
                                    </div>

                                    <div className="space-y-4">
                                        {Object.entries(stats.currentSeries.engagement || {}).map(([type, count]) => {
                                            // Calculate max for relative width, defaulting to total count or a reasonable max
                                            const values = Object.values(stats.currentSeries.engagement);
                                            const max = Math.max(...values, 1);
                                            const percentage = Math.round((count / max) * 100);

                                            return (
                                                <div key={type} className="flex items-center gap-4">
                                                    <div className="w-24 text-sm font-semibold text-gray-600 capitalize">{type}</div>
                                                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-brand rounded-full transition-all duration-500"
                                                            style={{ width: `${percentage}%` }}
                                                        />
                                                    </div>
                                                    <div className="w-12 text-sm text-ink font-bold text-right tabular-nums">{count}</div>
                                                </div>
                                            );
                                        })}
                                        {(!stats.currentSeries.engagement || Object.keys(stats.currentSeries.engagement).length === 0) && (
                                            <p className="text-gray-400 italic text-center py-4">No engagement data available yet.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Histogram */}
                        <div className="card card-body">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="card-title">User Progress Distribution</h3>
                                <div className="bg-brand-50 text-brand-700 px-3 py-1 rounded-full text-xs font-bold">
                                    {stats?.progress?.length || 0} Total Users
                                </div>
                            </div>

                            <div className="h-64 flex items-end justify-between gap-2 border-b border-gray-200">
                                {buckets.map((count, i) => {
                                    const height = `${(count / maxCount) * 100}%`;
                                    return (
                                        <div key={i} className="flex-1 h-full flex flex-col items-center justify-end group">
                                            <div className="relative w-full flex-1 flex items-end justify-center">
                                                <div
                                                    className="w-full bg-brand-200 group-hover:bg-brand transition-colors rounded-t-md"
                                                    style={{ height: height === '0%' ? '4px' : height }}
                                                ></div>
                                                {/* Tooltip */}
                                                <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-ink text-white text-xs font-semibold py-1 px-2 rounded-md shadow-lg pointer-events-none whitespace-nowrap">
                                                    {count} users
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex justify-between gap-2 mt-2">
                                {buckets.map((_, i) => (
                                    <div key={i} className="flex-1 text-center text-[11px] text-gray-500 tabular-nums">
                                        {`${i * 10}-${(i + 1) * 10}%`}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-6 text-center section-label">
                                Percentage of Series Completed
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
