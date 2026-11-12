// Notification Hub: compose a push notification, choose who gets it (device
// tokens, users, or groups such as users behind on the current series),
// preview the audience, then send — or dry-run it, or send a test to your own
// devices first. Recent sends are listed with who sent them.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, BellRing, BookOpen, CheckCircle2, Clock, Eye, FlaskConical, History, KeyRound, Loader2, Plus, RefreshCw,
    Rocket, Send, ShieldCheck, Smartphone, Trash2, TrendingDown, TrendingUp, Trophy, UserPlus, UserX, Users, UsersRound,
} from 'lucide-react';
import Header from '../components/Header';
import { Dialog, Toasts } from '../seriesBuilder/ui';
import { useEnv } from '../contexts/EnvContext';
import * as api from '../api/notificationsApi';
import { RelativeTime } from '../users/shared';
import { formatDate } from '../users/format';
import UserPicker from './UserPicker';
import { EXAMPLE_VALUES, PLACEHOLDERS, PLACEHOLDER_GROUPS, placeholderValues, renderTemplate, unknownPlaceholders, usesGroup } from './placeholders';
import appIcon from '../assets/app-icon.png';
import { ManageTemplatesDialog, TemplateDialog, TemplatesBar } from './templates';

const AUDIENCES = [
    { type: 'tokens', icon: KeyRound, label: 'Device tokens', hint: 'Specific devices by their FCM token' },
    { type: 'users', icon: Users, label: 'Specific users', hint: 'All or some of a user\'s devices' },
    { type: 'behind', icon: TrendingDown, label: 'Behind on series', hint: 'Below the expected % of the current series', progress: true },
    { type: 'ahead', icon: TrendingUp, label: 'Ahead on series', hint: 'Above the expected % of the current series', progress: true },
    { type: 'not_started', icon: UserX, label: 'Haven\'t started', hint: 'No progress yet in the current series', progress: true },
    { type: 'completed', icon: Trophy, label: 'Completed series', hint: 'Every day of the current series done', progress: true },
    { type: 'recent', icon: UserPlus, label: 'Signed up recently', hint: 'Joined in the last few days' },
    { type: 'all', icon: UsersRound, label: 'All users', hint: 'Every user with a registered device' },
    { type: 'admins', icon: ShieldCheck, label: 'Admins', hint: 'Users with admin access' },
];
const GROUPS = new Set(['behind', 'ahead', 'not_started', 'completed', 'recent', 'all', 'admins']);
const PROGRESS = new Set(['behind', 'ahead', 'not_started', 'completed']);

const DEFAULT_GROUP = { minBehindPct: 0, includeToday: false, includeNotStarted: false, minAheadPct: 0, withinDays: 7, excludeDisabled: true, skipOptedOut: null };
// How the app routes a tapped notification (wpa-be-app,
// lib/services/firebase_messaging_service.dart): notificationType
// "dailyEngagementReminder" with bibleSeriesId (the bible_series document ID)
// opens that series on the Engage tab.
const SERIES_LINK_TYPE = 'dailyEngagementReminder';
const SERIES_ID_KEY = 'bibleSeriesId';
// FCM's payload limit is 4KB; long notifications are also cut off on screen.
const TITLE_SOFT_LIMIT = 65;
const BODY_SOFT_LIMIT = 240;
// Sends to at least this many devices need the count typed to confirm.
const TYPE_TO_CONFIRM_AT = 10;

function useToasts() {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(0);
    const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
    const toast = useCallback((message, tone = 'info', action = null) => {
        const id = ++nextId.current;
        setToasts((list) => [...list, { id, message, tone, action }]);
        setTimeout(() => dismiss(id), tone === 'error' || action ? 8000 : 5000);
    }, [dismiss]);
    return { toasts, toast, dismiss };
}

const plural = (value, word, many = `${word}s`) => {
    const n = Number(value) || 0;
    return `${n.toLocaleString()} ${n === 1 ? word : many}`;
};
const countTokens = (text) => new Set(text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)).size;

/** The request body's audience from the form. */
function buildAudience(type, { tokensText, chosen, group }) {
    if (type === 'tokens') return { type, tokens: tokensText };
    if (type === 'users') return { type, users: chosen.map((c) => (c.mode === 'some' ? { uid: c.uid, deviceIds: c.deviceIds } : { uid: c.uid })) };
    const audience = { type, excludeDisabled: group.excludeDisabled, skipOptedOut: group.skipOptedOut ?? PROGRESS.has(type) };
    if (type === 'behind') Object.assign(audience, { minBehindPct: group.minBehindPct, includeToday: group.includeToday, includeNotStarted: group.includeNotStarted });
    if (type === 'ahead') audience.minAheadPct = group.minAheadPct;
    if (type === 'recent') audience.withinDays = group.withinDays;
    return audience;
}

/** Why the audience can't be previewed or sent yet, or null. */
function audienceProblem(type, { tokensText, chosen }) {
    if (type === 'tokens' && !countTokens(tokensText)) return 'Paste at least one device token.';
    if (type === 'users' && !chosen.length) return 'Add at least one user.';
    if (type === 'users' && chosen.some((c) => c.mode === 'some' && !c.deviceIds.length)) return 'Tick at least one device for each user set to selected devices.';
    return null;
}

/** A group audience in a few words, e.g. "Behind on series (by more than 5 points)". */
function describeGroup(audience) {
    const label = AUDIENCES.find((a) => a.type === audience?.type)?.label ?? audience?.type ?? '';
    if (audience?.type === 'behind' && audience.minBehindPct > 0) return `${label} (by more than ${audience.minBehindPct} points)`;
    if (audience?.type === 'ahead' && audience.minAheadPct > 0) return `${label} (by more than ${audience.minAheadPct} points)`;
    if (audience?.type === 'recent') return `${label} (last ${audience.withinDays} days)`;
    return label;
}

/** JSON with object keys sorted, so equal values compare equal whatever order Firestore returns keys in. */
const canonical = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
    : v));

