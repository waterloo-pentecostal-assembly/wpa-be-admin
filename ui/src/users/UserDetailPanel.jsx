// Side panel with everything about one user and the actions on them.
import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle, Ban, Bell, Check, CircleCheck, Clock, Copy, KeyRound, Link2, Loader2, LogOut, MailCheck, MailX, Pencil,
    ShieldCheck, ShieldOff, Smartphone, Trash2, UserCheck, UserPlus, UserX, X, Flag,
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import * as api from '../api/usersApi';
import { formatDate } from './format';
import { Avatar, CopyButton, RelativeTime, StatusBadges } from './shared';
import { CreateProfileDialog, DeleteUserDialog, EditProfileDialog, LinkDialog } from './dialogs';

const ACTIVITY_LABELS = { completions: 'Completions', prayer_requests: 'Prayer requests', testimonies: 'Testimonies' };
const PROVIDER_LABELS = { password: 'Email & password', 'google.com': 'Google', 'apple.com': 'Apple', 'facebook.com': 'Facebook', phone: 'Phone' };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// Firestore document IDs and uids (or document paths, which is how
// references arrive) mean nothing to a reader.
const OPAQUE_ID = /^[A-Za-z0-9_-]{15,}$|^[\w-]+\/[\w/-]+$/;
const isIdList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && OPAQUE_ID.test(item));

/**
 * A profile/device value for display: Firestore timestamps as dates, lists of
 * IDs (e.g. followed threads) as a count, other objects as JSON.
 */
const displayValue = (value) => {
    if (typeof value === 'string' && ISO_DATE.test(value)) return formatDate(value, 'PPp');
    if (isIdList(value)) return value.length.toLocaleString();
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
};
// Fields not worth showing anywhere in the panel (profile, notification
// settings, devices), matched ignoring case and separators: followed threads
// (threads_followed, threadsFollowed, followed_threads, ...).
const HIDDEN_FIELDS = [/threads?followed|followedthreads?/];
const isHiddenField = (key) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return HIDDEN_FIELDS.some((pattern) => pattern.test(normalized));
};
const humanize = (key) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function Section({ title, icon: Icon, children, action }) {
    return (
        <section className="border-t border-gray-200 px-6 py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="section-label flex items-center gap-1.5">{Icon && <Icon size={14} />} {title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

function Field({ label, children }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
            <dt className="text-gray-500 shrink-0">{label}</dt>
            <dd className="text-right text-gray-900 min-w-0 break-words">{children}</dd>
        </div>
    );
}

const YesNo = ({ value, yes = 'Yes', no = 'No' }) => (
    <span className={value ? 'text-green-700 font-semibold' : 'text-gray-500'}>{value ? yes : no}</span>
);

function ActionButton({ icon, label, onClick, busy, disabled, tone = 'btn-secondary', title }) {
    const Icon = icon;
    return (
        <button className={`btn ${tone} btn-sm justify-start`} onClick={onClick} disabled={disabled || !!busy} title={title}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />} {label}
        </button>
    );
}

/**
 * An action with a secondary icon button joined on (e.g. send an email, or
 * copy the link instead). Each half has its own disabled state and title.
 */
function SplitAction({ main, secondary }) {
    const Icon = main.icon;
    const SecondaryIcon = secondary.icon;
    return (
        <div className="flex">
            <button className="btn btn-secondary btn-sm flex-1 justify-start rounded-r-none" onClick={main.onClick} disabled={main.disabled || !!main.busy} title={main.title}>
                {main.busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />} {main.label}
            </button>
            <button
                className="btn btn-secondary btn-sm -ml-px rounded-l-none px-2.5"
                onClick={secondary.onClick}
                disabled={secondary.disabled || !!secondary.busy}
                title={secondary.title}
                aria-label={secondary.title}
            >
                {secondary.busy ? <Loader2 size={14} className="animate-spin" /> : <SecondaryIcon size={14} />}
            </button>
        </div>
    );
}

/**
 * Copies a device's full push token, fetched when clicked (the panel only has
 * it masked). The clipboard write starts during the click with the text to
 * follow, which Safari requires; writeText is the fallback.
 */
