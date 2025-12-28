import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Header({ title, icon: Icon, actions, fullWidth = false }) {
    return (
        <div className="w-full bg-white shadow-sm border-b border-gray-200 shrink-0">
            <div className={`${fullWidth ? 'w-full px-6' : 'max-w-5xl mx-auto px-6'} py-4 flex items-center justify-between`}>
                <div className="flex items-center space-x-4">
                    <Link to="/" className="text-gray-500 hover:text-gray-900 transition-colors">
                        <ArrowLeft size={24} />
                    </Link>
                    <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        {Icon && <Icon size={24} className="text-blue-600" />}
                        {title}
                    </h1>
                </div>
                {actions && (
                    <div className="flex items-center space-x-3">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
}
