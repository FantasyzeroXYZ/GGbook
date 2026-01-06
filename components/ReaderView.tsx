
import React, { useState, useEffect, useRef } from 'react';
import { ReaderState, AppSettings, NavigationItem, Bookmark, AnkiSettings, DictionaryResponse } from '../types';
import { Icon } from './Icon';
import { translations } from '../lib/locales';
import { BookmarkEditor } from './BookmarkEditor';
import DictionaryPanel from './DictionaryPanel';
import { Highlighter, Edit3, Settings, Quote, Scissors } from 'lucide-react';

type SidebarTab = 'toc' | 'bookmarks' | 'notes';
type DictionaryTab = 'api' | 'script' | 'web'; // Added 'web'

interface ReaderViewProps {
    state: ReaderState;
    tempSettings: AppSettings;
    tempAnki: AnkiSettings;
    exitReader: () => void;
    setState: React.Dispatch<React.SetStateAction<ReaderState>>;
    updateSetting: (key: keyof AppSettings, val: any) => void;
    setTempAnki: React.Dispatch<React.SetStateAction<AnkiSettings>>;
    handleAddBookmark: () => void;
    controller: any; // Using any to avoid circular type ref hell in this refactor, but essentially EpubController
    viewerRef: React.RefObject<HTMLDivElement>;
    isAnkiAdding: boolean;
    setIsAnkiAdding: React.Dispatch<React.SetStateAction<boolean>>;
    formatDefinition: (data: any) => string;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
    state,
    tempSettings,
    tempAnki,
    exitReader,
    setState,
    updateSetting,
    setTempAnki,
    handleAddBookmark,
    controller,
    viewerRef,
    isAnkiAdding,
    setIsAnkiAdding,
    formatDefinition
}) => {
    const [sidebarTab, setSidebarTab] = useState<SidebarTab>('toc');
    const [dictTab, setDictTab] = useState<DictionaryTab>('api');
    const [manualSearchTerm, setManualSearchTerm] = useState('');
    const scriptModalRef = useRef<HTMLDivElement>(null);

    const t = translations[tempSettings.language || 'zh'];

    const renderTOC = (items: NavigationItem[], level = 0) => {
        return items.map((item, idx) => (
            <div key={idx}>
                <div 
                  className={`p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 truncate text-gray-800 dark:text-gray-200`}
                  style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
                  onClick={() => {
                      controller.current?.display(item.href);
                      setState(s => ({ ...s, isSidebarOpen: false }));
                  }}
                >
                    {item.label}
                </div>
                {item.subitems && renderTOC(item.subitems, level + 1)}
            </div>
        ));
    };
  
    const renderBookmarksList = (type: 'bookmark' | 'highlight') => {
        const filtered = state.bookmarks.filter(b => b.type === type);
        
        if (filtered.length === 0) {
            return <div className="p-4 text-gray-500">{type === 'bookmark' ? t.noBookmarks : t.noNotes}</div>;
        }

        // Sort: Latest first
        const sortedBookmarks = [...filtered].sort((a,b) => b.createdAt - a.createdAt);

        return sortedBookmarks.map((bm) => (
            <div key={bm.id} className="p-3 border-b dark:border-gray-700 flex justify-between items-start hover:bg-gray-100 dark:hover:bg-gray-700">
                <div 
                    className="cursor-pointer flex-1 text-gray-800 dark:text-gray-200 flex flex-col gap-1" 
                    onClick={() => {
                        controller.current?.restoreBookmark(bm);
                        setState(s => ({ ...s, isSidebarOpen: false }));
                    }}
                >
                    <div className="flex items-center gap-2">
                         {bm.type === 'highlight' ? (
                            <div className="w-3 h-3 rounded-full shrink-0 border border-gray-300 dark:border-gray-600 shadow-sm" style={{backgroundColor: bm.color || '#FFEB3B'}}></div>
                         ) : (
                            <Icon name="bookmark" className="text-blue-500 text-xs" />
                         )}
                         <span className="text-xs text-gray-400 font-mono">
                            {bm.type === 'highlight' ? new Date(bm.createdAt).toLocaleDateString() : t.pageBookmark}
                         </span>
                    </div>
                    
                    {bm.text && (
                        <div className="text-sm font-serif line-clamp-3 border-l-2 pl-2 border-gray-300 dark:border-gray-600 italic opacity-80 my-1">
                            {bm.text}
                        </div>
                    )}
                    
                    <div className="text-xs text-gray-500 font-medium">
                        {bm.label}
                    </div>

                    {bm.note && <div className="text-xs text-gray-600 dark:text-gray-400 truncate pl-2 mt-1 bg-gray-50 dark:bg-gray-800 p-1.5 rounded border dark:border-gray-600"><Icon name="sticky-note" className="mr-1"/>{bm.note}</div>}
                    {bm.audioSrc && <span className="text-xs text-blue-500 pl-2"><Icon name="volume-up"/> Audio saved</span>}
                </div>
                <div className="flex flex-col gap-1 ml-2">
                    <button 
                        onClick={() => setState(s => ({ ...s, editingBookmarkId: bm.id }))}
                        className="text-gray-400 hover:text-blue-500 p-1.5"
                        title={t.editBookmark}
                    >
                        <Icon name="pen" className="text-xs" />
                    </button>
                    <button onClick={() => controller.current?.removeBookmark(bm.id)} className="text-red-400 hover:text-red-700 p-1.5">
                        <Icon name="trash" className="text-xs" />
                    </button>
                </div>
            </div>
        ));
    };

    const renderDictionaryContent = () => (
        <div className="text-gray-800 dark:text-gray-200 h-full flex flex-col">
             {dictTab === 'api' ? (
               <div className="overflow-y-auto">
                   {state.dictionaryLoading && <div className="text-center py-4"><div className="loader inline-block border-2 border-t-blue-500 w-6 h-6 rounded-full animate-spin-custom"></div> {t.loading}</div>}
                   {state.dictionaryError && <div className="text-red-500 text-center py-4">{state.dictionaryError}</div>}
                   {state.dictionaryData && !state.dictionaryLoading && (
                       <div>
                           <div className="flex items-baseline gap-2 mb-2">
                               <h2 className="text-2xl font-bold text-blue-600">{state.dictionaryData.word}</h2>
                           </div>
                            {state.dictionaryData.entries.map((entry: any, k: number) => (
                                <div key={k} className="mb-6">
                                     <div className="flex items-center gap-2 mb-2">
                                         <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-semibold px-2 py-0.5 rounded">{entry.partOfSpeech}</span>
                                         {entry.phonetic && <span className="text-gray-500 italic">[{entry.phonetic}]</span>}
                                     </div>
                                     <ol className="list-decimal pl-5 space-y-3">
                                        {entry.senses.map((sense: any, m: number) => (
                                            <li key={m} className="text-sm">
                                                <div className="text-gray-800 dark:text-gray-200 leading-relaxed">{sense.definition}</div>
                                                {sense.examples && sense.examples.length > 0 && (
                                                    <ul className="list-disc pl-4 mt-1">
                                                        {sense.examples.slice(0, 2).map((ex: string, n: number) => (
                                                             <li key={n} className="text-gray-500 italic text-xs">"{ex}"</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </li>
                                        ))}
                                     </ol>
                                </div>
                            ))}
                       </div>
                   )}
               </div>
             ) : dictTab === 'script' ? (
                 <div className="flex-1 overflow-y-auto flex flex-col">
                    {/* Script Tab Content */}
                    {state.scriptTabLoading && (
                        <div className="text-center py-4">
                            <div className="loader inline-block border-2 border-t-blue-500 w-6 h-6 rounded-full animate-spin-custom mb-2"></div>
                            <p className="text-sm text-gray-500">{t.waitingForScript}</p>
                        </div>
                    )}
                    {state.scriptTabError && (
                        <div className="text-red-500 text-center py-4">
                            {state.scriptTabError}
                            <p className="text-xs text-gray-400 mt-2">{t.scriptNotInstalled}</p>
                        </div>
                    )}
                    {state.scriptTabContent ? (
                        <div 
                           ref={scriptModalRef}
                           className="script-content-container"
                           dangerouslySetInnerHTML={{ __html: state.scriptTabContent }} 
                        />
                    ) : (
                         !state.scriptTabLoading && !state.scriptTabError && <div className="text-center text-gray-500 py-4">{t.noContent}</div>
                    )}
                 </div>
             ) : (
                <div className="w-full h-full flex flex-col bg-white">
                    <iframe 
                        src={`https://www.google.com/search?igu=1&q=${encodeURIComponent(state.selectedText)}`} 
                        className="w-full flex-1 border-0" 
                        sandbox="allow-forms allow-scripts allow-same-origin" 
                    />
                </div>
             )}
        </div>
    );
    
    // Add to Anki logic shared
    const handleAddToAnki = async (overrideTerm?: string, overrideDef?: string, overrideSentence?: string, scriptDef?: string, type: 'vocab' | 'excerpt' | 'cloze' = 'vocab') => {
         setIsAnkiAdding(true);
         let def = overrideDef || "";
         const term = overrideTerm || state.selectedText;
         const sent = overrideSentence || state.selectedSentence || term;

         if (!def && type === 'vocab') {
             if (dictTab === 'api' && state.dictionaryData) {
                 // Reuse logic from DictionaryPanel format
                 const d = state.dictionaryData;
                 let html = `<div><b>${d.word}</b></div>`;
                 d.entries.forEach((e: any) => {
                     html += `<div><i>${e.partOfSpeech}</i></div><ol>`;
                     e.senses.forEach((s: any) => {
                         html += `<li>${s.definition}</li>`;
                     });
                     html += `</ol>`;
                 });
                 def = html;
             } else if (dictTab === 'script') {
                 // Try to get innerHTML from ref if script content is loaded
                 if (scriptModalRef.current) {
                     def = scriptModalRef.current.innerHTML;
                 } else if (state.scriptTabContent) {
                     def = state.scriptTabContent;
                 }
             }
         }
         
         // Use passed scriptDef if available (from Panel)
         if (scriptDef) def = scriptDef;

         const noteData = {
             title: state.currentBook?.title || 'Unknown',
             author: state.currentBook?.author || 'Unknown',
             note: '' // Optional logic to prompt for note?
         };

         try {
             await controller.current?.addToAnki(term, def, sent, type, noteData);
             setState(s => ({...s, toastMessage: type === 'excerpt' ? t.addedExcerpt : (type === 'cloze' ? t.addedCloze : t.addedToAnki), dictionaryModalVisible: false}));
             setTimeout(() => setState(s => ({...s, toastMessage: null})), 2000);
         } catch(e: any) {
             alert(t.failed + ': ' + e.message);
         } finally {
             setIsAnkiAdding(false);
         }
    };
    
    // Manual search handler
    const handleManualSearch = () => {
        if (!manualSearchTerm.trim()) return;
        controller.current?.lookupWord(manualSearchTerm.trim());
    };

    return (
    <div 
        className={`h-[100dvh] flex flex-col overflow-hidden ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-800'}`}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
            if (state.selectionToolbarVisible) {
                setTimeout(() => {
                    const sel = window.getSelection();
                    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
                        setState(s => ({ ...s, selectionToolbarVisible: false, selectionRect: null }));
                    }
                }, 50);
            }
        }}
    >
      
      {/* 顶部导航 */}
      <div className="flex justify-between items-center p-3 bg-gray-800 text-white shadow-md z-30 h-14 shrink-0 transition-colors duration-300">
        <div className="flex gap-4">
            <button onClick={exitReader} className="hover:text-gray-300" title="返回书架"><Icon name="arrow-left"/></button>
            <div className="h-6 w-px bg-gray-600 mx-2"></div>
            <button onClick={() => setState(s => ({ ...s, isSidebarOpen: !s.isSidebarOpen }))}><Icon name="bars"/></button>
            <button onClick={() => setState(s => ({ ...s, isSettingsOpen: !s.isSettingsOpen }))}><Icon name="cog"/></button>
        </div>
        <div className="flex gap-2">
            <button onClick={handleAddBookmark} className="hover:text-gray-300" title={t.addBookmark}>
                <Icon name="bookmark" />
            </button>
            <div className="w-px bg-gray-600 h-6 mx-2"></div>
            <button onClick={() => updateSetting('darkMode', !state.isDarkMode)}>
                <Icon name={state.isDarkMode ? 'sun' : 'moon'}/>
            </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden flex">
          {/* 覆盖层 */}
          {(state.isSidebarOpen || state.isSettingsOpen || (state.dictionaryModalVisible && tempSettings.dictionaryMode === 'panel')) && (
              <div 
                  className="absolute inset-0 z-40 bg-black/20"
                  onClick={() => setState(s => ({ ...s, isSidebarOpen: false, isSettingsOpen: false, dictionaryModalVisible: false }))}
              ></div>
          )}

          {/* 侧边栏 (目录/书签) */}
          <div className={`fixed inset-y-0 left-0 w-80 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-50 ${state.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col`}>
               <div className="flex border-b dark:border-gray-700 overflow-x-auto no-scrollbar">
                   <button 
                       className={`flex-1 min-w-[33%] p-3 font-bold text-sm ${sidebarTab === 'toc' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-600 dark:text-gray-400'}`}
                       onClick={() => setSidebarTab('toc')}
                   >
                       {t.tableOfContents}
                   </button>
                   <button 
                       className={`flex-1 min-w-[33%] p-3 font-bold text-sm ${sidebarTab === 'bookmarks' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-600 dark:text-gray-400'}`}
                       onClick={() => setSidebarTab('bookmarks')}
                   >
                       {t.bookmarks}
                   </button>
                   <button 
                       className={`flex-1 min-w-[33%] p-3 font-bold text-sm ${sidebarTab === 'notes' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-600 dark:text-gray-400'}`}
                       onClick={() => setSidebarTab('notes')}
                   >
                       {t.notes}
                   </button>
               </div>
               <div className="overflow-y-auto flex-1 pb-20">
                   {sidebarTab === 'toc' && (
                       state.navigationMap.length > 0 ? renderTOC(state.navigationMap) : <div className="p-4 text-gray-500">{t.noTOC}</div>
                   )}
                   {sidebarTab === 'bookmarks' && renderBookmarksList('bookmark')}
                   {sidebarTab === 'notes' && renderBookmarksList('highlight')}
               </div>
               <button onClick={() => setState(s => ({ ...s, isSidebarOpen: false }))} className="absolute top-2 right-2 text-gray-500"><Icon name="times"/></button>
          </div>

          {/* 阅读区域 */}
          <div className="flex-1 relative flex flex-col overflow-hidden">
               {state.isLoading && (
                   <div className="flex-1 flex flex-col items-center justify-center">
                       <div className="loader border-4 border-gray-200 border-t-blue-500 rounded-full w-12 h-12 animate-spin-custom mb-4"></div>
                       <p className="text-gray-600 dark:text-gray-300">{state.loadingMessage}</p>
                   </div>
               )}

               <div 
                 id="viewer" 
                 ref={viewerRef} 
                 className={`flex-1 relative bg-white dark:bg-gray-800 ${!state.currentBook ? 'hidden' : ''}`}
               />
               
               {state.currentBook && !state.isLoading && (
                   <>
                       <div className="absolute top-0 bottom-0 left-0 w-8 z-20 cursor-pointer flex items-center justify-start pl-1 hover:bg-black hover:bg-opacity-5 dark:hover:bg-white dark:hover:bg-opacity-5 transition-colors group tap-highlight-transparent" 
                            onClick={() => tempSettings.pageDirection === 'rtl' ? controller.current?.nextPage() : controller.current?.prevPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 group-hover:opacity-50 transition-opacity transform scale-75"><Icon name="chevron-left"/></div>
                       </div>
                       <div className="absolute top-0 bottom-0 right-0 w-8 z-20 cursor-pointer flex items-center justify-end pr-1 hover:bg-black hover:bg-opacity-5 dark:hover:bg-white dark:hover:bg-opacity-5 transition-colors group tap-highlight-transparent" 
                            onClick={() => tempSettings.pageDirection === 'rtl' ? controller.current?.prevPage() : controller.current?.nextPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 group-hover:opacity-50 transition-opacity transform scale-75"><Icon name="chevron-right"/></div>
                       </div>
                   </>
               )}
          </div>

          {/* Settings Sidebar - Synchronized with LibraryView */}
           <div className={`fixed inset-y-0 right-0 w-80 max-w-full bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-50 ${state.isSettingsOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
               <div className="p-5 bg-gray-50 dark:bg-gray-900 flex justify-between items-center font-bold text-gray-800 dark:text-gray-100 border-b border-gray-100 dark:border-gray-700 shrink-0">
                   <span className="flex items-center gap-2"><Settings size={18} /> {t.settings}</span>
                   <button onClick={() => setState(s => ({ ...s, isSettingsOpen: false }))} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><Icon name="times"/></button>
               </div>
               
               <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-sm text-blue-800 dark:text-blue-200 mb-2">
                        {t.settings}
                    </div>
                    
                    {/* Basic Appearance Settings */}
                    <details className="group border border-gray-200 dark:border-gray-700 rounded-lg open:bg-gray-50 dark:open:bg-gray-800/50" open>
                        <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                            <span>{t.appearance}</span>
                            <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                        </summary>
                         <div className="p-3 pt-0 space-y-3 border-t border-gray-100 dark:border-gray-700 mt-2">
                            <div>
                                <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-slate-400 uppercase">{t.fontSize}</label>
                                <select className="w-full p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.fontSize} onChange={(e) => updateSetting('fontSize', e.target.value)}>
                                    <option value="small">{t.small}</option>
                                    <option value="medium">{t.medium}</option>
                                    <option value="large">{t.large}</option>
                                    <option value="xlarge">{t.xlarge}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-slate-400 uppercase">{t.theme}</label>
                                <select className="w-full p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value as any)}>
                                    <option value="light">{t.light}</option>
                                    <option value="dark">{t.dark}</option>
                                    <option value="sepia">{t.sepia}</option>
                                </select>
                            </div>
                         </div>
                    </details>
                    
                    {/* Reading Settings */}
                    <details className="group border border-gray-200 dark:border-gray-700 rounded-lg open:bg-gray-50 dark:open:bg-gray-800/50">
                        <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                            <span>{t.settingsCategories.reading}</span>
                            <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                        </summary>
                        <div className="p-3 pt-0 space-y-3 border-t border-gray-100 dark:border-gray-700 mt-2">
                            <div>
                                <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-slate-400 uppercase">{t.layout}</label>
                                <select className="w-full p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.layoutMode} onChange={(e) => updateSetting('layoutMode', e.target.value)}>
                                    <option value="single">{t.singlePage}</option>
                                    <option value="double">{t.doublePage}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-slate-400 uppercase">{t.pageDirection}</label>
                                <select className="w-full p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none" value={tempSettings.pageDirection} onChange={(e) => updateSetting('pageDirection', e.target.value)}>
                                    <option value="ltr">{t.ltr}</option>
                                    <option value="rtl">{t.rtl}</option>
                                </select>
                            </div>
                        </div>
                    </details>
                    
                    {/* Audio Settings */}
                    <details className="group border border-gray-200 dark:border-gray-700 rounded-lg open:bg-gray-50 dark:open:bg-gray-800/50">
                        <summary className="flex items-center justify-between p-3 font-semibold text-sm cursor-pointer list-none text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                            <span>{t.settingsCategories.audio}</span>
                            <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-xs opacity-50" /></span>
                        </summary>
                        <div className="p-3 pt-0 space-y-3 border-t border-gray-100 dark:border-gray-700 mt-2">
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
                            <div>
                                <label className="block text-xs font-medium mb-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.volume}</label>
                                <input type="range" min="0" max="100" value={tempSettings.audioVolume} onChange={e => updateSetting('audioVolume', parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer dark:bg-slate-700"/>
                            </div>
                        </div>
                    </details>
               </div>
          </div>
      </div>

      {/* 音频列表弹窗 */}
      {state.showAudioList && state.audioList.length > 0 && (
          <div className="audio-list-popover fixed bottom-24 left-4 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 max-h-64 overflow-y-auto z-50 text-gray-800 dark:text-gray-200">
              <div className="p-3 border-b dark:border-gray-700 font-bold sticky top-0 bg-white dark:bg-gray-800 flex justify-between items-center">
                  <span>{t.audioTracks}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{state.audioList.length} {t.tracks}</span>
              </div>
              <div>
                  {state.audioList.map((file, i) => (
                      <div 
                        key={i} 
                        className={`p-3 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 truncate ${state.audioTitle === file.split('/').pop() ? 'text-blue-500 font-bold bg-blue-50 dark:bg-gray-700' : ''}`}
                        onClick={() => {
                            controller.current?.playAudioFile(file);
                            setState(prev => ({ ...prev, showAudioList: false }));
                        }}
                      >
                          {i + 1}. {file.split('/').pop()}
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* 底部 / 音频播放器 - COMPACT DESIGN */}
      {(state.hasAudio || (tempSettings.ttsEnabled && !state.hasAudio)) && (
          <div className="bg-white dark:bg-gray-900 border-t dark:border-gray-800 p-0 flex items-center justify-center z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] h-12 shrink-0 relative transition-colors duration-300 w-full overflow-hidden">
               <div className="w-full flex items-center gap-3 px-3 max-w-full overflow-hidden">
                   {state.hasAudio && (
                       <button className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400" onClick={() => controller.current?.toggleAudioList()}><Icon name="list" className="text-xs"/></button>
                   )}
                   {state.hasAudio && (
                       <button className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400" onClick={() => controller.current?.playPrevSentence()}><Icon name="step-backward" className="text-xs"/></button>
                   )}
                   <button className="w-8 h-8 rounded-full bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center shadow-md shrink-0" onClick={() => controller.current?.toggleAudio()}>
                       <Icon name={state.isAudioPlaying ? "pause" : "play"} className="text-xs"/>
                   </button>
                   {state.hasAudio && (
                       <button className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400" onClick={() => controller.current?.playNextSentence()}><Icon name="step-forward" className="text-xs"/></button>
                   )}
                   
                   <div className="flex flex-col flex-1 min-w-0 mx-2 justify-center">
                       <span className="text-[10px] truncate text-gray-900 dark:text-gray-100 font-bold leading-tight mb-0.5">{state.audioTitle || 'Ready'}</span>
                       {state.hasAudio && (
                           <div className="flex items-center gap-2 text-[9px] text-gray-500 dark:text-gray-500 w-full">
                               <span className="min-w-[24px] text-right">{Math.floor(state.audioCurrentTime/60)}:{Math.floor(state.audioCurrentTime%60).toString().padStart(2,'0')}</span>
                               <input 
                                 type="range" 
                                 min="0" 
                                 max={state.audioDuration || 100} 
                                 value={state.audioCurrentTime} 
                                 onChange={e => controller.current?.seekAudio(parseFloat(e.target.value))} 
                                 className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer"
                               />
                               <span className="min-w-[24px]">{Math.floor(state.audioDuration/60)}:{Math.floor(state.audioDuration%60).toString().padStart(2,'0')}</span>
                           </div>
                       )}
                   </div>
               </div>
          </div>
      )}

      {state.selectionToolbarVisible && state.selectionRect && (
          <div 
            id="selection-toolbar"
            className="fixed bg-gray-800 text-white rounded-lg shadow-lg p-2 flex gap-2 z-50 animate-bounce-in max-w-[95vw] overflow-x-auto items-center"
            style={{ 
                top: Math.max(10, state.selectionRect.top - 60) + 'px', 
                left: Math.min(window.innerWidth - 220, Math.max(10, state.selectionRect.left + state.selectionRect.width/2 - 120)) + 'px' 
            }}
            onClick={(e) => e.stopPropagation()} 
          >
              <button className="p-2 hover:bg-gray-700 rounded transition-colors" title={t.dictionary} onClick={(e) => { e.stopPropagation(); controller.current?.lookupWord(state.selectedText); }}>
                  <Icon name="book" />
              </button>
              
              <div className="w-px h-6 bg-gray-600 mx-1"></div>

              {/* Single Highlight Button -> Opens Editor immediately */}
              <button 
                  className="p-2 hover:bg-gray-700 rounded transition-colors flex items-center gap-1" 
                  title={t.highlight}
                  onClick={async (e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      
                      if (!state.selectedCfiRange) return;

                      try {
                          // Add highlight with default yellow color first
                          const defaultColor = '#FFEB3B';
                          const newBookmarks = await controller.current?.addHighlight(
                              defaultColor, 
                              state.selectedCfiRange, 
                              state.selectedText
                          );
                          
                          if (newBookmarks && newBookmarks.length > 0) {
                              // Immediately open editor for the new highlight to let user change color/add note
                              const newHighlight = newBookmarks[newBookmarks.length - 1];
                              setState(s => ({ 
                                  ...s, 
                                  bookmarks: newBookmarks,
                                  editingBookmarkId: newHighlight.id, 
                                  selectionToolbarVisible: false,
                                  selectedCfiRange: null, 
                                  selectedText: '',
                                  selectionRect: null
                              }));
                          }
                      } catch (err) {
                          console.error("Highlighting failed:", err);
                      }
                  }}
              >
                  <Highlighter size={16} />
              </button>

              <div className="w-px h-6 bg-gray-600 mx-1"></div>

              <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Copy" onClick={(e) => { e.stopPropagation(); controller.current?.copySelection(); }}>
                  <Icon name="copy" />
              </button>
              
              <div className="w-px h-6 bg-gray-600 mx-1"></div>

              {/* Anki Actions - Expanded */}
              <div className="flex gap-1">
                  <button 
                    className={`p-2 rounded transition-colors ${isAnkiAdding ? 'bg-gray-600 cursor-not-allowed' : 'hover:bg-gray-700'}`}
                    title={t.addToAnki} 
                    disabled={isAnkiAdding}
                    onClick={async (e) => { e.stopPropagation(); await handleAddToAnki(undefined, undefined, undefined, undefined, 'vocab'); }}
                  >
                      {isAnkiAdding ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="plus-square" />}
                  </button>
                  {state.ankiConnected && tempAnki.excerptDeck && (
                      <button 
                        className={`p-2 rounded transition-colors ${isAnkiAdding ? 'bg-gray-600 cursor-not-allowed' : 'hover:bg-gray-700'}`}
                        title={t.addExcerpt}
                        disabled={isAnkiAdding}
                        onClick={async (e) => { e.stopPropagation(); await handleAddToAnki(undefined, undefined, undefined, undefined, 'excerpt'); }}
                      >
                          <Quote size={16} />
                      </button>
                  )}
                  {state.ankiConnected && tempAnki.clozeDeck && (
                      <button 
                        className={`p-2 rounded transition-colors ${isAnkiAdding ? 'bg-gray-600 cursor-not-allowed' : 'hover:bg-gray-700'}`}
                        title={t.addCloze}
                        disabled={isAnkiAdding}
                        onClick={async (e) => { e.stopPropagation(); await handleAddToAnki(undefined, undefined, undefined, undefined, 'cloze'); }}
                      >
                          <Scissors size={16} />
                      </button>
                  )}
              </div>

              <button 
                className="p-2 hover:bg-gray-700 rounded transition-colors" 
                title="Jump Audio" 
                onClick={(e) => {
                    e.stopPropagation();
                    if (state.selectedElementId) {
                        controller.current?.seekToElementId(state.selectedElementId);
                    } else if (tempSettings.ttsEnabled && state.selectedText) {
                        controller.current?.seekToElementId(''); 
                    }
                }}
                disabled={!state.selectedElementId && (!tempSettings.ttsEnabled || !state.selectedText)}
              >
                  <Icon name="crosshairs" className={!state.selectedElementId && (!tempSettings.ttsEnabled || !state.selectedText) ? "opacity-50" : ""} />
              </button>
          </div>
      )}
      
      {/* Toast Notification */}
      {state.toastMessage && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-70 text-white px-4 py-2 rounded-full shadow-lg z-[60] animate-bounce-in">
              {state.toastMessage}
          </div>
      )}

      {/* Dictionary: Center Modal Mode */}
      {state.dictionaryModalVisible && tempSettings.dictionaryMode === 'modal' && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setState(s => ({ ...s, dictionaryModalVisible: false }))}>
              <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-lg shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700 rounded-t-lg">
                      <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100">{t.dictionary}</h3>
                      <button onClick={() => setState(s => ({ ...s, dictionaryModalVisible: false }))} className="text-gray-600 dark:text-gray-300"><Icon name="times"/></button>
                  </div>
                  
                  {/* Tabs */}
                  <div className="flex border-b dark:border-gray-700">
                      <button 
                          className={`flex-1 p-3 font-medium transition-colors ${dictTab === 'api' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          onClick={() => setDictTab('api')}
                      >
                          API
                      </button>
                      <button 
                          className={`flex-1 p-3 font-medium transition-colors ${dictTab === 'script' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          onClick={() => setDictTab('script')}
                      >
                          {t.scriptTab}
                      </button>
                      <button 
                          className={`flex-1 p-3 font-medium transition-colors ${dictTab === 'web' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          onClick={() => setDictTab('web')}
                      >
                          Web
                      </button>
                  </div>

                  <div className="p-6 overflow-y-auto flex-1">
                     {renderDictionaryContent()}
                  </div>

                  {/* Footer */}
                  {((dictTab === 'api' && state.dictionaryData) || (dictTab === 'script' && state.scriptTabContent)) && (
                      <div className="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700 rounded-b-lg flex justify-end">
                          <button 
                            className={`px-4 py-2 rounded text-white flex items-center gap-2 ${state.ankiConnected ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'}`}
                            disabled={!state.ankiConnected || isAnkiAdding}
                            onClick={() => handleAddToAnki(undefined, undefined, undefined, undefined, 'vocab')}
                          >
                              {isAnkiAdding ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="plus"/>}
                              {t.addToAnki}
                          </button>
                      </div>
                  )}
              </div>
          </div>
      )}
      
      {/* Dictionary: Bottom Panel Mode (Using new Component) */}
      {state.dictionaryModalVisible && tempSettings.dictionaryMode === 'panel' && (
          <DictionaryPanel 
              isOpen={state.dictionaryModalVisible}
              onClose={() => setState(s => ({ ...s, dictionaryModalVisible: false }))}
              word={state.selectedText}
              sentence={state.selectedSentence || state.selectedText}
              learningLanguage={tempSettings.dictionaryLanguage || 'en'}
              onAddToAnki={(word, def, sent, scriptDef) => handleAddToAnki(word, def, sent, scriptDef, 'vocab')}
              isAddingToAnki={isAnkiAdding}
              canAppend={true}
              onAppendNext={(newTerm) => {
                  setState(s => ({...s, selectedText: newTerm }));
                  controller.current?.lookupWord(newTerm);
              }}
              lang={tempSettings.language || 'zh'}
              searchEngine='google'
              segmentationMode={tempSettings.segmentationMode || 'browser'}
          />
      )}

      {/* Bookmark Editor Modal */}
      {state.editingBookmarkId && (
          <BookmarkEditor 
             bookmark={state.bookmarks.find(b => b.id === state.editingBookmarkId)!}
             lang={tempSettings.language || 'zh'}
             isDarkMode={state.isDarkMode}
             onCancel={() => setState(s => ({ ...s, editingBookmarkId: null }))}
             onSave={(updates) => {
                 controller.current?.updateBookmark(state.editingBookmarkId!, updates);
                 setState(s => ({ ...s, editingBookmarkId: null }));
             }}
          />
      )}
    </div>
  );
};