/** Whether a saved template has the same title, message and data as the form. */
function sameMessage(template, message) {
    return template.title === message.title && template.body === message.body && canonical(template.data ?? {}) === canonical(message.data ?? {});
}

/** The data payload from the notification type and extra rows. */
function buildData(notificationType, rows) {
    const data = {};
    for (const { key, value } of rows) if (key.trim()) data[key.trim()] = value;
    if (notificationType.trim()) data.notificationType = notificationType.trim();
    return data;
}

export default function NotificationHubPage() {
    const { env } = useEnv();
    const { toasts, toast, dismiss } = useToasts();

    // Audience
    const [type, setType] = useState('behind');
    const [tokensText, setTokensText] = useState('');
    const [chosen, setChosen] = useState([]);
    const [group, setGroup] = useState(DEFAULT_GROUP);
    const setGroupField = (key, value) => setGroup((g) => ({ ...g, [key]: value }));

    // Message
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [notificationType, setNotificationType] = useState('');
    const [dataRows, setDataRows] = useState([]);
    const titleRef = useRef(null);
    const bodyRef = useRef(null);
    const lastField = useRef('body');
    const [sampleUid, setSampleUid] = useState('');

    // Server state
    const [series, setSeries] = useState(undefined);
    // Groups the server supports; null until loaded. An older server sends none.
    const [serverAudiences, setServerAudiences] = useState(null);
    const [seriesError, setSeriesError] = useState(null);
    const [preview, setPreview] = useState(null);
    const [previewKey, setPreviewKey] = useState(null);
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(null); // 'preview' | 'dry' | 'test' | 'confirm' | 'send'
    const [confirm, setConfirm] = useState(null);
    const [history, setHistory] = useState(null);
    const [templates, setTemplates] = useState(null);
    const [templatesError, setTemplatesError] = useState(null);
    const [loadedTemplateId, setLoadedTemplateId] = useState(null);
    const [templateDialog, setTemplateDialog] = useState(null); // 'create' | 'update'
    const [managingTemplates, setManagingTemplates] = useState(false);
    const [historyError, setHistoryError] = useState(null);

    const form = { tokensText, chosen, group };
    const audience = useMemo(() => buildAudience(type, { tokensText, chosen, group }), [type, tokensText, chosen, group]);
    const audienceKey = JSON.stringify([env, audience]);
    // A server started before this group was added rejects it; say so up front.
    const serverOutdated = serverAudiences !== null && !serverAudiences.includes(type);
    const problem = serverOutdated ? 'Restart the server to use this group.' : audienceProblem(type, form);
    const message = { title: title.trim(), body: body.trim(), data: buildData(notificationType, dataRows) };
    const unknown = unknownPlaceholders(title, body);
    const messageReady = !!message.title && !!message.body && !unknown.length;
    // Progress costs a read per user (their achievements), so the preview only
    // asks for it when the message shows it (progress audiences always get it).
    const needsProgress = usesGroup('progress', title, body);

    // Switching group starts over: a preview of another group would mislead.
    const chooseType = (next) => {
        if (next === type) return;
        setType(next);
        setPreview(null);
        setSampleUid('');
    };

    // Placeholders go where the cursor was in the title or message.
    const insertPlaceholder = (key) => {
        const field = lastField.current === 'title' ? titleRef.current : bodyRef.current;
        const [value, setValue] = lastField.current === 'title' ? [title, setTitle] : [body, setBody];
        const token = `{${key}}`;
        const start = field?.selectionStart ?? value.length;
        const end = field?.selectionEnd ?? value.length;
        setValue(value.slice(0, start) + token + value.slice(end));
        requestAnimationFrame(() => {
            field?.focus();
            field?.setSelectionRange(start + token.length, start + token.length);
        });
    };

    // The phone preview shows the message as one recipient would get it.
    const sampleUser = preview?.users.find((u) => u.uid === sampleUid) ?? null;
    const sampleValues = sampleUser
        ? placeholderValues({ user: sampleUser, progress: sampleUser.progress, series: preview.series })
        : EXAMPLE_VALUES;
    const audienceCurrent = preview && previewKey === audienceKey;
    // Progress placeholders added after previewing need progress the preview lacks.
    const missingProgress = !!preview && needsProgress && !preview.withProgress;
    const previewCurrent = audienceCurrent && !missingProgress;

    const loadSeries = useCallback(() => {
        setSeriesError(null);
        api.getSeriesStatus()
            .then((r) => { setSeries(r.series); setServerAudiences(Array.isArray(r.audiences) ? r.audiences : []); })
            .catch((e) => { setSeries(null); setSeriesError(e.message); });
    }, []);
    const loadHistory = useCallback(() => {
        api.getHistory().then((h) => { setHistory(h); setHistoryError(null); }).catch((e) => setHistoryError(e.message));
    }, []);
    const loadTemplates = useCallback(() => {
        api.listTemplates().then((t) => { setTemplates(t); setTemplatesError(null); }).catch((e) => { setTemplates([]); setTemplatesError(e.message); });
    }, []);
    useEffect(() => {
        if (!env) return;
        loadSeries();
        loadHistory();
        loadTemplates();
        setPreview(null);
        setResult(null);
        setLoadedTemplateId(null);
    }, [env, loadSeries, loadHistory, loadTemplates]);

    const runPreview = async () => {
        setBusy('preview');
        try {
            const p = await api.previewAudience(audience, { withProgress: needsProgress });
            setPreview(p);
            setPreviewKey(audienceKey);
            return p;
        } catch (e) {
            toast(e.message, 'error');
            return null;
        } finally {
            setBusy(null);
        }
    };

    const dryRun = async () => {
        setBusy('dry');
        try {
            const r = await api.sendNotification({ audience, message, dryRun: true });
            setResult(r);
            toast(`Dry run: ${plural(r.sent, 'message')} would be delivered${r.failed ? `, ${r.failed} would fail` : ''}.`);
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            setBusy(null);
        }
    };

    const sendTest = async () => {
        setBusy('test');
        try {
            const r = await api.sendTestToMe(message);
            toast(r.failed ? `Sent to ${r.sent} of your devices; ${r.failed} failed.` : `Sent to your ${plural(r.sent, 'device')}.`, r.failed ? 'error' : 'info');
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            setBusy(null);
        }
    };

    // Sending always re-previews so the confirmation shows the current numbers.
    const startSend = async () => {
        setBusy('confirm');
        const p = await runPreview();
        setBusy(null);
        if (!p) return;
        if (!p.deviceCount) {
            toast('Nobody would receive this: the audience has no devices with push tokens.', 'error');
            return;
        }
        setConfirm(p);
    };

    const send = async ({ removeInvalidTokens }) => {
        setBusy('send');
        try {
            const r = await api.sendNotification({ audience, message, removeInvalidTokens });
            setResult(r);
            setConfirm(null);
            toast(`Sent to ${plural(r.sent, 'device')}${r.failed ? `; ${r.failed} failed` : ''}.`, r.sent ? 'info' : 'error');
            loadHistory();
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            setBusy(null);
        }
    };

    /**
     * Puts a saved message (a template or a past send) into the form, with its
     * group audience if it has one. Undo puts the form back as it was.
     */
    const applyMessage = (item, { what, templateId = null }) => {
        const before = { title, body, notificationType, dataRows, type, group, loadedTemplateId, preview, previewKey };
        setTitle(item.title);
        setBody(item.body);
        const { notificationType: nt = '', ...rest } = item.data ?? {};
        setNotificationType(nt);
        setDataRows(Object.entries(rest).map(([key, value]) => ({ key, value })));
        const a = item.audience;
        const withAudience = !!a && GROUPS.has(a.type);
        if (withAudience) {
            if (a.type !== type) {
                setPreview(null);
                setSampleUid('');
            }
            setType(a.type);
            setGroup({ ...DEFAULT_GROUP, ...a });
        }
        setLoadedTemplateId(templateId);
        const undo = () => {
            setTitle(before.title);
            setBody(before.body);
            setNotificationType(before.notificationType);
            setDataRows(before.dataRows);
            setType(before.type);
            setGroup(before.group);
            setLoadedTemplateId(before.loadedTemplateId);
            setPreview(before.preview);
            setPreviewKey(before.previewKey);
        };
        toast(withAudience ? `Loaded ${what} and its audience.` : `Loaded ${what}${templateId ? '' : '; choose the recipients again'}.`, 'info', { label: 'Undo', run: undo });
    };

    const reuse = (item) => {
        applyMessage(item, { what: 'the message' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Templates
    const loadedTemplate = templates?.find((t) => t.id === loadedTemplateId) ?? null;
    const templateDirty = !!loadedTemplate && (!sameMessage(loadedTemplate, message)
        || (!!loadedTemplate.audience && canonical(loadedTemplate.audience) !== canonical(GROUPS.has(type) ? audience : null)));
    const saveTemplate = async ({ name, includeAudience }) => {
        const fields = { name, message, audience: includeAudience && GROUPS.has(type) ? audience : null };
        const saved = templateDialog === 'update' ? await api.updateTemplate(loadedTemplateId, fields) : await api.createTemplate(fields);
        setTemplates((list) => [...(list ?? []).filter((t) => t.id !== saved.id), saved].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })));
        setLoadedTemplateId(saved.id);
        setTemplateDialog(null);
        toast(templateDialog === 'update' ? `Updated "${saved.name}".` : `Saved "${saved.name}".`);
    };

    const current = AUDIENCES.find((a) => a.type === type);

    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <Header title="Notification Hub" subtitle="Send push notifications to devices, users and groups" icon={BellRing} />

            <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
                {env === 'prod' && (
                    <div className="alert border-amber-200 bg-amber-50 text-amber-900">
                        <AlertTriangle size={18} className="shrink-0" />
                        <span>You are in <strong>production</strong>: notifications go to real people&apos;s phones.</span>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* Audience */}
                    <section className="card card-body lg:col-span-3 space-y-5">
                        <div>
                            <p className="eyebrow">Step 1</p>
                            <h2 className="card-title">Who should get it?</h2>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Audience">
                            {AUDIENCES.map(({ type: t, icon, label, hint }) => {
                                const Icon = icon;
                                return (
                                <button
                                    key={t}
                                    type="button"
                                    role="radio"
                                    aria-checked={type === t}
                                    onClick={() => chooseType(t)}
                                    title={hint}
                                    className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${type === t ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                                >
                                    <Icon size={16} className={`mt-0.5 shrink-0 ${type === t ? 'text-brand' : 'text-gray-400'}`} />
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold text-ink">{label}</span>
                                        <span className="block text-xs text-gray-500 leading-snug">{hint}</span>
                                    </span>
                                </button>
                                );
                            })}
                        </div>

                        {serverOutdated && (
                            <div className="alert border-amber-200 bg-amber-50 text-amber-900">
                                <AlertTriangle size={18} className="shrink-0" />
                                <span>
                                    The server is running an older version of the Notification Hub that doesn&apos;t know <strong>{current?.label}</strong>.
                                    Restart it (<code>npm run server</code>, or <code>npm run start:dev</code>, which restarts it when the code changes).
                                </span>
                            </div>
                        )}
                        {current?.progress && <SeriesBanner series={series} error={seriesError} onRetry={loadSeries} includeToday={type === 'ahead' || (type === 'behind' && group.includeToday)} />}

                        {type === 'tokens' && (
                            <div>
                                <label className="label" htmlFor="tokens">Device tokens</label>
                                <textarea id="tokens" className="input font-mono text-xs" rows={5} value={tokensText} onChange={(e) => setTokensText(e.target.value)}
                                    placeholder="One FCM token per line (commas work too)" />
                                <p className="mt-1 text-xs text-gray-500">{plural(countTokens(tokensText), 'distinct token')}. Copy a user&apos;s token from the User Manager.</p>
                            </div>
                        )}

                        {type === 'users' && <UserPicker chosen={chosen} onChange={setChosen} />}

                        {type === 'behind' && (
                            <div className="space-y-3">
                                <NumberField label="Behind by more than" suffix="percentage points" value={group.minBehindPct} onChange={(v) => setGroupField('minBehindPct', v)}
                                    hint={gapHint(series, group.minBehindPct, group.includeToday ? series?.dueDaysIncludingToday : series?.dueDays, 'behind')} />
                                <Check checked={group.includeToday} onChange={(v) => setGroupField('includeToday', v)}
                                    label="Count today as due" hint="Off: only days before today are expected, so nobody is behind just because they haven't done today's yet." />
                                <Check checked={group.includeNotStarted} onChange={(v) => setGroupField('includeNotStarted', v)}
                                    label="Include users who haven't started the series" />
                            </div>
                        )}
                        {type === 'ahead' && (
                            <NumberField label="Ahead by more than" suffix="percentage points" value={group.minAheadPct} onChange={(v) => setGroupField('minAheadPct', v)}
                                hint={`${gapHint(series, group.minAheadPct, series?.dueDaysIncludingToday, 'ahead') ?? ''} Users who finished the series are in Completed series instead.`} />
                        )}
                        {type === 'recent' && (
                            <NumberField label="Signed up in the last" suffix="days" min={1} max={365} value={group.withinDays} onChange={(v) => setGroupField('withinDays', v)}
                                hint="By when their sign-in account was created." />
                        )}

                        {GROUPS.has(type) && (
                            <div className="space-y-3 border-t border-gray-100 pt-4">
                                <Check checked={group.excludeDisabled} onChange={(v) => setGroupField('excludeDisabled', v)}
                                    label="Skip deactivated users" hint="Also skips profiles whose sign-in account was deleted." />
                                <Check checked={group.skipOptedOut ?? PROGRESS.has(type)} onChange={(v) => setGroupField('skipOptedOut', v)}
                                    label="Skip users who turned off daily engagement reminders" hint="Recommended for reminders about the series." />
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
                            <button type="button" className="btn btn-secondary" disabled={!!problem || !!busy} onClick={runPreview}>
                                {busy === 'preview' ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />} Preview recipients
                            </button>
                            {problem && <span className="text-sm text-gray-500">{problem}</span>}
                            {preview && !audienceCurrent && !problem && <span className="text-sm text-amber-700">The audience changed since this preview.</span>}
                            {audienceCurrent && missingProgress && !problem && <span className="text-sm text-amber-700">Preview again to fill in the progress placeholders.</span>}
                        </div>

                        {preview && <PreviewPanel preview={preview} stale={!previewCurrent} />}
                    </section>

                    {/* Message */}
                    <section className="card card-body lg:col-span-2 space-y-5 self-start lg:sticky lg:top-6">
                        <div>
                            <p className="eyebrow">Step 2</p>
                            <h2 className="card-title">What should it say?</h2>
                        </div>
                        <TemplatesBar
                            templates={templates}
                            error={templatesError}
                            loadedId={loadedTemplate?.id ?? null}
                            dirty={templateDirty}
                            canSave={messageReady}
                            describeAudience={describeGroup}
                            onLoad={(t) => applyMessage(t, { what: `"${t.name}"`, templateId: t.id })}
                            onSaveNew={() => setTemplateDialog('create')}
                            onUpdate={() => setTemplateDialog('update')}
                            onManage={() => setManagingTemplates(true)}
                        />
                        <div>
                            <label className="label" htmlFor="title">Title</label>
                            <input id="title" ref={titleRef} className="input" value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => { lastField.current = 'title'; }}
                                placeholder="e.g. Keep going, {first_name|friend}!" />
                            <Counter value={title} soft={TITLE_SOFT_LIMIT} />
                        </div>
                        <div>
                            <label className="label" htmlFor="body">Message</label>
                            <textarea id="body" ref={bodyRef} className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} onFocus={() => { lastField.current = 'body'; }}
                                placeholder="e.g. You're {percent} through {series_title}. There's still time to catch up!" />
                            <Counter value={body} soft={BODY_SOFT_LIMIT} />
                        </div>
                        {unknown.length > 0 && (
                            <p className="text-sm text-red-600">Unknown placeholder{unknown.length === 1 ? '' : 's'}: {unknown.map((k) => `{${k}}`).join(', ')}. Pick from the list below.</p>
                        )}
                        <PlaceholderPicker onInsert={insertPlaceholder} hasSeries={!!series} />
                        <details className="rounded-lg border border-gray-200 px-3 py-2" open={!!notificationType || dataRows.length > 0}>
                            <summary className="cursor-pointer text-sm font-semibold text-gray-700">Data payload (optional)</summary>
                            <div className="mt-3 space-y-3">
                                <SeriesLink
                                    series={series}
                                    notificationType={notificationType}
                                    dataRows={dataRows}
                                    onApply={() => {
                                        setNotificationType(SERIES_LINK_TYPE);
                                        setDataRows((rows) => (rows.some((r) => r.key.trim() === SERIES_ID_KEY)
                                            ? rows.map((r) => (r.key.trim() === SERIES_ID_KEY ? { key: SERIES_ID_KEY, value: series.id } : r))
                                            : [...rows, { key: SERIES_ID_KEY, value: series.id }]));
                                    }}
                                />
                                <div>
                                    <label className="label" htmlFor="ntype">Notification type</label>
                                    <input id="ntype" className="input font-mono text-xs" value={notificationType} onChange={(e) => setNotificationType(e.target.value)} placeholder="notificationType sent to the app" />
                                </div>
                                {dataRows.map((row, i) => (
                                    <div key={i} className="flex gap-2">
                                        <input className="input font-mono text-xs" value={row.key} placeholder="key" aria-label="Data key"
                                            onChange={(e) => setDataRows((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
                                        <input className="input font-mono text-xs" value={row.value} placeholder="value" aria-label="Data value"
                                            onChange={(e) => setDataRows((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
                                        <button type="button" className="icon-btn" title="Remove" onClick={() => setDataRows((rows) => rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                                    </div>
                                ))}
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDataRows((rows) => [...rows, { key: '', value: '' }])}><Plus size={14} /> Add data</button>
                            </div>
                        </details>

                        <div className="space-y-2">
                            <PhonePreview title={renderTemplate(title, sampleValues)} body={renderTemplate(body, sampleValues)} />
                            <label className="flex items-center gap-2 text-xs text-gray-500">
                                <span className="shrink-0">Preview as</span>
                                <select className="input py-1 text-xs" value={sampleUser ? sampleUid : ''} onChange={(e) => setSampleUid(e.target.value)}>
                                    <option value="">Example values</option>
                                    {(preview?.users ?? []).slice(0, 100).map((u) => <option key={u.uid} value={u.uid}>{u.name || u.email || u.uid}</option>)}
                                </select>
                            </label>
                            {!preview && <p className="text-xs text-gray-400">Preview recipients to see the message as a real recipient would get it.</p>}
                        </div>

                        <div className="space-y-2 border-t border-gray-100 pt-4">
                            <button type="button" className="btn btn-primary w-full py-2.5" disabled={!messageReady || !!problem || !!busy} onClick={startSend}>
                                {busy === 'confirm' || busy === 'send' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Review &amp; send…
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" className="btn btn-secondary btn-sm" disabled={!messageReady || !!busy} onClick={sendTest} title="Send this to the devices of the account you are signed in with">
                                    {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />} Test on my devices
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={!messageReady || !!problem || !!busy} onClick={dryRun} title="FCM checks every message and token without delivering anything">
                                    {busy === 'dry' ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Dry run
                                </button>
                            </div>
                            {!messageReady && !unknown.length && <p className="text-xs text-gray-500">Enter a title and message to send.</p>}
                        </div>

                        {result && <ResultPanel result={result} onDismiss={() => setResult(null)} />}
                    </section>
                </div>

                <HistoryPanel
                    history={history}
                    error={historyError}
                    onRefresh={loadHistory}
                    onReuse={reuse}
                    onDelete={async (item) => {
                        try {
                            await api.deleteHistoryItem(item.id);
                            setHistory((list) => list.filter((h) => h.id !== item.id));
                            toast(`Deleted "${item.title}" from the history.`);
                        } catch (e) {
                            toast(e.message, 'error');
                            if (e.status === 404) setHistory((list) => list.filter((h) => h.id !== item.id));
                        }
                    }}
                />
            </main>

            {confirm && (
                <ConfirmSend
                    preview={confirm}
                    env={env}
                    message={message}
                    busy={busy === 'send'}
                    onCancel={() => setConfirm(null)}
                    onSend={send}
                />
            )}
            {templateDialog && (
                <TemplateDialog
                    mode={templateDialog}
                    initialName={templateDialog === 'update' ? loadedTemplate?.name ?? '' : ''}
                    initialIncludeAudience={templateDialog === 'update' ? !!loadedTemplate?.audience : GROUPS.has(type)}
                    canSaveAudience={GROUPS.has(type)}
                    audienceLabel={describeGroup(audience)}
                    onClose={() => setTemplateDialog(null)}
                    onSave={saveTemplate}
                />
            )}
            {managingTemplates && (
                <ManageTemplatesDialog
                    templates={templates ?? []}
                    describeAudience={describeGroup}
                    onClose={() => setManagingTemplates(false)}
                    onLoad={(t) => {
                        setManagingTemplates(false);
                        applyMessage(t, { what: `"${t.name}"`, templateId: t.id });
                    }}
                    onRename={async (t, name) => {
                        const saved = await api.updateTemplate(t.id, { name });
                        setTemplates((list) => list.map((x) => (x.id === saved.id ? saved : x)).sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })));
                    }}
                    onDelete={async (t) => {
                        await api.deleteTemplate(t.id);
                        setTemplates((list) => list.filter((x) => x.id !== t.id));
                        if (loadedTemplateId === t.id) setLoadedTemplateId(null);
                        toast(`Deleted "${t.name}".`);
                    }}
                />
            )}
            <Toasts toasts={toasts} onDismiss={dismiss} />
        </div>
    );
}

// ---------- Pieces ----------

function Check({ checked, onChange, label, hint }) {
    return (
        <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="checkbox mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span>
                <span className="font-medium text-gray-800">{label}</span>
                {hint && <span className="block text-xs text-gray-500">{hint}</span>}
            </span>
        </label>
    );
}

function NumberField({ label, suffix, value, onChange, hint, min = 0, max = 99 }) {
    return (
        <div>
            <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-800">{label}</span>
                <input type="number" min={min} max={max} step={1} className="input w-20 py-1" value={value}
                    onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value)) || min)))} />
                <span className="text-gray-600">{suffix}</span>
            </label>
            {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
        </div>
    );
}

/**
 * What a percentage-point threshold means in days, e.g. "Users below 40%
 * (2 of 5 days); 0 means any amount; one day is 20 points."
 */
function gapHint(series, points, dueDays, direction) {
    if (!series?.totalDays) return null;
    const expected = Math.round((dueDays / series.totalDays) * 1000) / 10;
    const cutoff = direction === 'behind' ? Math.max(0, expected - points) : Math.min(100, expected + points);
    const perDay = Math.round(1000 / series.totalDays) / 10;
    const who = points > 0
        ? `Users ${direction === 'behind' ? 'below' : 'above'} ${Math.round(cutoff * 10) / 10}%`
        : `Any user ${direction === 'behind' ? 'below' : 'above'} ${expected}%`;
    return `${who} (${dueDays} of ${series.totalDays} days expected${direction === 'ahead' ? ', counting today' : ''}). One day is ${perDay} points.`;
}

/**
 * Fills in the data that makes tapping the notification open the current
 * Bible series in the app, and says where a tap goes. A series ID kept from
 * a template or past send is flagged when it isn't the current series.
 */
function SeriesLink({ series, notificationType, dataRows, onApply }) {
    const isSeriesLink = notificationType.trim() === SERIES_LINK_TYPE;
    const linkedId = dataRows.find((r) => r.key.trim() === SERIES_ID_KEY)?.value.trim() ?? '';
    const current = series?.id ?? null;

    if (isSeriesLink && linkedId && linkedId === current) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <CheckCircle2 size={15} className="shrink-0" />
                <span>Tapping the notification opens <strong>{series.title}</strong> in the app.</span>
            </div>
        );
    }
    if (isSeriesLink) {
        return (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle size={15} className="shrink-0" />
                <span className="min-w-0 flex-1">
                    {!linkedId
                        ? <>Add the <code>{SERIES_ID_KEY}</code> of the series to open.</>
                        : current
                            ? <>This opens a different series (<code className="break-all">{linkedId}</code>), not the current one, {series.title}.</>
                            : <>This opens series <code className="break-all">{linkedId}</code>; no series is active now.</>}
                </span>
                {current && <button type="button" className="btn btn-secondary btn-sm py-1" onClick={onApply}>Use {series.title}</button>}
            </div>
        );
    }
    return (
        <div>
            <button type="button" className="btn btn-secondary btn-sm w-full justify-start" disabled={!current} onClick={onApply}
                title={current ? `Sets notificationType to ${SERIES_LINK_TYPE} and ${SERIES_ID_KEY} to ${current}` : undefined}>
                <BookOpen size={14} className="text-brand" /> Open the current Bible series{series?.title ? `: ${series.title}` : ''}
            </button>
            <p className="mt-1 text-xs text-gray-500">
                {current ? 'Fills in the data so tapping the notification opens the series in the app.' : 'No series is active, so there is nothing to open.'}
            </p>
        </div>
    );
}

