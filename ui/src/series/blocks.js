import { newId } from './draftModel.js';

export const BLOCK_KINDS = [
    { kind: 'text', label: 'Text' },
    { kind: 'question', label: 'Questions' },
    { kind: 'scripture', label: 'Scripture' },
    { kind: 'link', label: 'Link' },
    { kind: 'image_input', label: 'Photo upload' },
];

export function newBlock(kind) {
    switch (kind) {
        case 'scripture': return { id: newId('b'), kind, source: 'reading' };
        case 'link': return { id: newId('b'), kind, text: '', url: '' };
        case 'image_input': return { id: newId('b'), kind };
        default: return { id: newId('b'), kind, text: '' };
    }
}
