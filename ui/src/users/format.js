// Formatting helpers for the User Manager.
import { format } from 'date-fns';

export function formatDate(iso, pattern = 'MMM d, yyyy') {
    return iso ? format(new Date(iso), pattern) : '—';
}

export function initials(user) {
    const source = user.name || user.email || user.uid;
    const parts = source.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