function Counter({ value, soft }) {
    const n = value.trim().length;
    return <p className={`mt-1 text-right text-xs ${n > soft ? 'text-amber-700' : 'text-gray-400'}`}>{n}{n > soft ? ` · may be cut off on some phones (over ${soft})` : ''}</p>;
}

function SeriesBanner({ series, error, onRetry, includeToday }) {
    if (series === undefined && !error) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading the current series…</p>;
    if (error) {
        return (
            <div className="alert alert-error">
                <AlertTriangle size={18} className="shrink-0" />
                <span className="flex-1">{error}</span>
                <button className="btn btn-secondary btn-sm" onClick={onRetry}>Retry</button>
            </div>
        );
    }
    if (!series) {
        return (
            <div className="alert border-amber-200 bg-amber-50 text-amber-900">
                <AlertTriangle size={18} className="shrink-0" />
                <span>No series is active, so progress can&apos;t be measured. Make a series active in the Bible Series manager first.</span>
            </div>
        );
    }
    // A server started before progress was measured by day sends other fields.
    if (typeof series.totalDays !== 'number') {
        return (
            <div className="alert border-amber-200 bg-amber-50 text-amber-900">
                <AlertTriangle size={18} className="shrink-0" />
                <span>The server is running an older version of the Notification Hub. Restart it (<code>npm run server</code>) to see series progress.</span>
            </div>
        );
    }
    const due = includeToday ? series.dueDaysIncludingToday : series.dueDays;
    const pct = includeToday ? series.expectedPercentIncludingToday : series.expectedPercent;
    return (
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
                <BookOpen size={16} className="text-brand" />
                <span className="font-semibold text-ink">{series.title}</span>
                <span className="text-gray-500">{series.startDate} → {series.endDate}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-gray-600">
                Expected progress <strong>{pct}%</strong>: {due} of {plural(series.totalDays, 'day')} {includeToday ? 'up to and including today' : 'before today'} ({series.today}).
                A day counts as done when any of its engagements is completed.
            </p>
        </div>
    );
}

