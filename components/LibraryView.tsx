
import React, { useState } from 'react';
import { LibraryBook, ReaderState, AppSettings, AnkiSettings } from '../types';
import { Icon } from './Icon';
import { translations } from '../lib/locales';
import { LayoutGrid, List as ListIcon, Trash2, Import, Settings, Moon, Sun, BookOpen, Clock } from 'lucide-react';

interface LibraryViewProps {
    state: ReaderState;
    libraryBooks: LibraryBook[];
    openBook: (book: LibraryBook) => void;
    deleteBook: (id: string, e: React.MouseEvent) => void;
    handleImportBook: (e: React.ChangeEvent<HTMLInputElement>) => void;
    updateSetting: (key: keyof AppSettings, val: any) => void;
    tempSettings: AppSettings;
    onToggleSettings: () => void;
    // We need access to anki settings just for display/editing in the sidebar
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

    const exportMarkdown = (e: React.MouseEvent, book: LibraryBook) => {
        e.stopPropagation();
        if (!book.bookmarks || book.bookmarks.length === 0) {
            alert(t.noBookmarks);
            return;
        }

        let mdContent = `# ${book.title}\n`;
        if (book.author) mdContent += `*${book.author}*\n\n`;
        mdContent += `---\n\n`;

        const sortedBookmarks = [...book.bookmarks].sort((a, b) => a.createdAt - b.createdAt);

        sortedBookmarks.forEach(bm => {
            if (bm.type === 'highlight' && bm.text) {
                mdContent += `> ${bm.text.replace(/\n/g, '\n> ')}\n\n`;
                mdContent += `<small>${t.highlight} | ${new Date(bm.createdAt).toLocaleString()} | ${bm.label}</small>\n\n`;
            } else {
                mdContent += `### ${bm.label}\n`;
                mdContent += `<small>${t.pageBookmark} | ${new Date(bm.createdAt).toLocaleString()}</small>\n\n`;
            }

            if (bm.color && bm.color !== '#FFEB3B') {
                 mdContent += `**${t.bookmarkColor}:** ${bm.color}\n\n`;
            }

            if (bm.note) {
                mdContent += `**Note:**\n${bm.note}\n\n`;
            }

            mdContent += `---\n\n`;
        });

        const blob = new Blob([mdContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${book.title.replace(/\s+/g, '_')}_notes.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className={`min-h-[100dvh] flex flex-col ${state.isDarkMode ? 'dark bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
            <div className="flex justify-between items-center px-6 py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800">
                <h1 className="text-xl font-bold flex items-center gap-2 tracking-tight">
                    <BookOpen className="text-blue-600 dark:text-blue-400" /> 
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">EPUB Reader</span>
                </h1>
                <div className="flex gap-2">
                    <button onClick={onToggleSettings} className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400" title={t.settings}>
                        <Settings size={20} />
                    </button>
                    <button onClick={() => updateSetting('darkMode', !state.isDarkMode)} className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400">
                        {state.isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                </div>
            </div>

            <div className="flex-1 container mx-auto p-4 md:p-8 max-w-7xl">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Library</h2>
                    <div className="flex items-center gap-3">
                        {/* Grid/List Toggle Button */}
                        <div className="flex bg-white dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700 shadow-sm">
                             <button 
                                onClick={() => updateSetting('libraryLayout', 'grid')} 
                                className={`p-2 rounded transition-all ${tempSettings.libraryLayout === 'grid' ? 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                title="Grid View"
                            >
                                <LayoutGrid size={18} />
                             </button>
                             <button 
                                onClick={() => updateSetting('libraryLayout', 'list')} 
                                className={`p-2 rounded transition-all ${tempSettings.libraryLayout === 'list' ? 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                title="List View"
                            >
                                <ListIcon size={18} />
                             </button>
                        </div>
                        
                        <label className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 hover:-translate-y-0.5 active:translate-y-0">
                            <Import size={18} /> 
                            Import Book
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

                {tempSettings.libraryLayout === 'list' ? (
                    <div className="space-y-3 pb-20">
                         {libraryBooks.map(book => (
                             <div key={book.id} onClick={() => openBook(book)} className="group bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all border border-slate-100 dark:border-slate-700/50 cursor-pointer flex gap-4 items-center">
                                  <div className="w-12 h-16 bg-slate-200 dark:bg-slate-700 rounded overflow-hidden shrink-0 shadow-inner flex items-center justify-center">
                                      {book.coverUrl ? ( <img src={book.coverUrl} className="w-full h-full object-cover" /> ) : ( <BookOpen className="text-slate-400" size={20} /> )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <h3 className="font-bold text-slate-900 dark:text-slate-100 truncate">{book.title}</h3>
                                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{book.author}</p>
                                      {book.progress && (
                                          <div className="flex items-center gap-2 mt-1">
                                              <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                  <div className="h-full bg-blue-500" style={{ width: `${Math.round((book.progress.percentage || 0) * 100)}%` }}></div>
                                              </div>
                                              <span className="text-xs text-slate-400">{Math.round((book.progress.percentage || 0) * 100)}%</span>
                                          </div>
                                      )}
                                  </div>
                                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                       <button onClick={(e) => exportMarkdown(e, book)} className="p-2 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg" title={t.exportNotes}>
                                           <Icon name="file-export" />
                                       </button>
                                       <button onClick={(e) => deleteBook(book.id, e)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg" title="Delete">
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
                                            onClick={(e) => exportMarkdown(e, book)}
                                            className="p-2 bg-white/90 dark:bg-slate-800/90 text-blue-500 rounded-full shadow-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 backdrop-blur-sm"
                                        >
                                            <Icon name="file-export" className="text-xs" />
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

            {/* Global Settings Sidebar */}
            {state.isSettingsOpen && (
                <div className="fixed inset-0 z-50 overflow-hidden">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity" onClick={onToggleSettings}></div>
                    <div className="absolute inset-y-0 right-0 w-80 max-w-full bg-white dark:bg-slate-800 shadow-2xl flex flex-col animate-slide-in-right transform transition-transform">
                        <div className="p-5 bg-slate-50 dark:bg-slate-900 flex justify-between items-center font-bold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 shrink-0">
                            <span className="flex items-center gap-2"><Settings size={18} /> {t.settings}</span>
                            <button onClick={onToggleSettings} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><Icon name="times"/></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-6">
                             
                             {/* General */}
                             <div className="space-y-4">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">General</h4>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{t.language}</label>
                                    <select className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.language} onChange={(e) => updateSetting('language', e.target.value as any)}>
                                        <option value="zh">中文</option>
                                        <option value="en">English</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{t.theme}</label>
                                    <select className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value as any)}>
                                        <option value="light">{t.light}</option>
                                        <option value="dark">{t.dark}</option>
                                        <option value="sepia">{t.sepia}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">Dictionary Language</label>
                                    <select className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.dictionaryLanguage || 'en'} onChange={(e) => updateSetting('dictionaryLanguage', e.target.value)}>
                                        <option value="en">English</option>
                                        <option value="zh">Chinese</option>
                                        <option value="ja">Japanese</option>
                                        <option value="es">Spanish</option>
                                        <option value="fr">French</option>
                                        <option value="ru">Russian</option>
                                    </select>
                                </div>
                             </div>

                             {/* Reading */}
                             <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Reading</h4>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{t.layout}</label>
                                    <select className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.layoutMode} onChange={(e) => updateSetting('layoutMode', e.target.value)}>
                                        <option value="single">{t.singlePage}</option>
                                        <option value="double">{t.doublePage}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{t.pageDirection}</label>
                                    <select className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.pageDirection} onChange={(e) => updateSetting('pageDirection', e.target.value)}>
                                        <option value="ltr">{t.ltr}</option>
                                        <option value="rtl">{t.rtl}</option>
                                    </select>
                                </div>
                                <div>
                                     <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{t.dictionaryMode}</label>
                                     <select className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.dictionaryMode || 'panel'} onChange={(e) => updateSetting('dictionaryMode', e.target.value)}>
                                         <option value="modal">{t.modalMode}</option>
                                         <option value="panel">{t.panelMode}</option>
                                     </select>
                                 </div>
                             </div>

                             {/* Audio & TTS */}
                             <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Audio & TTS</h4>
                                <label className="flex items-center space-x-3 cursor-pointer p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                    <input type="checkbox" checked={tempSettings.ttsEnabled} onChange={e => updateSetting('ttsEnabled', e.target.checked)} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.enableTTS}</span>
                                </label>
                                {tempSettings.ttsEnabled && (
                                     <div>
                                         <label className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">{t.voice}</label>
                                         <select 
                                             className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
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
                                     </div>
                                )}
                                <label className="flex items-center space-x-3 cursor-pointer p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                    <input type="checkbox" checked={tempSettings.autoPlayAudio} onChange={e => updateSetting('autoPlayAudio', e.target.checked)} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.autoPlay}</span>
                                </label>
                             </div>

                             {/* Integrations (Anki) */}
                             {tempAnki && setTempAnki && (
                                 <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Anki Integration</h4>
                                    <div className="flex gap-2">
                                        <input className="flex-1 p-2.5 border rounded-lg dark:bg-slate-800 dark:border-slate-700 text-sm" placeholder={t.host} value={tempAnki.host} onChange={e => {
                                           const v = { ...tempAnki, host: e.target.value };
                                           setTempAnki(v);
                                           if (controller && controller.current) controller.current.ankiSettings = v;
                                        }}/>
                                        <input className="w-20 p-2.5 border rounded-lg dark:bg-slate-800 dark:border-slate-700 text-sm" type="number" placeholder={t.port} value={tempAnki.port} onChange={e => {
                                           const v = { ...tempAnki, port: parseInt(e.target.value) };
                                           setTempAnki(v);
                                           if (controller && controller.current) controller.current.ankiSettings = v;
                                        }}/>
                                    </div>
                                    <button className="w-full py-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm font-medium" onClick={() => controller?.current?.testAnki()}>{t.testConnection}</button>
                                 </div>
                             )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
