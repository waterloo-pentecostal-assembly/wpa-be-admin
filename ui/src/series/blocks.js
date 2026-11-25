import { newId } from './draftModel.js';

export const BLOCK_KINDS = [
    { kind: 'text', label: 'Text' },
    { kind: 'question', label: 'Questions' },
    { kind: 'scripture', label: 'Scripture' },
    { kind: 'link', label: 'Link' },
    { kind: 'image_input', label: 'Photo upload' },
    { kind: 'audio', label: 'Audio' },
];

export function newBlock(kind) {
    switch (kind) {
        case 'scripture': return { id: newId('b'), kind, source: 'reading' };
        case 'link': return { id: newId('b'), kind, text: '', url: '' };
        case 'image_input': return { id: newId('b'), kind };
        case 'audio': return { id: newId('b'), kind, title: '', url: '', filename: '' };
        default: return { id: newId('b'), kind, text: '' };
    }
}