const SKIP_LABELS = {
    disabled: 'deactivated',
    noAccount: 'no sign-in account',
    optedOut: 'turned off reminders',
    noDevices: 'no devices with push tokens',
    duplicateTokens: 'duplicate tokens (sent once)',
    unknownDevices: 'chosen devices not found',
    unmatchedTokens: 'tokens not matched to a user (still sent)',
};

function skippedList(skipped) {
    const items = Object.entries(SKIP_LABELS).filter(([k]) => skipped?.[k] > 0).map(([k, label]) => `${skipped[k]} ${label}`);
    if (skipped?.unknownUsers?.length) items.push(`${skipped.unknownUsers.length} unknown user${skipped.unknownUsers.length === 1 ? '' : 's'}`);
    return items;
}

function PreviewPanel({ preview, stale }) {
    const skipped = skippedList(preview.skipped);
    const showProgress = preview.users.some((u) => u.progress);
    const showSignUp = preview.audience?.type === 'recent';
    return (
        <div className={`rounded-lg border border-gray-200 ${stale ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-gray-100 px-4 py-3">
                <span className="text-2xl font-bold text-ink">{preview.userCount.toLocaleString()}</span><span className="text-sm text-gray-500">users</span>
                <span className="text-2xl font-bold text-ink">{preview.deviceCount.toLocaleString()}</span><span className="text-sm text-gray-500">devices</span>
                <span className="w-full text-xs text-gray-500">{preview.label}</span>
                {skipped.length > 0 && <span className="w-full text-xs text-gray-500">Skipped: {skipped.join(' · ')}</span>}
            </div>
            {preview.users.length > 0 && (
                <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                            <tr>
                                <th className="px-4 py-2">User</th>
                                {showSignUp && <th className="px-2 py-2">Signed up</th>}
                                <th className="px-2 py-2 text-right">Devices</th>
                                {showProgress && <th className="px-4 py-2" title="Days with at least one engagement completed, as a percentage of the series' days. The tick is the expected percentage.">Progress</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {preview.users.map((u) => (
                                <tr key={u.uid}>
                                    <td className="px-4 py-1.5">
                                        <div className="font-medium text-ink truncate max-w-[16rem]">{u.name || u.email || u.uid}</div>
                                        {u.name && <div className="text-xs text-gray-500 truncate max-w-[16rem]">{u.email}</div>}
                                    </td>
                                    {showSignUp && (
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                            <div className="text-ink">{formatDate(u.createdAt)}</div>
                                            {u.createdAt && <div className="text-xs text-gray-500"><RelativeTime iso={u.createdAt} /></div>}
                                        </td>
                                    )}
                                    <td className="px-2 py-1.5 text-right tabular-nums">{u.devices}{u.selectedDevices ? <span className="text-xs text-gray-400"> sel.</span> : null}</td>
                                    {showProgress && (
                                        <td className="px-4 py-1.5 text-xs tabular-nums text-gray-600">
                                            {u.progress && <ProgressCell progress={u.progress} />}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {preview.truncated && <p className="px-4 py-2 text-xs text-gray-500">Showing the first {preview.users.length} of {preview.userCount.toLocaleString()} users.</p>}
                </div>
            )}
            {preview.tokens && preview.tokens.length > 0 && preview.users.length === 0 && (
                <p className="px-4 py-2 text-xs text-gray-500">None of these tokens belong to a registered device; they are still sent to.</p>
            )}
        </div>
    );
}

function ProgressCell({ progress: p }) {
    if (typeof p.percent !== 'number') return <span className="text-gray-400">Restart the server to see progress</span>;
    return (
        <div className="min-w-[10rem]">
            <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{p.percent}%</span>
                <span>
                    of {p.expectedPercent}% expected
                    {p.behindPoints > 0 && <span className="text-red-600"> · {p.behindPoints} pts behind</span>}
                    {p.aheadPoints > 0 && <span className="text-green-700"> · {p.aheadPoints} pts ahead</span>}
                </span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-gray-100">
                <div className={`h-1.5 rounded-full ${p.behindPoints > 0 ? 'bg-red-400' : p.aheadPoints > 0 ? 'bg-green-500' : 'bg-brand'}`} style={{ width: `${p.percent}%` }} />
                <div className="absolute -top-0.5 h-2.5 w-0.5 bg-ink" style={{ left: `${p.expectedPercent}%` }} title={`Expected ${p.expectedPercent}%`} />
            </div>
        </div>
    );
}

/** The placeholders, grouped; clicking one inserts it where the cursor was. */
function PlaceholderPicker({ onInsert, hasSeries }) {
    return (
        <details className="rounded-lg border border-gray-200 px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700">Personalize with placeholders</summary>
            <div className="mt-2 space-y-3">
                <p className="text-xs text-gray-500">
                    Click to insert at the cursor. Each person gets their own values. Add a fallback for anyone without one, e.g.{' '}
                    <code className="rounded bg-gray-100 px-1">{'{first_name|friend}'}</code>.
                </p>
                {PLACEHOLDER_GROUPS.map(({ group, label }) => {
                    const needsSeries = group !== 'user';
                    return (
                        <div key={group}>
                            <p className="section-label mb-1.5">
                                {label}
                                {needsSeries && !hasSeries && <span className="ml-2 normal-case tracking-normal font-normal text-amber-700">needs an active series</span>}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {PLACEHOLDERS.filter((p) => p.group === group).map((p) => (
                                    <button key={p.key} type="button" onClick={() => onInsert(p.key)} disabled={needsSeries && !hasSeries}
                                        title={`${p.label}, e.g. "${p.example}"`}
                                        className="rounded-full border border-gray-200 bg-white px-2 py-0.5 font-mono text-[11px] text-gray-700 hover:border-brand hover:text-brand disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-700">
                                        {`{${p.key}}`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
                <p className="text-xs text-gray-500">Progress uses days with at least one engagement completed. People not matched to a user (unknown tokens) get only the fallbacks.</p>
            </div>
        </details>
    );
}

function PhonePreview({ title, body }) {
    return (
        <div className="rounded-2xl bg-gradient-to-b from-ink-700 to-ink-800 p-3">
            <div className="flex items-start gap-3 rounded-xl bg-white/95 px-3 py-2.5 shadow-md">
                <img src={appIcon} alt="WPA" className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 text-sm font-semibold text-ink line-clamp-1">{title || 'Title'}</span>
                        <span className="shrink-0 text-[11px] text-gray-500">now</span>
                    </div>
                    <div className="text-sm text-gray-700 line-clamp-3 whitespace-pre-line">{body || 'Your message appears here.'}</div>
                </div>
            </div>
        </div>
    );
}

function ResultPanel({ result, onDismiss }) {
    const errors = Object.entries(result.errors ?? {});
    const ok = result.failed === 0;
    return (
        <div className={`alert flex-col ${ok ? 'alert-success' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            <div className="flex w-full items-center gap-2 font-semibold">
                {ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span className="flex-1">
                    {result.dryRun ? 'Dry run: ' : ''}{plural(result.sent, 'device')} {result.dryRun ? 'would get it' : 'sent'}{result.failed ? `, ${result.failed} failed` : ''}
                </span>
                <button className="text-xs font-semibold opacity-70 hover:opacity-100" onClick={onDismiss}>Dismiss</button>
            </div>
            <div className="text-xs opacity-80">{result.label} · {plural(result.userCount, 'user')}</div>
            {errors.length > 0 && (
                <ul className="text-xs list-disc pl-5">
                    {errors.map(([code, n]) => <li key={code}><span className="font-mono">{code.replace('messaging/', '')}</span>: {n}</li>)}
                </ul>
            )}
            {result.invalidTokens > 0 && (
                <div className="text-xs">
                    {plural(result.invalidTokens, 'token')} {result.invalidTokens === 1 ? 'is' : 'are'} no longer registered
                    {result.removedDevices > 0 ? `; removed ${plural(result.removedDevices, 'device')}.` : '.'}
                </div>
            )}
            {result.aborted && <div className="text-xs">Stopped early: {result.aborted}</div>}
            {result.historyError && <div className="text-xs">Sent, but not recorded in the history: {result.historyError}</div>}
        </div>
    );
}

function ConfirmSend({ preview, env, message, busy, onCancel, onSend }) {
    const [typed, setTyped] = useState('');
    const [removeInvalidTokens, setRemoveInvalidTokens] = useState(true);
    const needsTyping = preview.deviceCount >= TYPE_TO_CONFIRM_AT;
    const expected = String(preview.deviceCount);
    const ready = !needsTyping || typed.trim() === expected;
    const example = preview.users[0] ?? null;
    const exampleValues = placeholderValues({ user: example, progress: example?.progress, series: preview.series });
    const personalized = renderTemplate(message.title, exampleValues) !== message.title || renderTemplate(message.body, exampleValues) !== message.body;
    return (
        <Dialog
            title={`Send to ${plural(preview.deviceCount, 'device')}?`}
            eyebrow={env ? `${env} environment` : undefined}
            onClose={busy ? () => {} : onCancel}
            width="max-w-lg"
            footer={(
                <>
                    <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
                    <button className={`btn ${env === 'prod' ? 'btn-danger' : 'btn-primary'}`} disabled={!ready || busy} onClick={() => onSend({ removeInvalidTokens })}>
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} Send now
                    </button>
                </>
            )}
        >
            <div className="space-y-4 text-sm">
                <p className="text-gray-700">
                    <strong>{preview.label}</strong>: {plural(preview.userCount, 'user')} on {plural(preview.deviceCount, 'device')}
                    {env === 'prod' ? ' in production' : env ? ` in ${env}` : ''}. This can&apos;t be undone.
                </p>
                <PhonePreview title={renderTemplate(message.title, exampleValues)} body={renderTemplate(message.body, exampleValues)} />
                {example && personalized && <p className="-mt-2 text-xs text-gray-500">As {example.name || example.email || 'the first recipient'} will see it; each person gets their own values.</p>}
                {Object.keys(message.data).length > 0 && (
                    <p className="text-xs text-gray-500 font-mono break-all">data: {JSON.stringify(message.data)}</p>
                )}
                <Check checked={removeInvalidTokens} onChange={setRemoveInvalidTokens}
                    label="Remove devices whose token is no longer registered"
                    hint="FCM reports these when an app was uninstalled or the token expired; they can never receive notifications again." />
                {needsTyping && (
                    <div>
                        <label className="label" htmlFor="confirm-count">Type <span className="font-mono">{expected}</span> (the number of devices) to confirm</label>
                        <input id="confirm-count" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus inputMode="numeric" />
                    </div>
                )}
            </div>
        </Dialog>
    );
}

function HistoryPanel({ history, error, onRefresh, onReuse, onDelete }) {
    const [confirmId, setConfirmId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const remove = async (item) => {
        setDeletingId(item.id);
        try {
            await onDelete(item);
            setConfirmId(null);
        } finally {
            setDeletingId(null);
        }
    };
    return (
        <section className="card overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
                <div className="flex items-center gap-2">
                    <History size={18} className="text-brand" />
                    <h2 className="card-title">Recent sends</h2>
                    {history?.length > 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{history.length}</span>}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
            </div>
            {error && <p className="px-6 py-4 text-sm text-red-600">{error}</p>}
            {!error && !history && <p className="flex items-center gap-2 px-6 py-4 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
            {history && history.length === 0 && <p className="px-6 py-4 text-sm text-gray-500">Nothing has been sent from the hub in this environment yet.</p>}
            {history && history.length > 0 && (
                // Scrolls within a fixed height rather than growing the page.
                <ul className="max-h-[26rem] divide-y divide-gray-100 overflow-y-auto overscroll-contain">
                    {history.map((h) => (
                        <li key={h.id} className="flex flex-wrap items-start gap-x-6 gap-y-1 px-6 py-3">
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-ink truncate">{h.title}</div>
                                <div className="text-sm text-gray-600 line-clamp-2">{h.body}</div>
                                <div className="mt-1 text-xs text-gray-500">{h.audienceLabel}</div>
                            </div>
                            <div className="text-right text-xs text-gray-500 space-y-0.5">
                                <div className="flex items-center justify-end gap-1"><Clock size={12} /> <RelativeTime iso={h.createdAt} empty="—" /></div>
                                <div>{h.sentBy ?? 'unknown'}</div>
                                <div>
                                    <span className="text-green-700 font-semibold">{h.sent} sent</span>
                                    {h.failed > 0 && <span className="text-red-600 font-semibold"> · {h.failed} failed</span>}
                                    {' '}· {plural(h.userCount, 'user')}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 self-center">
                                {confirmId === h.id ? (
                                    <>
                                        <span className="text-xs text-gray-600">Delete from history?</span>
                                        <button className="btn btn-danger btn-sm" disabled={deletingId === h.id} onClick={() => remove(h)}>
                                            {deletingId === h.id ? <Loader2 size={14} className="animate-spin" /> : 'Delete'}
                                        </button>
                                        <button className="btn btn-ghost btn-sm" disabled={deletingId === h.id} onClick={() => setConfirmId(null)}>Keep</button>
                                    </>
                                ) : (
                                    <>
                                        <button className="btn btn-secondary btn-sm" onClick={() => onReuse(h)} title="Copy this message (and group audience) into the form">Reuse</button>
                                        <button className="icon-btn" onClick={() => setConfirmId(h.id)} title="Delete from history" aria-label={`Delete "${h.title}" from history`}><Trash2 size={15} /></button>
                                    </>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
