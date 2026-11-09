import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './Home';
import SeriesBuilderPage from './seriesBuilder/SeriesBuilderPage';
import Stats from './Stats';
import Login from './Login';
import NotificationTester from './NotificationTester';
import EnvGate from './components/EnvGate';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { EnvProvider } from './contexts/EnvContext';

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <EnvProvider>
                    <EnvGate>
                        <Routes>
                            <Route path="/login" element={<Login />} />
                            <Route
                                path="/"
                                element={
                                    <ProtectedRoute>
                                        <Home />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/bible-series"
                                element={
                                    <ProtectedRoute>
                                        <SeriesBuilderPage />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/stats"
                                element={
                                    <ProtectedRoute>
                                        <Stats />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/notifications"
                                element={
                                    <ProtectedRoute>
                                        <NotificationTester />
                                    </ProtectedRoute>
                                }
                            />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </EnvGate>
                </EnvProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