function CopyDeviceToken({ uid, deviceId, toast }) {
    const [state, setState] = useState('idle'); // idle | busy | copied
    const copy = async () => {
        setState('busy');
        const token = api.getDeviceToken(uid, deviceId).then((r) => {
            if (!r?.token) throw new Error('The server returned no token; restart it if it was just updated');
            return r.token;
        });
        try {
            if (window.ClipboardItem && navigator.clipboard.write) {
                await navigator.clipboard.write([new ClipboardItem({ 'text/plain': token.then((t) => new Blob([t], { type: 'text/plain' })) })]);
            } else {
                await navigator.clipboard.writeText(await token);
            }
            setState('copied');
            setTimeout(() => setState('idle'), 1500);
        } catch (err) {
            setState('idle');
            // A failed fetch is the useful error; otherwise it was the clipboard.
            const fetchError = await token.then(() => null, (e) => e);
            toast(fetchError?.message ?? `Couldn't copy the token: ${err.message}`, 'error');
        }
    };
    return (
        <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={copy} disabled={state === 'busy'} title="Copy the full push notification token">
            {state === 'busy' ? <Loader2 size={12} className="animate-spin" /> : state === 'copied' ? <Check size={12} /> : <Copy size={12} />}
            {state === 'copied' ? 'Copied' : 'Copy token'}
        </button>
    );
}

