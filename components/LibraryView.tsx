
import React, { useState, useRef } from 'react';
import { LibraryBook, ReaderState, AppSettings, AnkiSettings } from '../types';
import { Icon } from './Icon';
import { translations } from '../lib/locales';
import { LayoutGrid, List as ListIcon, Trash2, Import, Settings, Moon, Sun, BookOpen, Clock, FileText, Edit2, Download, Upload, Save, X } from 'lucide-react';
import { db } from '../lib/db';

interface LibraryViewProps {
    state: ReaderState;
    libraryBooks: LibraryBook[];
    openBook: (book: LibraryBook) => void;
    deleteBook: (id: string, e: React.MouseEvent) => void;
    handleImportBook: (e: React.ChangeEvent<HTMLInputElement>) => void;
    updateSetting: (key: keyof AppSettings, val: any) => void;
    tempSettings: AppSettings;
    onToggleSettings: () => void;
    tempAnki?: AnkiSettings;
    setTempAnki?: (s: AnkiSettings) => void;
    controller?: any;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
    state,
    libraryBooks,
    openBook,
    deleteBook,
    handleImportBook,
    updateSetting,
    tempSettings,
    onToggleSettings,
    tempAnki,
    setTempAnki,
    controller
}) => {
    const t = translations[tempSettings.language || 'zh'];
    const [ankiConfigTab, setAnkiConfigTab] = useState<'vocab' | 'excerpt' | 'cloze'>('vocab');
    
    // Book Editing State
    const [editingBook, setEditingBook] = useState<LibraryBook | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const coverInputRef = useRef<HTMLInputElement>(null);
    const importDataInputRef = useRef<HTMLInputElement>(null);

    const refreshLibrary = async () => {
        // Trigger a refresh logic if needed, currently parent controls state
        // For now, we might rely on parent update or simple reload, 
        // but cleaner is to modify the book in place in the list or trigger callback.
        // Assuming parent re-renders when we modify DB and call a refresh.
        // Since we don't have a direct refresh callback, we'll force a reload or 
        // if this component is re-mounted. Ideally App.tsx should pass a refresh function.
        // For minimal changes, we'll trust App.tsx updates or reload.
        window.location.reload(); 
    };

    const handleEditBook = (e: React.MouseEvent, book: LibraryBook) => {
        e.stopPropagation();
        setEditingBook(book);
        setEditTitle(book.title);
    };

    const saveBookChanges = async () => {
        if (!editingBook) return;
        try {
            await db.updateBookMetadata(editingBook.id, { title: editTitle, coverUrl: editingBook.coverUrl });
            setEditingBook(null);
            window.location.reload(); // Simple refresh for now
        } catch (e) {
            alert(t.failed);
        }
    };

    const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && editingBook) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    setEditingBook({ ...editingBook, coverUrl: ev.target.result as string });
                }
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleDownloadCover = () => {
        if (editingBook?.coverUrl) {
            const a = document.createElement('a');
            a.href = editingBook.coverUrl;
            a.download = `${editingBook.title}_cover.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    const handleExportNotes = (format: 'pretty' | 'anki') => {
        if (!editingBook || !editingBook.bookmarks) return;
        const book = editingBook;
        let content = '';

        if (format === 'pretty') {
            content = `# ${book.title}\n`;
            if (book.author) content += `*${book.author}*\n\n`;
            content += `---\n\n`;
            const sorted = [...book.bookmarks].sort((a, b) => a.createdAt - b.createdAt);
            sorted.forEach(bm => {
                if (bm.type === 'highlight' && bm.text) {
                    content += `> ${bm.text.replace(/\n/g, '\n> ')}\n\n`;
                    if (bm.note) content += `**Note:** ${bm.note}\n\n`;
                    content += `<small>${new Date(bm.createdAt).toLocaleString()} | ${bm.label}</small>\n\n---\n\n`;
                } else {
                     content += `### ${bm.label}\n<small>${new Date(bm.createdAt).toLocaleString()}</small>\n\n`;
                     if (bm.note) content += `${bm.note}\n\n`;
                     content += `---\n\n`;
                }
            });
        } else {
            // Anki Format: Field separated
            // Structure: Text | Note | Source | Extra
            content = `Title: ${book.title}\nAuthor: ${book.author}\n\n`;
            const sorted = [...book.bookmarks].sort((a, b) => a.createdAt - b.createdAt);
            sorted.forEach(bm => {
                if (bm.type === 'highlight' && bm.text) {
                    content += `## Item\n`;
                    content += `Text: ${bm.text.replace(/\n/g, ' ')}\n`;
                    content += `Note: ${bm.note || ''}\n`;
                    content += `Source: ${book.title} - ${bm.label}\n`;
                    content += `Date: ${new Date(bm.createdAt).toISOString()}\n`;
                    content += `\n---\n\n`;
                }
            });
        }

        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${book.title}_notes_${format}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleExportData = () => {
        if (!editingBook) return;
        const data = JSON.stringify({
            id: editingBook.id,
            title: editingBook.title,
            progress: editingBook.progress,
            bookmarks: editingBook.bookmarks,
            addedAt: editingBook.addedAt
        }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${editingBook.title}_data.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && editingBook) {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    const data = JSON.parse(ev.target?.result as string);
                    if (data.progress || data.bookmarks) {
                        await db.updateBookProgress(editingBook.id, data.progress);
                        await db.updateBookBookmarks(editingBook.id, data.bookmarks);
                        alert(t.dataImported);
                        window.location.reload();
                    }
                } catch (err) {
                    alert(t.failed);
                }
            };
            reader.readAsText(e.target.files[0]);
        }
    };

    const renderAnkiFieldSelect = (label: string, value: string, onChange: (val: string) => void) => (
        <div className="mb-2">
            <label className="block text-xs font-medium mb-1 text-slate-500 dark:text-slate-400">{label}</label>
            <select className="w-full p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm dark:text-slate-200" value={value} onChange={e => onChange(e.target.value)}>
                <option value="">-- Ignore --</option>
                {state.ankiFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
        </div>
    );

    return (
        <div className={`min-h-[100dvh] flex flex-col ${state.isDarkMode ? 'dark bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
            <div className="flex justify-between items-center px-6 py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800">
                <h1 className="text-xl font-bold flex items-center gap-2 tracking-tight">
                    <BookOpen className="text-blue-600 dark:text-blue-400" /> 
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">EPUB Reader</span>
                </h1>
                <div className="flex gap-2">
                    <button onClick={onToggleSettings} className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-300" title={t.settings}>
                        <Settings size={20} />
                    </button>
                    <button onClick={() => updateSetting('darkMode', !state.isDarkMode)} className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-300">
                        {state.isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                </div>
            </div>

            <div className="flex-1 container mx-auto p-4 md:p-8 max-w-7xl">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t.library}</h2>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-white dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700 shadow-sm">
                             <button 
                                onClick={() => updateSetting('libraryLayout', 'grid')} 
                                className={`p-2 rounded transition-all ${tempSettings.libraryLayout === 'grid' ? 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                title={t.gridView}
                            >
                                <LayoutGrid size={18} />
                             </button>
                             <button 
                                onClick={() => updateSetting('libraryLayout', 'list')} 
                                className={`p-2 rounded transition-all ${tempSettings.libraryLayout === 'list' ? 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                title={t.listView}
                            >
                                <ListIcon size={18} />
                             </button>
                        </div>
                        
                        <label className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 hover:-translate-y-0.5 active:translate-y-0">
                            <Import size={18} /> 
                            {t.importBook}
                            <input type="file" className="hidden" accept=".epub" onChange={handleImportBook} />
                        </label>
                    </div>
                </div>

                {state.isLoading && (
                    <div className="text-center py-20">
                        <div className="loader inline-block border-4 border-slate-200 border-t-blue-500 rounded-full w-10 h-10 animate-spin-custom mb-4"></div>
                        <p className="text-slate-500 font-medium animate-pulse">{state.loadingMessage}</p>
                    </div>
                )}

                {libraryBooks.length === 0 && !state.isLoading && (
                    <div className="text-center py-32 opacity-50">
                        <BookOpen size={64} className="mx-auto mb-4 text-slate-300" strokeWidth={1} />
                        <p className="text-lg">{t.noBooks}</p>
                    </div>
                )}

                {tempSettings.libraryLayout === 'list' ? (
                    <div className="grid grid-cols-1 gap-4 pb-20">
                         {libraryBooks.map(book => (
                             <div key={book.id} onClick={() => openBook(book)} className="group bg-white dark:bg-slate-800 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-blue-500/30 transition-all border border-slate-200 dark:border-slate-700 cursor-pointer flex gap-4 items-center relative overflow-hidden">
                                  {/* Compact Cover */}
                                  <div className="w-12 h-16 bg-slate-100 dark:bg-slate-700 rounded-md overflow-hidden shrink-0 shadow-inner flex items-center justify-center border border-slate-200 dark:border-slate-600">
                                      {book.coverUrl ? ( <img src={book.coverUrl} className="w-full h-full object-cover" /> ) : ( <BookOpen className="text-slate-300 dark:text-slate-500" size={20} /> )}
                                  </div>
                                  
                                  {/* Info */}
                                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                                      <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base truncate pr-20">{book.title}</h3>
                                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                                          <span className="truncate max-w-[200px]">{book.author}</span>
                                          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                                          <span>{new Date(book.addedAt).toLocaleDateString()}</span>
                                      </div>
                                      
                                      {/* Slim Progress Bar */}
                                      {book.progress && (
                                          <div className="mt-1.5 flex items-center gap-2">
                                              <div className="h-1 flex-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden max-w-[200px]">
                                                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.round((book.progress.percentage || 0) * 100)}%` }}></div>
                                              </div>
                                              <span className="text-[10px] font-medium text-slate-400">{Math.round((book.progress.percentage || 0) * 100)}%</span>
                                          </div>
                                      )}
                                  </div>

                                  {/* Actions - Always visible on desktop, cleaner look */}
                                  <div className="flex items-center gap-2 px-2">
                                       <button onClick={(e) => handleEditBook(e, book)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-full transition-colors" title={t.editBookmark}>
                                           <Edit2 size={18} />
                                       </button>
                                       <button onClick={(e) => deleteBook(book.id, e)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-full transition-colors" title={t.deleteConfirm}>
                                           <Trash2 size={18} />
                                       </button>
                                  </div>
                             </div>
                         ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 pb-20">
                        {libraryBooks.map(book => (
                            <div key={book.id} onClick={() => openBook(book)} className="group bg-white dark:bg-slate-800 rounded-2xl shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden border border-slate-100 dark:border-slate-700/50 flex flex-col h-full relative">
                                <div className="w-full aspect-[2/3] bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-300 dark:text-slate-600 overflow-hidden relative group-hover:brightness-95 transition-all">
                                    {book.coverUrl ? (
                                        <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" />
                                    ) : (
                                        <BookOpen size={48} strokeWidth={1.5} />
                                    )}
                                    {/* Action Buttons Overlay */}
                                    <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0 duration-300">
                                        <button 
                                            onClick={(e) => deleteBook(book.id, e)}
                                            className="p-2 bg-white/90 dark:bg-slate-800/90 text-red-500 rounded-full shadow-lg hover:bg-red-50 dark:hover:bg-red-900/30 backdrop-blur-sm"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <button 
                                            onClick={(e) => handleEditBook(e, book)}
                                            className="p-2 bg-white/90 dark:bg-slate-800/90 text-blue-500 rounded-full shadow-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 backdrop-blur-sm"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    </div>
                                    
                                    {/* Progress Bar Overlay */}
                                    {book.progress && (
                                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-200/30 backdrop-blur-sm">
                                            <div 
                                                className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
                                                style={{ width: `${Math.round((book.progress.percentage || 0) * 100)}%` }}
                                            ></div>
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 flex-1 flex flex-col">
                                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-snug mb-1 line-clamp-2" title={book.title}>{book.title}</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mb-2">{book.author}</p>
                                    <div className="mt-auto flex items-center gap-1 text-[10px] text-slate-400">
                                        <Clock size={10} />
                                        <span>{new Date(book.addedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Book Modal */}
            {editingBook && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setEditingBook(null)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
                            <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">{t.editBook}</h3>
                            <button onClick={() => setEditingBook(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20}/></button>
                        </div>
                        
                        <div className="p-6 space-y-6">
                            {/* Title Edit */}
                            <div>
                                <label className="block text-sm font-medium mb-2 text-slate-600 dark:text-slate-300">{t.bookTitle}</label>
                                <input 
                                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" 
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                />
                            </div>

                            {/* Cover Edit */}
                            <div>
                                <label className="block text-sm font-medium mb-2 text-slate-600 dark:text-slate-300">{t.coverImage}</label>
                                <div className="flex gap-4 items-start">
                                    <div className="w-24 h-36 bg-slate-100 dark:bg-slate-700 rounded-md overflow-hidden shrink-0 border border-slate-200 dark:border-slate-600">
                                        {editingBook.coverUrl ? (
                                            <img src={editingBook.coverUrl} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-500"><BookOpen size={24}/></div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <button onClick={() => coverInputRef.current?.click()} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-xs font-medium flex items-center gap-2 dark:text-slate-200">
                                            <Upload size={14}/> {t.changeCover}
                                        </button>
                                        <input type="file" ref={coverInputRef} className="hidden" accept="image/*" onChange={handleCoverUpload}/>
                                        
                                        <button onClick={handleDownloadCover} disabled={!editingBook.coverUrl} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-xs font-medium flex items-center gap-2 dark:text-slate-200 disabled:opacity-50">
                                            <Download size={14}/> {t.downloadCover}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            
                            <hr className="border-slate-100 dark:border-slate-700" />
                            
                            {/* Exports */}
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => handleExportNotes('pretty')} className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2">
                                    <FileText size={14}/> {t.exportMarkdownPretty}
                                </button>
                                <button onClick={() => handleExportNotes('anki')} className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2">
                                    <LayoutGrid size={14}/> {t.exportMarkdownAnki}
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={handleExportData} className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2">
                                    <Download size={14}/> {t.exportData}
                                </button>
                                <button onClick={() => importDataInputRef.current?.click()} className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2">
                                    <Import size={14}/> {t.importData}
                                </button>
                                <input type="file" ref={importDataInputRef} className="hidden" accept=".json" onChange={handleImportData}/>
                            </div>

                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-b-xl flex justify-end gap-2">
                            <button onClick={() => setEditingBook(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">{t.cancel}</button>
                            <button onClick={saveBookChanges} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2">
                                <Save size={16}/> {t.save}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Settings Sidebar */}
            {state.isSettingsOpen && (
                <div className="fixed inset-0 z-50 overflow-hidden">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity" onClick={onToggleSettings}></div>
                    <div className="absolute inset-y-0 right-0 w-80 max-w-full bg-white dark:bg-slate-800 shadow-2xl flex flex-col animate-slide-in-right transform transition-transform">
                        <div className="p-5 bg-slate-50 dark:bg-slate-900 flex justify-between items-center font-bold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 shrink-0">
                            <span className="flex items-center gap-2"><Settings size={18} /> {t.settings}</span>
                            <button onClick={onToggleSettings} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><Icon name="times"/></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                             
                             {/* General Settings */}
                             <details className="group border border-slate-200 dark:border-slate-700 rounded-lg open:bg-slate-50 dark:open:bg-slate-800/50" open>
                                <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg">
                                    <span>{t.settingsCategories.general}</span>
                                    <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                                </summary>
                                <div className="p-3 pt-0 space-y-3 border-t border-slate-100 dark:border-slate-700 mt-2">
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.language}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.language} onChange={(e) => updateSetting('language', e.target.value as any)}>
                                            <option value="zh">中文</option>
                                            <option value="en">English</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.theme}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value as any)}>
                                            <option value="light">{t.light}</option>
                                            <option value="dark">{t.dark}</option>
                                            <option value="sepia">{t.sepia}</option>
                                        </select>
                                    </div>
                                </div>
                             </details>

                             {/* Reading Settings */}
                             <details className="group border border-slate-200 dark:border-slate-700 rounded-lg open:bg-slate-50 dark:open:bg-slate-800/50">
                                <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg">
                                    <span>{t.settingsCategories.reading}</span>
                                    <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                                </summary>
                                <div className="p-3 pt-0 space-y-3 border-t border-slate-100 dark:border-slate-700 mt-2">
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.fontSize}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.fontSize} onChange={(e) => updateSetting('fontSize', e.target.value)}>
                                            <option value="small">{t.small}</option>
                                            <option value="medium">{t.medium}</option>
                                            <option value="large">{t.large}</option>
                                            <option value="xlarge">{t.xlarge}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.layout}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.layoutMode} onChange={(e) => updateSetting('layoutMode', e.target.value)}>
                                            <option value="single">{t.singlePage}</option>
                                            <option value="double">{t.doublePage}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.pageDirection}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.pageDirection} onChange={(e) => updateSetting('pageDirection', e.target.value)}>
                                            <option value="ltr">{t.ltr}</option>
                                            <option value="rtl">{t.rtl}</option>
                                        </select>
                                    </div>
                                    <div>
                                         <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.dictionaryMode}</label>
                                         <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.dictionaryMode || 'panel'} onChange={(e) => updateSetting('dictionaryMode', e.target.value)}>
                                             <option value="modal">{t.modalMode}</option>
                                             <option value="panel">{t.panelMode}</option>
                                         </select>
                                     </div>
                                     <div>
                                         <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.segmentationMode}</label>
                                         <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.segmentationMode || 'browser'} onChange={(e) => updateSetting('segmentationMode', e.target.value)}>
                                             <option value="browser">{t.segBrowser}</option>
                                             <option value="auto">{t.segAuto}</option>
                                         </select>
                                     </div>
                                     <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.dictionaryLang}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.dictionaryLanguage || 'en'} onChange={(e) => updateSetting('dictionaryLanguage', e.target.value)}>
                                            <option value="en">English</option>
                                            <option value="zh">Chinese</option>
                                            <option value="ja">Japanese</option>
                                            <option value="es">Spanish</option>
                                            <option value="fr">French</option>
                                            <option value="ru">Russian</option>
                                        </select>
                                    </div>
                                </div>
                             </details>

                             {/* Audio & TTS */}
                             <details className="group border border-slate-200 dark:border-slate-700 rounded-lg open:bg-slate-50 dark:open:bg-slate-800/50">
                                <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg">
                                    <span>{t.settingsCategories.audio}</span>
                                    <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                                </summary>
                                <div className="p-3 pt-0 space-y-3 border-t border-slate-100 dark:border-slate-700 mt-2">
                                    <label className="flex items-center space-x-3 cursor-pointer p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                        <input type="checkbox" checked={tempSettings.ttsEnabled} onChange={e => updateSetting('ttsEnabled', e.target.checked)} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.enableTTS}</span>
                                    </label>
                                    {tempSettings.ttsEnabled && (
                                         <div>
                                             <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.voice}</label>
                                             <select 
                                                 className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" 
                                                 value={tempSettings.ttsVoiceURI} 
                                                 onChange={(e) => updateSetting('ttsVoiceURI', e.target.value)}
                                             >
                                                 <option value="">Default</option>
                                                 {state.ttsVoices.map(v => (
                                                     <option key={v.voiceURI} value={v.voiceURI}>
                                                         {v.name} ({v.lang})
                                                     </option>
                                                 ))}
                                             </select>
                                             <button 
                                               className="mt-2 w-full py-2 bg-slate-200 dark:bg-slate-700 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors text-xs font-bold dark:text-slate-200" 
                                               onClick={() => controller.current?.testTTS()}
                                           >
                                               {t.testVoice}
                                           </button>
                                         </div>
                                    )}
                                    <label className="flex items-center space-x-3 cursor-pointer p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                        <input type="checkbox" checked={tempSettings.autoPlayAudio} onChange={e => updateSetting('autoPlayAudio', e.target.checked)} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.autoPlay}</span>
                                    </label>
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.volume}</label>
                                        <input type="range" min="0" max="100" value={tempSettings.audioVolume} onChange={e => updateSetting('audioVolume', parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer dark:bg-slate-700"/>
                                    </div>
                                </div>
                             </details>

                             {/* Integrations (Anki) - Modified: Groups always visible */}
                            <details className="group border border-slate-200 dark:border-slate-700 rounded-lg open:bg-slate-50 dark:open:bg-slate-800/50">
                                <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg">
                                    <span>{t.settingsCategories.anki}</span>
                                    <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                                </summary>
                                <div className="p-3 pt-0 space-y-3 border-t border-slate-100 dark:border-slate-700 mt-2">
                                    {/* Connection Settings */}
                                    <div className="flex gap-2">
                                        <input 
                                            className="flex-1 p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm dark:text-slate-200" 
                                            placeholder={t.host} 
                                            value={tempAnki?.host || '127.0.0.1'} 
                                            onChange={e => setTempAnki && setTempAnki({ ...tempAnki!, host: e.target.value })}
                                        />
                                        <input 
                                            className="w-20 p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm dark:text-slate-200" 
                                            type="number" 
                                            placeholder={t.port} 
                                            value={tempAnki?.port || 8765} 
                                            onChange={e => setTempAnki && setTempAnki({ ...tempAnki!, port: parseInt(e.target.value) })}
                                        />
                                    </div>
                                    <button 
                                        className="w-full py-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm font-medium dark:text-slate-200" 
                                        onClick={() => controller?.current?.testAnki()}
                                    >
                                        {t.testConnection}
                                    </button>

                                    {tempAnki && (
                                        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
                                            {/* Config Tabs */}
                                            <div className="flex bg-slate-200 dark:bg-slate-700 p-1 rounded-lg mb-3">
                                                {(['vocab', 'excerpt', 'cloze'] as const).map(type => (
                                                    <button
                                                        key={type}
                                                        onClick={() => setAnkiConfigTab(type)}
                                                        className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${ankiConfigTab === type ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                                    >
                                                        {t.ankiTypes[type]}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Tab Content */}
                                            <div className="space-y-3">
                                                {/* Deck & Model Selectors */}
                                                <div>
                                                    <label className="block text-xs font-medium mb-1 text-slate-500 dark:text-slate-400">{t.selectDeck}</label>
                                                    <select 
                                                        className="w-full p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm dark:text-slate-200"
                                                        value={tempAnki[`${ankiConfigTab}Deck` as keyof AnkiSettings] as string}
                                                        onChange={e => setTempAnki && setTempAnki({ ...tempAnki, [`${ankiConfigTab}Deck`]: e.target.value })}
                                                    >
                                                        <option value="">{t.selectDeck}</option>
                                                        {state.ankiDecks.map(d => <option key={d} value={d}>{d}</option>)}
                                                    </select>
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-medium mb-1 text-slate-500 dark:text-slate-400">{t.selectModel}</label>
                                                    <select 
                                                        className="w-full p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm dark:text-slate-200"
                                                        value={tempAnki[`${ankiConfigTab}Model` as keyof AnkiSettings] as string}
                                                        onChange={e => {
                                                            const newModel = e.target.value;
                                                            setTempAnki && setTempAnki({ ...tempAnki, [`${ankiConfigTab}Model`]: newModel });
                                                            if (controller.current) controller.current.loadAnkiFields(newModel);
                                                        }}
                                                    >
                                                        <option value="">{t.selectModel}</option>
                                                        {state.ankiModels.map(m => <option key={m} value={m}>{m}</option>)}
                                                    </select>
                                                </div>

                                                {/* Field Mappings - Dynamic based on Tab */}
                                                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700/50 space-y-2">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Field Mapping</div>
                                                    
                                                    {ankiConfigTab === 'vocab' && (
                                                        <>
                                                            {renderAnkiFieldSelect(t.wordField, tempAnki.vocabWordField, (v) => setTempAnki && setTempAnki({ ...tempAnki, vocabWordField: v }))}
                                                            {renderAnkiFieldSelect(t.meaningField, tempAnki.vocabMeaningField, (v) => setTempAnki && setTempAnki({ ...tempAnki, vocabMeaningField: v }))}
                                                            {renderAnkiFieldSelect(t.sentenceField, tempAnki.vocabSentenceField, (v) => setTempAnki && setTempAnki({ ...tempAnki, vocabSentenceField: v }))}
                                                            {renderAnkiFieldSelect(t.audioField, tempAnki.vocabAudioField, (v) => setTempAnki && setTempAnki({ ...tempAnki, vocabAudioField: v }))}
                                                        </>
                                                    )}

                                                    {ankiConfigTab === 'excerpt' && (
                                                        <>
                                                            {renderAnkiFieldSelect(t.ankiFields.content, tempAnki.excerptContentField, (v) => setTempAnki && setTempAnki({ ...tempAnki, excerptContentField: v }))}
                                                            {renderAnkiFieldSelect(t.ankiFields.source, tempAnki.excerptSourceField, (v) => setTempAnki && setTempAnki({ ...tempAnki, excerptSourceField: v }))}
                                                            {renderAnkiFieldSelect(t.ankiFields.note, tempAnki.excerptNoteField, (v) => setTempAnki && setTempAnki({ ...tempAnki, excerptNoteField: v }))}
                                                        </>
                                                    )}

                                                    {ankiConfigTab === 'cloze' && (
                                                        <>
                                                            {renderAnkiFieldSelect(t.ankiFields.content, tempAnki.clozeContentField, (v) => setTempAnki && setTempAnki({ ...tempAnki, clozeContentField: v }))}
                                                            {renderAnkiFieldSelect(t.ankiFields.source, tempAnki.clozeSourceField, (v) => setTempAnki && setTempAnki({ ...tempAnki, clozeSourceField: v }))}
                                                            {renderAnkiFieldSelect(t.ankiFields.note, tempAnki.clozeNoteField, (v) => setTempAnki && setTempAnki({ ...tempAnki, clozeNoteField: v }))}
                                                        </>
                                                    )}
                                                </div>

                                                <button 
                                                    className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-sm font-medium mt-4" 
                                                    onClick={() => controller.current?.saveAnkiSettings()}
                                                >
                                                    {t.saveAnkiSettings}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </details>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
