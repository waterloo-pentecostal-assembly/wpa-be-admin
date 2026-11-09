import React from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children }) {
    const { currentUser, isAdmin, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center gap-3 bg-canvas text-gray-500">
                <Loader2 size={20} className="animate-spin text-brand" />
                <span className="text-sm font-medium">Loading...</span>
            </div>
        );
    }

    if (!currentUser || !isAdmin) {
        return <Navigate to="/login" replace />;
    }

    return children;
}
