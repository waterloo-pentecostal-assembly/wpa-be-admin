import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, BarChart3, Bell, Users, ArrowRight } from 'lucide-react';
import Header from './components/Header';

const TOOLS = [
    {
        to: '/bible-series',
        icon: BookOpen,
        title: 'Bible Series Content Manager',
        description: 'Create and manage daily engagement content for bible series.',
    },
    {
        to: '/stats',
        icon: BarChart3,
        title: 'Stats Dashboard',
        description: 'View app usage statistics, prayer requests, testimonies, and user progress.',
    },
    {
        to: '/users',
        icon: Users,
        title: 'User Manager',
        description: 'Search users, send password reset links, verify, deactivate and manage admin access.',
    },
    {
        to: '/notifications',
        icon: Bell,
        title: 'Notification Hub',
        description: 'Send push notifications to devices, users, or groups such as users behind on the current series.',
    },
];

const Home = () => {
    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <Header />

            {/* Hero */}
            <section className="bg-gradient-to-b from-ink-800 to-ink-700 text-white">
                <div className="max-w-6xl mx-auto px-6 py-14">
                    <p className="text-xs font-bold tracking-[0.2em] uppercase text-brand-300 mb-3">Bible Engagement App</p>
                    <h1 className="font-display text-3xl md:text-4xl font-bold text-white tracking-tight">
                        WPA BE Admin Console
                    </h1>
                    <p className="mt-3 max-w-2xl text-white/70">
                        Manage, monitor, and support the WPA Bible Engagement App.
                    </p>
                </div>
            </section>

            <main className="flex-1 w-full max-w-6xl mx-auto px-6 -mt-8 pb-16">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {TOOLS.map(({ to, icon, title, description }) => {
                        const Icon = icon;
                        return (
                            <Link
                                key={to}
                                to={to}
                                className="group card p-6 flex flex-col h-full transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-brand-200"
                            >
                                <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand flex items-center justify-center mb-5 transition-colors group-hover:bg-brand group-hover:text-white">
                                    <Icon size={24} />
                                </div>
                                <h2 className="text-lg font-bold text-ink mb-2">{title}</h2>
                                <p className="text-sm text-gray-500 flex-1">{description}</p>
                                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                                    Open
                                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </main>
        </div>
    );
};

export default Home;
