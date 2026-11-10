// Small pieces shared by the User Manager list and detail panel.
import React, { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Check, Copy } from 'lucide-react';
import { initials } from './format';

/** "3 days ago", with the exact time on hover. */
export function RelativeTime({ iso, empty = 'Never' }) {
    if (!iso) return <span className="text-gray-400">{empty}</span>;
    return <time dateTime={iso} title={format(new Date(iso), 'PPpp')}>{formatDistanceToNow(new Date(iso), { addSuffix: true })}</time>;
}

/** The user's profile photo, or their initials if there is none (or it fails to load). */
export function Avatar({ user, size = 'h-9 w-9 text-xs' }) {
    const [failedUrl, setFailedUrl] = useState(null);
    if (user.photoUrl && failedUrl !== user.photoUrl) {
        return (
            <img
                src={user.photoUrl}
                alt=""
                loading="lazy"
                onError={() => setFailedUrl(user.photoUrl)}
                className={`${size} shrink-0 rounded-full object-cover bg-gray-100 ${user.disabled ? 'grayscale opacity-60' : ''}`}
            />
        );
    }
    return (
        <span className={`${size} shrink-0 rounded-full flex items-center justify-center font-bold ${user.disabled ? 'bg-gray-200 text-gray-500' : 'bg-brand-50 text-brand'}`}>
            {initials(user)}
        </span>
    );
}

const BADGE_TONES = {
    red: 'bg-red-50 text-red-700 ring-red-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    gray: 'bg-gray-100 text-gray-600 ring-gray-200',
    green: 'bg-green-50 text-green-700 ring-green-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({ tone = 'gray', title, children }) {
    return (
        <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset whitespace-nowrap ${BADGE_TONES[tone]}`}>
            {children}
        </span>
    );
}

// The two "verified" flags are separate steps:
//   - approval: an admin accepted the user (profile is_verified), and
//   - email: the user clicked the link in their verification email (Auth emailVerified).
const awaitingApproval = (user) => user.hasProfile && !user.isVerified;
const emailUnverified = (user) => user.hasAccount && !user.emailVerified;

/** The flags worth noticing at a glance; nothing for an ordinary active user. */
export function StatusBadges({ user }) {
    return (
        <div className="flex flex-wrap gap-1">
            {user.disabled && <Badge tone="red" title="Firebase Authentication account is disabled">Deactivated</Badge>}
            {user.isAdmin && <Badge tone="brand" title="is_admin is set on the profile">Admin</Badge>}
            {awaitingApproval(user) && <Badge tone="amber" title="An admin hasn't approved this user yet (profile is_verified is off)">Awaiting approval</Badge>}
            {emailUnverified(user) && <Badge tone="violet" title="The user hasn't clicked the link in their verification email (Auth emailVerified is off)">Email not verified</Badge>}
            {user.reports > 0 && <Badge tone="amber" title="Times this user has been reported">{user.reports} report{user.reports === 1 ? '' : 's'}</Badge>}
            {!user.hasProfile && <Badge title="Has a sign-in account but no users/{uid} profile in Firestore">No profile</Badge>}
            {!user.hasAccount && <Badge title="Has a Firestore profile but no Firebase Authentication account">No account</Badge>}
            {user.emailMismatch && <Badge tone="amber" title="The Auth email and the profile email differ">Email mismatch</Badge>}
        </div>
    );
}

export function CopyButton({ text, label = 'Copy', className = 'btn btn-secondary btn-sm' }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <button type="button" className={className} onClick={copy} title={`Copy ${text}`}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {label && (copied ? 'Copied' : label)}
        </button>
    );
}
