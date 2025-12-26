import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, LogOut } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';


import logo from './assets/logo.png';

const Home = () => {
    const { logout } = useAuth();

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error("Failed to log out", error);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="w-full bg-gray-800 shadow-sm mb-12">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <img src={logo} alt="WPA Logo" className="h-12 w-auto" />
                        <h1 className="text-2xl font-bold text-white tracking-tight">WPA BE Admin Console</h1>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors px-3 py-2 rounded-md hover:bg-gray-700"
                        title="Sign Out"
                    >
                        <LogOut size={20} />
                        <span className="text-sm font-medium">Sign Out</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl w-full px-6">
                    <Link to="/bible-series" className="group">
                        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-brand-300 transition-all flex flex-col items-center text-center h-full">
                            <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center text-brand mb-4 group-hover:bg-brand group-hover:text-white transition-colors">
                                <BookOpen size={32} />
                            </div>
                            <h2 className="text-xl font-bold text-gray-800 mb-2">Bible Series Content Manager</h2>
                            <p className="text-gray-500 text-sm">Create and manage daily engagement content for bible series.</p>
                        </div>
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default Home;