/** One step of getting into the app, done or still waiting. */
function VerificationStep({ done, icon, title, doneText, pendingText, unavailable }) {
    const Icon = icon;
    const tone = unavailable ? 'border-gray-200 bg-gray-50 text-gray-500'
        : done ? 'border-green-200 bg-green-50/60 text-green-800'
            : 'border-amber-200 bg-amber-50/60 text-amber-900';
    return (
        <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${tone}`}>
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                    {title}
                    {!unavailable && (done ? <CircleCheck size={14} className="text-green-600" /> : <Clock size={14} className="text-amber-600" />)}
                </div>
                <p className="text-xs opacity-80">{unavailable ?? (done ? doneText : pendingText)}</p>
            </div>
        </div>
    );
}

/** Describes the admin-topic (un)subscription that came with an admin or status change. */
function topicNote(topics) {
    if (!topics || !topics.tokens) return '';
    const verb = topics.subscribed ? 'subscribed to' : 'unsubscribed from';
    const failed = topics.failures || topics.errors?.length ? ' (some failed; see server log)' : '';
    return ` ${topics.tokens} device${topics.tokens === 1 ? '' : 's'} ${verb} admin notifications${failed}.`;
}

/**
 * @param {{ uid: string, env: string, onClose: () => void, onChanged: (user: object) => void,
 *   onDeleted: (uid: string) => void, toast: (message: string, tone?: string) => void }} props
 */
export default function UserDetailPanel({ uid, env, onClose, onChanged, onDeleted, toast }) {
    const [user, setUser] = useState(null);
    const [emailSending, setEmailSending] = useState({ available: false });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null); // name of the running action
    const [dialog, setDialog] = useState(null); // { type, ...props }

    // The panel is remounted for each user (keyed by uid), so it starts empty.
    useEffect(() => {
        let ignore = false;
        api.getUser(uid)
            .then(({ user: loaded, emailSending: sending }) => {
                if (ignore) return;
                setUser(loaded);
                if (sending) setEmailSending(sending);
            })
            .catch((err) => { if (!ignore) setError(err.message); });
        return () => { ignore = true; };
    }, [uid]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !dialog) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dialog, onClose]);

    /**
     * Runs an action that returns the updated user ({ user } or the user
     * itself) and closes any open dialog when it succeeds. Errors are toasted
     * unless a dialog shows them (`inDialog`), and rethrown either way.
     */
    const run = useCallback(async (name, action, success, { inDialog = false } = {}) => {
        setBusy(name);
        try {
            const result = await action();
            const updated = result?.user ?? result;
            setUser(updated);
            onChanged(updated);
            setDialog(null);
            if (success) toast(typeof success === 'function' ? success(result) : success);
            return result;
        } catch (err) {
            if (!inDialog) toast(err.message, 'error');
            throw err;
        } finally {
            setBusy(null);
        }
    }, [onChanged, toast]);

    const generateLink = async (kind) => {
        setBusy(kind);
        try {
            const result = kind === 'reset' ? await api.generatePasswordResetLink(uid) : await api.generateVerificationLink(uid);
            setDialog({ type: 'link', kind, ...result });
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            setBusy(null);
        }
    };

    /** Has Firebase send its own email (reset or verification). */
    const sendEmail = async (kind) => {
        setBusy(`send-${kind}`);
        try {
            const { email } = kind === 'reset' ? await api.sendPasswordResetEmail(uid) : await api.sendVerificationEmail(uid);
            toast(`${kind === 'reset' ? 'Password reset' : 'Verification'} email sent to ${email}.`);
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            setBusy(null);
        }
    };

    const confirm = (props) => setDialog({
        type: 'confirm',
        ...props,
        onConfirm: () => {
            setDialog(null);
            props.onConfirm();
        },
    });
    const ignoreError = () => {}; // already shown as a toast

    const toggleDisabled = () => {
        const disable = !user.disabled;
        const go = () => run('disabled', () => api.setDisabled(uid, disable),
            (r) => (disable ? 'User deactivated and signed out.' : 'User reactivated.') + topicNote(r.topics)).catch(ignoreError);
        if (!disable) return go();
        confirm({
            title: `Deactivate ${user.name || user.email}?`,
            message: `They are signed out of every device in ${env} and can't sign in again until reactivated. Their data is kept.${user.isAdmin ? ' Their devices stop getting admin notifications.' : ''}`,
            confirmText: 'Deactivate',
            isDangerous: true,
            onConfirm: go,
        });
    };

    const toggleAdmin = () => {
        const grant = !user.isAdmin;
        confirm({
            title: grant ? `Make ${user.name || user.email} an admin?` : `Remove admin access from ${user.name || user.email}?`,
            message: grant
                ? `They can sign in to this admin console and the app's admin features in ${env}, and their devices get admin notifications (sign-ups, delete requests, testimonies and prayer requests awaiting approval).`
                : `They lose admin console and app admin access in ${env}, and their devices stop getting admin notifications.`,
            confirmText: grant ? 'Make admin' : 'Remove admin',
            isDangerous: !grant,
            onConfirm: () => run('admin', () => api.setAdmin(uid, grant),
                (r) => (grant ? 'Admin access granted.' : 'Admin access removed.') + topicNote(r.topics)).catch(ignoreError),
        });
    };

    const revoke = () => confirm({
        title: 'Sign out everywhere?',
        message: 'Their sessions on every device end within the hour and they have to sign in again. Use this after a password change or a lost phone.',
        confirmText: 'Sign out everywhere',
        onConfirm: () => run('revoke', () => api.revokeSessions(uid), 'Sessions revoked.').catch(ignoreError),
    });

    const toggleApproved = () => {
        const approve = !user.isVerified;
        const go = () => run('approved', () => api.setApproved(uid, approve), approve ? 'User approved.' : 'Approval revoked.').catch(ignoreError);
        if (approve) return go();
        confirm({
            title: `Revoke approval for ${user.name || user.email}?`,
            message: `Their profile goes back to awaiting approval (is_verified off) in ${env}, as if an admin had never accepted them.`,
            confirmText: 'Revoke approval',
            isDangerous: true,
            onConfirm: go,
        });
    };

    const toggleEmailVerified = () => {
        const verified = !user.emailVerified;
        run('email-verified', () => api.setEmailVerified(uid, verified),
            verified ? 'Email marked as verified.' : 'Email marked as not verified.').catch(ignoreError);
    };

    if (error || !user) {
        return (
            <Shell onClose={onClose}>
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
                    {error ? <p className="alert alert-error w-full"><AlertTriangle size={16} className="shrink-0" /> {error}</p>
                        : <><Loader2 size={18} className="mr-2 animate-spin text-brand" /> Loading user…</>}
                </div>
            </Shell>
        );
    }

    const noEmailAccount = !user.hasAccount || !user.email;
    // Why an email can't be sent, if it can't (shown on hover).
    const cannotSend = noEmailAccount ? 'This user has no sign-in account with an email'
        : user.disabled ? 'Reactivate the user before sending emails'
            : !emailSending.available ? emailSending.reason
                : null;
    const profileExtras = user.profile
        ? Object.entries(user.profile).filter(([key]) => !isHiddenField(key)
            && !['email', 'first_name', 'last_name', 'is_admin', 'is_verified', 'reports', ...user.photoFields].includes(key))
        : [];

    return (
        <Shell onClose={onClose}>
            {/* Identity */}
            <div className="px-6 pt-6 pb-5">
                <div className="flex items-start gap-4">
                    {user.photoFullUrl ? (
                        <a href={user.photoFullUrl} target="_blank" rel="noreferrer" title="Open full-size photo" className="shrink-0 rounded-full transition-opacity hover:opacity-80">
                            <Avatar user={user} size="h-16 w-16 text-lg" />
                        </a>
                    ) : <Avatar user={user} size="h-16 w-16 text-lg" />}
                    <div className="min-w-0 flex-1">
                        <h2 className="text-lg font-bold text-ink truncate">{user.name || <span className="text-gray-400">No name</span>}</h2>
                        <p className="text-sm text-gray-600 truncate">{user.email ?? 'No email'}</p>
                        <div className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                            <span className="font-mono truncate">{user.uid}</span>
                            <CopyButton text={user.uid} label="" className="icon-btn p-1" />
                        </div>
                    </div>
                </div>
                <div className="mt-3"><StatusBadges user={user} /></div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <VerificationStep
                        done={user.isVerified}
                        icon={UserCheck}
                        title="Admin approval"
                        doneText="An admin accepted this user"
                        pendingText="Waiting for an admin to approve"
                        unavailable={user.hasProfile ? undefined : 'No profile to approve'}
                    />
                    <VerificationStep
                        done={user.emailVerified}
                        icon={MailCheck}
                        title="Email verified"
                        doneText="The user clicked the verification link"
                        pendingText="The user hasn't clicked the verification link"
                        unavailable={user.hasAccount ? undefined : 'No sign-in account'}
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-5 grid grid-cols-2 gap-2">
                <SplitAction
                    main={{
                        icon: KeyRound,
                        label: 'Send reset email',
                        busy: busy === 'send-reset',
                        disabled: !!cannotSend,
                        title: cannotSend ?? `Firebase emails ${user.email} a link to choose a new password`,
                        onClick: () => sendEmail('reset'),
                    }}
                    secondary={{
                        icon: Link2,
                        busy: busy === 'reset',
                        disabled: noEmailAccount,
                        title: 'Copy a password reset link instead',
                        onClick: () => generateLink('reset'),
                    }}
                />
                <SplitAction
                    main={{
                        icon: MailCheck,
                        label: 'Send verification email',
                        busy: busy === 'send-verify',
                        disabled: user.emailVerified || !!cannotSend,
                        title: user.emailVerified ? 'Email is already verified' : cannotSend ?? `Firebase emails ${user.email} a link to verify their address`,
                        onClick: () => sendEmail('verify'),
                    }}
                    secondary={{
                        icon: Link2,
                        busy: busy === 'verify',
                        disabled: noEmailAccount || user.emailVerified,
                        title: user.emailVerified ? 'Email is already verified' : 'Copy a verification link instead',
                        onClick: () => generateLink('verify'),
                    }}
                />
                <ActionButton
                    icon={user.isVerified ? UserX : UserCheck}
                    label={user.isVerified ? 'Revoke approval' : 'Approve user'}
                    tone={user.isVerified || !user.hasProfile ? 'btn-secondary' : 'btn-primary'}
                    busy={busy === 'approved'}
                    disabled={!user.hasProfile}
                    title={user.hasProfile ? 'Admin approval (profile is_verified)' : 'Create a profile first'}
                    onClick={toggleApproved}
                />
                <ActionButton
                    icon={user.emailVerified ? MailX : MailCheck}
                    label={user.emailVerified ? 'Mark email unverified' : 'Mark email verified'}
                    busy={busy === 'email-verified'}
                    disabled={!user.hasAccount}
                    title={user.hasAccount ? 'Sets Auth emailVerified, as if the user had (or hadn\'t) clicked the link' : 'This user has no sign-in account'}
                    onClick={toggleEmailVerified}
                />
                <ActionButton icon={LogOut} label="Sign out everywhere" busy={busy === 'revoke'} disabled={!user.hasAccount || user.disabled} onClick={revoke} />
                <ActionButton icon={Pencil} label="Edit profile" disabled={!!busy} onClick={() => setDialog({ type: 'edit' })} />
                <ActionButton
                    icon={user.isAdmin ? ShieldOff : ShieldCheck}
                    label={user.isAdmin ? 'Remove admin' : 'Make admin'}
                    busy={busy === 'admin'}
                    disabled={!user.hasProfile}
                    title={user.hasProfile ? undefined : 'Create a profile first'}
                    onClick={toggleAdmin}
                />
                <ActionButton
                    icon={user.disabled ? CircleCheck : Ban}
                    label={user.disabled ? 'Reactivate' : 'Deactivate'}
                    tone={user.disabled ? 'btn-primary' : 'btn-secondary text-red-700'}
                    busy={busy === 'disabled'}
                    disabled={!user.hasAccount}
                    onClick={toggleDisabled}
                />
            </div>

            <Section title="Sign-in account" icon={KeyRound}>
                {user.account ? (
                    <dl className="divide-y divide-gray-100">
                        <Field label="Status"><YesNo value={!user.disabled} yes="Active" no="Deactivated" /></Field>
                        <Field label="Email verified (link clicked)"><YesNo value={user.emailVerified} /></Field>
                        <Field label="Signs in with">{user.account.providers.map((p) => PROVIDER_LABELS[p.providerId] ?? p.providerId).join(', ') || '—'}</Field>
                        <Field label="Created">{formatDate(user.createdAt, 'PPp')}</Field>
                        <Field label="Last sign-in"><RelativeTime iso={user.lastSignInAt} /></Field>
                        <Field label="Last active"><RelativeTime iso={user.lastActiveAt} /></Field>
                        <Field label="Sessions valid since"><RelativeTime iso={user.account.tokensValidAfter} empty="—" /></Field>
                        {user.account.displayName && <Field label="Display name">{user.account.displayName}</Field>}
                        {user.phoneNumber && <Field label="Phone">{user.phoneNumber}</Field>}
                        {user.account.multiFactor > 0 && <Field label="Second factors">{user.account.multiFactor}</Field>}
                        {user.account.customClaims && <Field label="Custom claims"><code className="text-xs">{JSON.stringify(user.account.customClaims)}</code></Field>}
                    </dl>
                ) : (
                    <p className="alert alert-error"><AlertTriangle size={16} className="shrink-0" /> No Firebase Authentication account. This profile is left over from a deleted account and nobody can sign in to it.</p>
                )}
            </Section>

            <Section
                title="App profile"
                icon={UserPlus}
                action={user.hasProfile && user.reports > 0 && (
                    <button className="btn btn-ghost-brand btn-sm" disabled={!!busy} onClick={() => run('reports', () => api.clearReports(uid), 'Reports cleared.').catch(ignoreError)}>
                        <Flag size={14} /> Clear reports
                    </button>
                )}
            >
                {user.profile ? (
                    <dl className="divide-y divide-gray-100">
                        <Field label="First name">{user.firstName || '—'}</Field>
                        <Field label="Last name">{user.lastName || '—'}</Field>
                        <Field label="Email">
                            {user.profile.email ?? '—'}
                            {user.emailMismatch && <span className="block text-xs text-amber-700">Differs from the sign-in email; edit the profile to fix</span>}
                        </Field>
                        <Field label="Admin"><YesNo value={user.isAdmin} /></Field>
                        <Field label="Approved"><YesNo value={user.isVerified} /></Field>
                        <Field label="Reports">{user.reports}</Field>
                        {profileExtras.map(([key, value]) => (
                            <Field key={key} label={humanize(key)}>
                                {typeof value === 'object' && value !== null && !isIdList(value) ? <code className="text-xs">{displayValue(value)}</code> : displayValue(value)}
                            </Field>
                        ))}
                    </dl>
                ) : (
                    <div className="space-y-3">
                        <p className="text-sm text-gray-600">This account has no <code>users/{user.uid}</code> profile, so the app may not work properly for them.</p>
                        <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ type: 'createProfile' })}><UserPlus size={14} /> Create profile</button>
                    </div>
                )}
            </Section>

            <Section title="Activity">
                <div className="grid grid-cols-3 gap-3">
                    {Object.entries(ACTIVITY_LABELS).map(([key, label]) => (
                        <div key={key} className="rounded-lg bg-canvas px-3 py-2.5">
                            <div className="text-xl font-bold text-ink">{user.activity[key] ?? '—'}</div>
                            <div className="text-xs text-gray-500">{label}</div>
                        </div>
                    ))}
                </div>
            </Section>

            {user.hasProfile && (
                <Section title={`Devices (${user.devices.length})`} icon={Smartphone}>
                    {user.devices.length ? (
                        <ul className="space-y-2">
                            {user.devices.map(({ id, token, hasToken, ...rest }) => (
                                <li key={id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-gray-700 truncate">{token ?? id}</span>
                                        {hasToken ? <CopyDeviceToken uid={uid} deviceId={id} toast={toast} /> : <span className="text-amber-700">No push token</span>}
                                    </div>
                                    {Object.keys(rest).length > 0 && (
                                        <div className="mt-1 text-gray-500">{Object.entries(rest).filter(([k]) => !isHiddenField(k)).map(([k, v]) => `${humanize(k)}: ${displayValue(v)}`).join(' · ')}</div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-sm text-gray-500">No registered devices; this user doesn't get push notifications.</p>}
                </Section>
            )}

            {user.hasProfile && (
                <Section title="Notification settings" icon={Bell}>
                    {user.notificationSettings ? (
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                            {Object.entries(user.notificationSettings).filter(([k]) => k !== 'id' && !isHiddenField(k)).map(([key, value]) => (
                                <Field key={key} label={humanize(key)}>{typeof value === 'boolean' ? <YesNo value={value} yes="On" no="Off" /> : String(value)}</Field>
                            ))}
                        </dl>
                    ) : <p className="text-sm text-gray-500">No notification settings saved.</p>}
                </Section>
            )}

            <Section title="Danger zone">
                <div className="flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50/50 px-4 py-3">
                    <p className="text-sm text-gray-700">Permanently delete this user's account and profile.</p>
                    <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => setDialog({ type: 'delete' })}><Trash2 size={14} /> Delete</button>
                </div>
            </Section>

            {dialog?.type === 'confirm' && (
                <ConfirmModal {...dialog} onCancel={() => setDialog(null)} />
            )}
            {dialog?.type === 'link' && (
                <LinkDialog kind={dialog.kind} link={dialog.link} email={dialog.email} hasPassword={dialog.hasPassword} onClose={() => setDialog(null)} />
            )}
            {dialog?.type === 'edit' && (
                <EditProfileDialog user={user} onClose={() => setDialog(null)} onSave={(fields) => run('edit', () => api.updateProfile(uid, fields), 'Profile saved.', { inDialog: true })} />
            )}
            {dialog?.type === 'createProfile' && (
                <CreateProfileDialog user={user} onClose={() => setDialog(null)} onCreate={(fields) => run('profile', () => api.createProfile(uid, fields), 'Profile created.', { inDialog: true })} />
            )}
            {dialog?.type === 'delete' && (
                <DeleteUserDialog
                    user={user}
                    env={env}
                    onClose={() => setDialog(null)}
                    onDelete={async (typed, options) => {
                        const { deletedData } = await api.deleteUser(uid, typed, options);
                        const removed = deletedData && Object.values(deletedData).reduce((sum, n) => sum + n, 0);
                        toast(`Deleted ${user.email ?? uid}${deletedData ? ` and ${removed} item${removed === 1 ? '' : 's'} of their data` : ''}.`);
                        onDeleted(uid);
                    }}
                />
            )}
        </Shell>
    );
}

function Shell({ onClose, children }) {
    return (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl animate-slide-in" role="dialog" aria-modal="true" aria-label="User details">
                <button onClick={onClose} className="icon-btn absolute right-3 top-3" title="Close (Esc)"><X size={18} /></button>
                {children}
            </aside>
        </div>
    );
}
