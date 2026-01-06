
import React, { useState } from 'react';
import { LibraryBook, ReaderState, AppSettings, AnkiSettings } from '../types';
import { Icon } from './Icon';
import { translations } from '../lib/locales';
import { LayoutGrid, List as ListIcon, Trash2, Import, Settings, Moon, Sun, BookOpen, Clock, FileText } from 'lucide-react';

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
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t.library}</h2>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-white dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700 shadow-sm">
                             <button 
                                onClick={() => updateSetting('libraryLayout', 'grid')} 
                                className={`p-2 rounded transition-all ${tempSettings.libraryLayout === 'grid' ? 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                title={t.gridView}
                            >
                                <LayoutGrid size={18} />
                             </button>
                             <button 
                                onClick={() => updateSetting('libraryLayout', 'list')} 
                                className={`p-2 rounded transition-all ${tempSettings.libraryLayout === 'list' ? 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
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
                                       <button onClick={(e) => exportMarkdown(e, book)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-full transition-colors" title={t.exportNotes}>
                                           <FileText size={18} />
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
                                            onClick={(e) => exportMarkdown(e, book)}
                                            className="p-2 bg-white/90 dark:bg-slate-800/90 text-blue-500 rounded-full shadow-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 backdrop-blur-sm"
                                        >
                                            <FileText size={16} />
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

            {/* Global Settings Sidebar - Accordion Style */}
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
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.language} onChange={(e) => updateSetting('language', e.target.value as any)}>
                                            <option value="zh">中文</option>
                                            <option value="en">English</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.theme}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value as any)}>
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
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.fontSize} onChange={(e) => updateSetting('fontSize', e.target.value)}>
                                            <option value="small">{t.small}</option>
                                            <option value="medium">{t.medium}</option>
                                            <option value="large">{t.large}</option>
                                            <option value="xlarge">{t.xlarge}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.layout}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.layoutMode} onChange={(e) => updateSetting('layoutMode', e.target.value)}>
                                            <option value="single">{t.singlePage}</option>
                                            <option value="double">{t.doublePage}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.pageDirection}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.pageDirection} onChange={(e) => updateSetting('pageDirection', e.target.value)}>
                                            <option value="ltr">{t.ltr}</option>
                                            <option value="rtl">{t.rtl}</option>
                                        </select>
                                    </div>
                                    <div>
                                         <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.dictionaryMode}</label>
                                         <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.dictionaryMode || 'panel'} onChange={(e) => updateSetting('dictionaryMode', e.target.value)}>
                                             <option value="modal">{t.modalMode}</option>
                                             <option value="panel">{t.panelMode}</option>
                                         </select>
                                     </div>
                                     <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.dictionaryLang}</label>
                                        <select className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.dictionaryLanguage || 'en'} onChange={(e) => updateSetting('dictionaryLanguage', e.target.value)}>
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
                                                 className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
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
                                    <div>
                                        <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.volume}</label>
                                        <input type="range" min="0" max="100" value={tempSettings.audioVolume} onChange={e => updateSetting('audioVolume', parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer dark:bg-slate-700"/>
                                    </div>
                                </div>
                             </details>

                             {/* Integrations (Anki) */}
                             {tempAnki && setTempAnki && (
                                 <details className="group border border-slate-200 dark:border-slate-700 rounded-lg open:bg-slate-50 dark:open:bg-slate-800/50">
                                    <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg">
                                        <span>{t.settingsCategories.anki}</span>
                                        <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                                    </summary>
                                    <div className="p-3 pt-0 space-y-3 border-t border-slate-100 dark:border-slate-700 mt-2">
                                        <div className="flex gap-2">
                                            <input className="flex-1 p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm" placeholder={t.host} value={tempAnki.host} onChange={e => {
                                               const v = { ...tempAnki, host: e.target.value };
                                               setTempAnki(v);
                                               if (controller && controller.current) controller.current.ankiSettings = v;
                                            }}/>
                                            <input className="w-20 p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm" type="number" placeholder={t.port} value={tempAnki.port} onChange={e => {
                                               const v = { ...tempAnki, port: parseInt(e.target.value) };
                                               setTempAnki(v);
                                               if (controller && controller.current) controller.current.ankiSettings = v;
                                            }}/>
                                        </div>
                                        <button className="w-full py-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm font-medium" onClick={() => controller?.current?.testAnki()}>{t.testConnection}</button>
                                        {state.ankiConnected && (
                                           <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                                                <select className="w-full p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm" value={tempAnki.deck} onChange={e => {
                                                   const v = { ...tempAnki, deck: e.target.value };
                                                   setTempAnki(v);
                                                   if (controller.current) controller.current.ankiSettings = v;
                                                }}>
                                                   <option value="">{t.selectDeck}</option>
                                                   {state.ankiDecks.map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                                
                                                <select className="w-full p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-sm" value={tempAnki.model} onChange={e => {
                                                   const v = { ...tempAnki, model: e.target.value };
                                                   setTempAnki(v);
                                                   if (controller.current) {
                                                       controller.current.ankiSettings = v;
                                                       controller.current.loadAnkiFields(e.target.value);
                                                   }
                                                }}>
                                                   <option value="">{t.selectModel}</option>
                                                   {state.ankiModels.map(m => <option key={m} value={m}>{m}</option>)}
                                                </select>
                                           </div>
                                        )}
                                    </div>
                                 </details>
                             )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
