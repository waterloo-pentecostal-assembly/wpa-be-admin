// Dialogs for the User Manager.
import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Dialog } from '../seriesBuilder/ui';
import { CopyButton } from './shared';

const LINK_KINDS = {
    reset: {
        title: 'Password reset link',
        subject: 'Reset your WPA Bible Engagement App password',
        body: (link) => `Hi,\n\nUse this link to choose a new password for the WPA Bible Engagement App:\n\n${link}\n\nThe link expires in one hour.\n`,
    },
    verify: {
        title: 'Email verification link',
        subject: 'Verify your email for the WPA Bible Engagement App',
        body: (link) => `Hi,\n\nUse this link to verify your email address for the WPA Bible Engagement App:\n\n${link}\n`,
    },
};

/**
 * Shows a generated action link. Firebase doesn't email it; the admin copies
 * it or opens a prefilled email to the user.
 * @param {{ kind: 'reset'|'verify', link: string, email: string, hasPassword?: boolean, onClose: () => void }} props
 */
export function LinkDialog({ kind, link, email, hasPassword = true, onClose }) {
    const meta = LINK_KINDS[kind];
    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(meta.subject)}&body=${encodeURIComponent(meta.body(link))}`;
    return (
        <Dialog
            title={meta.title}
            eyebrow={email}
            onClose={onClose}
            width="max-w-lg"
            footer={(
                <>
                    <a className="btn btn-secondary" href={mailto}><ExternalLink size={16} /> Open email draft</a>
                    <CopyButton text={link} label="Copy link" className="btn btn-primary" />
                </>
            )}
        >
            <textarea readOnly value={link} rows={4} className="input font-mono text-xs break-all" onFocus={(e) => e.target.select()} />
            <ul className="mt-4 space-y-1.5 text-sm text-gray-600 list-disc pl-5">
                <li>Firebase doesn't send this link — share it with the user yourself.</li>
                {kind === 'reset' && <li>Anyone with the link can set this account's password, so only send it to <strong>{email}</strong>. It expires in one hour.</li>}
                {kind === 'reset' && !hasPassword && <li className="text-amber-700">This account doesn't sign in with a password yet. The link adds one.</li>}
            </ul>
        </Dialog>
    );
}

function useSubmit(onSubmit) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const submit = async (e) => {
        e?.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await onSubmit();
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };
    return { busy, error, submit };
}

function NameFields({ firstName, lastName, setFirstName, setLastName }) {
    return (
        <div className="grid grid-cols-2 gap-3">
            <div>
                <label className="label" htmlFor="um-first">First name</label>
                <input id="um-first" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
                <label className="label" htmlFor="um-last">Last name</label>
                <input id="um-last" className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
        </div>
    );
}

export function CreateUserDialog({ env, onCreate, onClose }) {
    const [email, setEmail] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [password, setPassword] = useState('');
    const { busy, error, submit } = useSubmit(() => onCreate({ email, firstName, lastName, password: password || undefined }));
    return (
        <Dialog
            title="New user"
            eyebrow={`Creates a verified account in ${env}`}
            onClose={onClose}
            width="max-w-lg"
            footer={(
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" form="um-create" type="submit" disabled={busy || !email.trim()}>
                        {busy && <Loader2 size={16} className="animate-spin" />} Create user
                    </button>
                </>
            )}
        >
            <form id="um-create" onSubmit={submit} className="space-y-4">
                {error && <p className="alert alert-error">{error}</p>}
                <div>
                    <label className="label" htmlFor="um-email">Email</label>
                    <input id="um-email" type="email" required autoFocus className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <NameFields {...{ firstName, lastName, setFirstName, setLastName }} />
                <div>
                    <label className="label" htmlFor="um-password">Password <span className="font-normal text-gray-400">(optional)</span></label>
                    <input id="um-password" type="text" autoComplete="off" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to send a reset link instead" />
                    <p className="mt-1.5 text-xs text-gray-500">Without a password you'll get a link for the user to choose their own.</p>
                </div>
            </form>
        </Dialog>
    );
}

export function EditProfileDialog({ user, onSave, onClose }) {
    const [firstName, setFirstName] = useState(user.firstName);
    const [lastName, setLastName] = useState(user.lastName);
    const [email, setEmail] = useState(user.email ?? '');
    const emailChanged = email.trim().toLowerCase() !== (user.email ?? '').toLowerCase();
    const { busy, error, submit } = useSubmit(() => {
        const fields = { firstName, lastName };
        if (emailChanged) fields.email = email;
        return onSave(fields);
    });
    return (
        <Dialog
            title="Edit profile"
            eyebrow={user.email}
            onClose={onClose}
            width="max-w-lg"
            footer={(
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" form="um-edit" type="submit" disabled={busy}>
                        {busy && <Loader2 size={16} className="animate-spin" />} Save
                    </button>
                </>
            )}
        >
            <form id="um-edit" onSubmit={submit} className="space-y-4">
                {error && <p className="alert alert-error">{error}</p>}
                {user.hasProfile && <NameFields {...{ firstName, lastName, setFirstName, setLastName }} />}
                <div>
                    <label className="label" htmlFor="um-edit-email">Email</label>
                    <input id="um-edit-email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                    {emailChanged && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                            <AlertTriangle size={14} className="shrink-0 mt-px" />
                            The user signs in with the new address from now on. Both the sign-in account and the profile are updated, and the email is marked unverified.
                        </p>
                    )}
                </div>
            </form>
        </Dialog>
    );
}

export function CreateProfileDialog({ user, onCreate, onClose }) {
    const [firstName, setFirstName] = useState(user.account?.displayName?.split(' ')[0] ?? '');
    const [lastName, setLastName] = useState(user.account?.displayName?.split(' ').slice(1).join(' ') ?? '');
    const { busy, error, submit } = useSubmit(() => onCreate({ firstName, lastName }));
    return (
        <Dialog
            title="Create app profile"
            eyebrow={user.email}
            onClose={onClose}
            width="max-w-lg"
            footer={(
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" form="um-profile" type="submit" disabled={busy}>
                        {busy && <Loader2 size={16} className="animate-spin" />} Create profile
                    </button>
                </>
            )}
        >
            <form id="um-profile" onSubmit={submit} className="space-y-4">
                {error && <p className="alert alert-error">{error}</p>}
                <p className="text-sm text-gray-600">Adds the <code>users/{user.uid}</code> document the app expects, as a non-admin with no reports.</p>
                <NameFields {...{ firstName, lastName, setFirstName, setLastName }} />
            </form>
        </Dialog>
    );
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Deletion needs the user's email (or uid) typed in; their content can optionally go too. */
export function DeleteUserDialog({ user, env, onDelete, onClose }) {
    const expected = user.email ?? user.uid;
    const [typed, setTyped] = useState('');
    const [deleteData, setDeleteData] = useState(false);
    const { busy, error, submit } = useSubmit(() => onDelete(typed, { deleteData }));
    const { activity = {} } = user;
    const content = (activity.prayer_requests ?? 0) + (activity.testimonies ?? 0) + (activity.completions ?? 0);
    const contentParts = [
        plural(activity.completions ?? 0, 'completion'),
        plural(activity.prayer_requests ?? 0, 'prayer request'),
        plural(activity.testimonies ?? 0, 'testimony', 'testimonies'),
    ];
    const countsUnknown = ['completions', 'prayer_requests', 'testimonies'].some((key) => activity[key] === null);
    const hasPhoto = (user.photoFields?.length ?? 0) > 0;
    return (
        <Dialog
            title={`Delete ${user.name || expected}?`}
            eyebrow={`Permanent · ${env}`}
            onClose={onClose}
            width="max-w-lg"
            footer={(
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-danger" form="um-delete" type="submit" disabled={busy || typed.trim().toLowerCase() !== expected.toLowerCase()}>
                        {busy && <Loader2 size={16} className="animate-spin" />} {deleteData ? 'Delete user and data' : 'Delete user'}
                    </button>
                </>
            )}
        >
            <form id="um-delete" onSubmit={submit} className="space-y-4 text-sm">
                {error && <p className="alert alert-error">{error}</p>}
                <p className="text-gray-600">This deletes:</p>
                <ul className="list-disc pl-5 text-gray-600 space-y-1">
                    {user.hasAccount && <li>the Firebase Authentication account (they can no longer sign in)</li>}
                    {user.hasProfile && <li>the app profile, with {user.devices?.length ?? 0} device{user.devices?.length === 1 ? '' : 's'} and notification settings</li>}
                    {deleteData && <li className="font-semibold text-red-700">all their data: {contentParts.join(', ')}{hasPhoto ? ', and their profile photo' : ''}</li>}
                </ul>
                <label className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer ${deleteData ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                    <input type="checkbox" className="mt-0.5" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} disabled={busy} />
                    <span>
                        <span className="font-semibold text-gray-900">Also delete all of their data</span>
                        <span className="block text-gray-600">
                            {contentParts.join(', ')}{countsUnknown ? ' (some counts couldn\'t be loaded)' : ''}{hasPhoto ? ', and their profile photo' : ''}.
                            {' '}Use this for account deletion requests. It can't be undone.
                        </span>
                    </span>
                </label>
                {!deleteData && content > 0 && (
                    <p className="text-gray-600">Without this, their {content} completions, prayer requests and testimonies are kept. Deactivate the user instead if they may come back.</p>
                )}
                <div>
                    <label className="label" htmlFor="um-confirm">Type <span className="font-mono">{expected}</span> to confirm</label>
                    <input id="um-confirm" autoFocus autoComplete="off" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
                </div>
            </form>
        </Dialog>
    );
}
