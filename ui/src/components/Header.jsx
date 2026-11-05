import React from 'react';
import { Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import EnvSwitcher from './EnvSwitcher';
import logo from '../assets/logo.png';

export default function Header({ title, subtitle, icon: Icon, actions, fullWidth = false }) {
    const { logout } = useAuth();
    // The brand bar is always centred so it stays put across pages; only the
    // page bar stretches for full-width layouts like the Series Creator.
    const brandContainerClass = 'max-w-6xl mx-auto px-6';
    const pageContainerClass = fullWidth ? 'w-full px-6' : brandContainerClass;

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error("Failed to log out", error);
        }
    };

    return (
        <header className="w-full shrink-0">
            {/* Brand bar */}
            <div className="bg-ink text-white">
                <div className={`${brandContainerClass} h-16 flex items-center justify-between gap-6`}>
                    <Link to="/" className="flex items-center gap-3 min-w-0 rounded-lg transition-opacity hover:opacity-80" title="Back to Admin Console home">
                        <img src={logo} alt="WPA" className="h-9 w-auto shrink-0" />
                        <span className="hidden sm:block h-6 w-px bg-white/20" />
                        <span className="hidden sm:block font-display text-sm font-semibold tracking-[0.14em] uppercase text-white/90 whitespace-nowrap">
                            Admin Console
                        </span>
                    </Link>
                    <div className="flex items-center gap-3 shrink-0">
                        <EnvSwitcher />
                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-2 px-3 py-2 rounded-full text-sm font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                            title="Sign Out"
                        >
                            <LogOut size={16} />
                            <span className="hidden sm:inline">Sign Out</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Page bar */}
            {title && (
                <div className="bg-white border-b border-gray-200">
                    <div className={`${pageContainerClass} py-4 flex flex-wrap items-center justify-between gap-4`}>
                        <div className="flex items-center gap-3 min-w-0">
                            {Icon && (
                                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand flex items-center justify-center shrink-0">
                                    <Icon size={20} />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h1 className="text-xl font-bold text-ink leading-tight truncate">{title}</h1>
                                {subtitle && <p className="text-sm text-gray-500 truncate">{subtitle}</p>}
                            </div>
                        </div>
                        {actions && (
                            <div className="flex flex-wrap items-center gap-2">
                                {actions}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
}
