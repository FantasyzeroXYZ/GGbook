import React, { useState, useEffect } from 'react';
import { Bookmark } from '../types';
import { translations, Language } from '../lib/locales';
import { Icon } from './Icon';

interface BookmarkEditorProps {
    bookmark: Bookmark;
    onSave: (updates: Partial<Bookmark>) => void;
    onCancel: () => void;
    lang: Language;
    isDarkMode: boolean;
}

const COLORS = [
    { name: 'Yellow', value: '#FFEB3B' },
    { name: 'Red', value: '#FF5252' },
    { name: 'Green', value: '#69F0AE' },
    { name: 'Blue', value: '#448AFF' },
    { name: 'Purple', value: '#E040FB' },
];

export const BookmarkEditor: React.FC<BookmarkEditorProps> = ({ bookmark, onSave, onCancel, lang, isDarkMode }) => {
    const [note, setNote] = useState(bookmark.note || '');
    const [color, setColor] = useState(bookmark.color || '#FFEB3B');
    const t = translations[lang];

    // Prevent scrolling when modal is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    const handleSave = () => {
        onSave({ note, color });
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-bounce-in" onClick={onCancel}>
            <div 
                className={`w-full max-w-sm rounded-xl shadow-2xl overflow-hidden transform transition-all flex flex-col max-h-[90vh] ${isDarkMode ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-800'}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`px-4 py-3 border-b flex justify-between items-center shrink-0 ${isDarkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-100 bg-gray-50'}`}>
                    <h3 className="font-bold text-lg">{bookmark.type === 'highlight' ? t.highlight : t.pageBookmark}</h3>
                    <button onClick={onCancel} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                        <Icon name="times" />
                    </button>
                </div>

                <div className="p-4 space-y-4 overflow-y-auto">
                    {/* Time Label */}
                    <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                        <Icon name="clock" />
                        {new Date(bookmark.createdAt).toLocaleString()}
                    </div>

                    {/* Highlighted Text Preview */}
                    {bookmark.text && (
                        <div className="text-sm bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-100 dark:border-gray-700 italic border-l-4" style={{ borderLeftColor: color }}>
                            <span className="text-xs font-bold text-gray-400 block mb-1 uppercase">{t.selectedText}</span>
                            "{bookmark.text}"
                        </div>
                    )}

                    {/* Color Picker */}
                    <div>
                        <label className="block text-sm font-medium mb-2 opacity-80">{t.bookmarkColor}</label>
                        <div className="flex gap-3 justify-center">
                            {COLORS.map((c) => (
                                <button
                                    key={c.value}
                                    onClick={() => setColor(c.value)}
                                    className={`w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center shadow-sm ${color === c.value ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-800' : ''}`}
                                    style={{ backgroundColor: c.value }}
                                    title={c.name}
                                >
                                    {color === c.value && <Icon name="check" className="text-gray-800 text-xs" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Note Input */}
                    <div>
                        <label className="block text-sm font-medium mb-2 opacity-80">{t.notePlaceholder}</label>
                        <textarea
                            className={`w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none resize-none h-32 text-sm ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                            placeholder={t.notePlaceholder}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            // Prevent auto-focus on mobile to avoid keyboard popup
                            autoFocus={false}
                        />
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className={`p-4 border-t flex gap-3 shrink-0 ${isDarkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-100 bg-gray-50'}`}>
                    <button 
                        onClick={onCancel}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'}`}
                    >
                        {t.cancel}
                    </button>
                    <button 
                        onClick={handleSave}
                        className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30"
                    >
                        {t.save}
                    </button>
                </div>
            </div>
        </div>
    );
};