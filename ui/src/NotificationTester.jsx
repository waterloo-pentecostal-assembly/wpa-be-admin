import React, { useState } from 'react';
import Header from './components/Header';
import { Bell, Send, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

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
        <div className="flex flex-col h-screen bg-canvas">
            <Header
                title="Notification Tester"
                subtitle="Send a test push notification to a single device"
                icon={Bell}
            />

            <div className="flex-1 overflow-y-auto px-6 py-8">
                <div className="max-w-xl mx-auto card card-body sm:p-8">
                    <form onSubmit={handleSend} className="space-y-5">
                        <div>
                            <label className="label">Device Token (FCM Token)</label>
                            <input
                                type="text"
                                required
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                className="input font-mono"
                                placeholder="e.g. fH7n..."
                            />
                        </div>

                        <div>
                            <label className="label">Title</label>
                            <input
                                type="text"
                                required
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                className="input"
                                placeholder="Notification Title"
                            />
                        </div>

                        <div>
                            <label className="label">Body</label>
                            <textarea
                                required
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                rows={4}
                                className="input"
                                placeholder="Notification Body..."
                            />
                        </div>

                        <div>
                            <label className="label">Notification Type (Data Payload)</label>
                            <input
                                type="text"
                                value={notificationType}
                                onChange={e => setNotificationType(e.target.value)}
                                className="input font-mono"
                                placeholder="e.g. prayerRequestPrayed"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn btn-primary w-full py-2.5"
                        >
                            {loading ? <><Loader2 size={18} className="animate-spin" /><span>Sending...</span></> : <><Send size={18} /><span>Send Notification</span></>}
                        </button>
                    </form>

                    {result && (
                        <div className={`alert mt-6 ${result.type === 'success' ? 'alert-success' : 'alert-error'}`}>
                            {result.type === 'success' ? <CheckCircle className="shrink-0" size={20} /> : <AlertCircle className="shrink-0" size={20} />}
                            <div className="font-medium break-all">{result.message}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NotificationTester;
