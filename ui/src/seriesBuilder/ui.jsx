// Small shared UI pieces for the series builder.
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { typeColors, typeLabel } from '../series/engagementTypes';

export function Dialog({ title, eyebrow, onClose, children, footer, width = 'max-w-2xl', bodyClassName = 'p-6' }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    return (
        <div className="modal-backdrop z-50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className={`modal-panel ${width} max-h-[90vh]`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
                <div className="modal-header">
                    <div className="min-w-0">
                        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
                        <h3 className="text-lg font-bold text-ink truncate">{title}</h3>
                    </div>
                    <button onClick={onClose} className="icon-btn" title="Close (Esc)"><X size={18} /></button>
                </div>
                <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );
}

export function TypeChip({ type, className = '' }) {
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset ${typeColors(type).chip} ${className}`}>
            {typeLabel(type)}
        </span>
    );
}

export function TypeDot({ type, hollow = false, title, onDark = false }) {
    const colors = typeColors(type);
    return (
        <span
            title={title ?? typeLabel(type)}
            className={`inline-block h-2 w-2 rounded-full ${hollow ? `ring-[1.5px] ring-inset ${onDark ? 'ring-white' : colors.ring}` : `${colors.dot} ${onDark ? 'ring-1 ring-white' : ''}`}`}
        />
    );
}

/** Textarea that grows with its content. */
export function AutoTextarea({ value, onChange, minRows = 2, className = '', textareaRef, ...props }) {
    const innerRef = useRef(null);
    const ref = textareaRef ?? innerRef;
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight + 2}px`;
    }, [value, ref]);
    return (
        <textarea
            ref={ref}
            rows={minRows}
            value={value}
            onChange={onChange}
            className={`input resize-none overflow-hidden leading-relaxed ${className}`}
            {...props}
        />
    );
}

export function Kbd({ children }) {
    return <kbd className="rounded border border-gray-300 bg-white px-1 font-sans text-[10px] font-semibold text-gray-600">{children}</kbd>;
}

export function Toasts({ toasts, onDismiss }) {
    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none">
            {toasts.map((t) => (
                <div key={t.id} className={`pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2 text-sm shadow-lg animate-pop-in ${t.tone === 'error' ? 'bg-red-600 text-white' : 'bg-ink text-white'}`}>
                    <span>{t.message}</span>
                    {t.action && (
                        <button
                            className="font-semibold text-brand-200 hover:text-white"
                            onClick={() => {
                                t.action.run();
                                onDismiss(t.id);
                            }}
                        >
                            {t.action.label}
                        </button>
                    )}
                    <button onClick={() => onDismiss(t.id)} className="text-white/60 hover:text-white"><X size={14} /></button>
                </div>
            ))}
        </div>
    );
}
