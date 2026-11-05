import React from 'react';
import { AlertTriangle } from 'lucide-react';

const ConfirmModal = ({ title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', isDangerous = false }) => {
    return (
        <div className="modal-backdrop z-50">
            <div className="modal-panel max-w-md">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-full shrink-0 ${isDangerous ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                            <AlertTriangle size={22} />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-ink mb-1.5">{title}</h3>
                            <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button
                        onClick={onCancel}
                        className="btn btn-ghost"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`btn ${isDangerous ? 'btn-danger' : 'btn-primary'}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
