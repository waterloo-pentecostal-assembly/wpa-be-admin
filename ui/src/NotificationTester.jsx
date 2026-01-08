import React, { useState } from 'react';
import Header from './components/Header';
import { Bell, Send, AlertCircle, CheckCircle } from 'lucide-react';

const NotificationTester = () => {
    const [token, setToken] = useState('');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [notificationType, setNotificationType] = useState('prayerRequestPrayed');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null); // { type: 'success' | 'error', message: string }

    const handleSend = async (e) => {
        e.preventDefault();
        setLoading(true);
        setResult(null);

        try {
            const res = await fetch('/api/notifications/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    title,
                    body,
                    data: {
                        notificationType: notificationType
                    }
                })
            });
            const data = await res.json();

            if (res.ok) {
                setResult({ type: 'success', message: `Message sent! ID: ${data.messageId}` });
            } else {
                setResult({ type: 'error', message: data.error || 'Failed to send message' });
            }
        } catch (err) {
            setResult({ type: 'error', message: err.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
            <Header title="Notification Tester" icon={Bell} />

            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                    <form onSubmit={handleSend} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Device Token (FCM Token)</label>
                            <input
                                type="text"
                                required
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand focus:border-transparent font-mono text-sm"
                                placeholder="e.g. fH7n..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                            <input
                                type="text"
                                required
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand focus:border-transparent"
                                placeholder="Notification Title"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                            <textarea
                                required
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                rows={4}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand focus:border-transparent"
                                placeholder="Notification Body..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notification Type (Data Payload)</label>
                            <input
                                type="text"
                                value={notificationType}
                                onChange={e => setNotificationType(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand focus:border-transparent font-mono text-sm"
                                placeholder="e.g. prayerRequestPrayed"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full flex justify-center items-center space-x-2 py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {loading ? <span>Sending...</span> : <><Send size={18} /><span>Send Notification</span></>}
                        </button>
                    </form>

                    {result && (
                        <div className={`mt-6 p-4 rounded-lg flex items-start space-x-3 ${result.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                            {result.type === 'success' ? <CheckCircle className="flex-shrink-0" size={20} /> : <AlertCircle className="flex-shrink-0" size={20} />}
                            <div className="text-sm font-medium break-all">{result.message}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NotificationTester;
