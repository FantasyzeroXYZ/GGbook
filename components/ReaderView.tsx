
import React, { useState, useEffect, useRef } from 'react';
import { ReaderState, AppSettings, NavigationItem, Bookmark, AnkiSettings, DictionaryResponse } from '../types';
import { Icon } from './Icon';
import { translations } from '../lib/locales';
import { BookmarkEditor } from './BookmarkEditor';
import DictionaryPanel from './DictionaryPanel';
import { Highlighter, Edit3 } from 'lucide-react';

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
    const handleAddToAnki = async (overrideTerm?: string, overrideDef?: string, overrideSentence?: string, scriptDef?: string) => {
         setIsAnkiAdding(true);
         let def = overrideDef || "";
         const term = overrideTerm || state.selectedText;
         const sent = overrideSentence || state.selectedSentence || term;

         if (!def) {
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

         try {
             await controller.current?.addToAnki(term, def, sent);
             setState(s => ({...s, toastMessage: t.addedToAnki, dictionaryModalVisible: false}));
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

          {/* 设置侧边栏 */}
          <div className={`fixed inset-y-0 right-0 w-80 max-w-full bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-50 ${state.isSettingsOpen ? 'translate-x-0' : 'translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold text-gray-800 dark:text-gray-100">
                   <span>{t.settings}</span>
                   <button onClick={() => setState(s => ({ ...s, isSettingsOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="p-4 overflow-y-auto h-full pb-20 space-y-4 text-gray-800 dark:text-gray-200">
                   {/* 外观设置 */}
                   <details className="group">
                       <summary className="font-bold text-gray-500 uppercase text-xs border-b pb-1 cursor-pointer list-none flex justify-between items-center px-2">
                           {t.appearance}
                           <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-[10px]" /></span>
                       </summary>
                       <div className="space-y-3 pt-3 pl-4">
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t.language}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.language} onChange={(e) => updateSetting('language', e.target.value)}>
                                   <option value="zh">中文</option>
                                   <option value="en">English</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t.layout}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.layoutMode} onChange={(e) => updateSetting('layoutMode', e.target.value)}>
                                   <option value="single">{t.singlePage}</option>
                                   <option value="double">{t.doublePage}</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t.pageDirection}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.pageDirection} onChange={(e) => updateSetting('pageDirection', e.target.value)}>
                                   <option value="ltr">{t.ltr}</option>
                                   <option value="rtl">{t.rtl}</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t.theme}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value)}>
                                   <option value="light">{t.light}</option>
                                   <option value="dark">{t.dark}</option>
                                   <option value="sepia">{t.sepia}</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t.dictionaryMode}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.dictionaryMode || 'panel'} onChange={(e) => updateSetting('dictionaryMode', e.target.value)}>
                                   <option value="modal">{t.modalMode}</option>
                                   <option value="panel">{t.panelMode}</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">Dictionary Language</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.dictionaryLanguage || 'en'} onChange={(e) => updateSetting('dictionaryLanguage', e.target.value)}>
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
                   
                   {/* TTS Settings */}
                   <details className="group">
                       <summary className="font-bold text-gray-500 uppercase text-xs border-b pb-1 cursor-pointer list-none flex justify-between items-center px-2">
                           {t.tts}
                           <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-[10px]" /></span>
                       </summary>
                       <div className="space-y-3 pt-3 pl-4">
                           <label className="flex items-center space-x-2 cursor-pointer">
                               <input type="checkbox" checked={tempSettings.ttsEnabled} onChange={e => updateSetting('ttsEnabled', e.target.checked)} className="rounded text-blue-500" />
                               <span className="text-sm">{t.enableTTS}</span>
                           </label>
                           
                           {tempSettings.ttsEnabled && (
                               <>
                                   <div>
                                       <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t.voice}</label>
                                       <select 
                                           className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" 
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
                                   <button 
                                       className="w-full py-2 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors text-sm" 
                                       onClick={() => controller.current?.testTTS()}
                                   >
                                       {t.testVoice}
                                   </button>
                               </>
                           )}
                       </div>
                   </details>

                   {/* Audio Settings */}
                   <details className="group">
                       <summary className="font-bold text-gray-500 uppercase text-xs border-b pb-1 cursor-pointer list-none flex justify-between items-center px-2">
                           {t.audio}
                           <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-[10px]" /></span>
                       </summary>
                       <div className="space-y-3 pt-3 pl-4">
                           <label className="flex items-center space-x-2 cursor-pointer">
                               <input type="checkbox" checked={tempSettings.autoPlayAudio} onChange={e => updateSetting('autoPlayAudio', e.target.checked)} className="rounded text-blue-500" />
                               <span className="text-sm">{t.autoPlay}</span>
                           </label>
                           <label className="flex items-center space-x-2 cursor-pointer">
                               <input type="checkbox" checked={tempSettings.syncTextHighlight} onChange={e => updateSetting('syncTextHighlight', e.target.checked)} className="rounded text-blue-500" />
                               <span className="text-sm">{t.syncHighlight}</span>
                           </label>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t.volume}</label>
                               <input type="range" min="0" max="100" value={tempSettings.audioVolume} onChange={e => updateSetting('audioVolume', parseInt(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"/>
                           </div>
                       </div>
                   </details>

                   {/* Anki Settings */}
                   <details className="group">
                       <summary className="font-bold text-gray-500 uppercase text-xs border-b pb-1 cursor-pointer list-none flex justify-between items-center px-2">
                           {t.ankiConnect}
                           <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-[10px]" /></span>
                       </summary>
                       <div className="space-y-3 text-sm pt-3 pl-4">
                           <div className="flex gap-2">
                               <input className="w-2/3 p-2 border rounded dark:bg-gray-700 dark:border-gray-600" placeholder={t.host} value={tempAnki.host} onChange={e => {
                                   const v = { ...tempAnki, host: e.target.value };
                                   setTempAnki(v);
                                   if (controller.current) controller.current.ankiSettings = v;
                               }}/>
                               <input className="w-1/3 p-2 border rounded dark:bg-gray-700 dark:border-gray-600" type="number" placeholder={t.port} value={tempAnki.port} onChange={e => {
                                   const v = { ...tempAnki, port: parseInt(e.target.value) };
                                   setTempAnki(v);
                                   if (controller.current) controller.current.ankiSettings = v;
                               }}/>
                           </div>
                           <button className="w-full py-2 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors" onClick={() => controller.current?.testAnki()}>{t.testConnection}</button>
                           {state.ankiConnected && (
                               <>
                                   <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempAnki.deck} onChange={e => {
                                       const v = { ...tempAnki, deck: e.target.value };
                                       setTempAnki(v);
                                       if (controller.current) controller.current.ankiSettings = v;
                                   }}>
                                       <option value="">{t.selectDeck}</option>
                                       {state.ankiDecks.map(d => <option key={d} value={d}>{d}</option>)}
                                   </select>
                                   <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempAnki.model} onChange={e => {
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
                                   {['Word', 'Meaning', 'Sentence', 'Audio'].map(f => (
                                       <select key={f} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" 
                                         value={(tempAnki as any)[`${f.toLowerCase()}Field`]} 
                                         onChange={e => {
                                            const v = { ...tempAnki, [`${f.toLowerCase()}Field`]: e.target.value };
                                            setTempAnki(v);
                                            if (controller.current) controller.current.ankiSettings = v;
                                       }}>
                                           <option value="">{f === 'Audio' ? t.audioField : (t as any)[`${f.toLowerCase()}Field`]}</option>
                                           {state.ankiFields.map(field => <option key={field} value={field}>{field}</option>)}
                                       </select>
                                   ))}
                                   <button className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors" onClick={() => controller.current?.saveAnkiSettings()}>{t.saveAnkiSettings}</button>
                               </>
                           )}
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

      {/* 底部 / 音频播放器 */}
      {(state.hasAudio || (tempSettings.ttsEnabled && !state.hasAudio)) && (
          <div className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 p-0.5 flex items-center justify-center z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] h-16 md:h-11 shrink-0 relative transition-colors duration-300 w-full overflow-hidden">
               <div className="w-full flex items-center gap-2 md:gap-4 px-2 md:px-4 max-w-full overflow-hidden">
                   {state.hasAudio && (
                       <button className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 shrink-0" onClick={() => controller.current?.toggleAudioList()}><Icon name="list" className="text-xs md:text-sm"/></button>
                   )}
                   {state.hasAudio && (
                       <button className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 shrink-0" onClick={() => controller.current?.playPrevSentence()}><Icon name="step-backward" className="text-xs md:text-sm"/></button>
                   )}
                   <button className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center shadow-lg shrink-0" onClick={() => controller.current?.toggleAudio()}>
                       <Icon name={state.isAudioPlaying ? "pause" : "play"} className="text-xs md:text-sm"/>
                   </button>
                   {state.hasAudio && (
                       <button className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 shrink-0" onClick={() => controller.current?.playNextSentence()}><Icon name="step-forward" className="text-xs md:text-sm"/></button>
                   )}
                   
                   <div className="flex flex-col flex-1 min-w-0 mx-1 md:mx-2 overflow-hidden justify-center">
                       <span className="text-[10px] md:text-[11px] truncate text-gray-800 dark:text-gray-200 text-center w-full font-medium leading-none mb-0.5">{state.audioTitle || 'No Audio'}</span>
                       {state.hasAudio && (
                           <div className="flex items-center gap-1 md:gap-2 text-[8px] md:text-[9px] text-gray-500 dark:text-gray-400 w-full">
                               <span className="w-7 md:w-8 text-right shrink-0">{Math.floor(state.audioCurrentTime/60)}:{Math.floor(state.audioCurrentTime%60).toString().padStart(2,'0')}</span>
                               <input 
                                 type="range" 
                                 min="0" 
                                 max={state.audioDuration || 100} 
                                 value={state.audioCurrentTime} 
                                 onChange={e => controller.current?.seekAudio(parseFloat(e.target.value))} 
                                 className="flex-1 h-0.5 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer min-w-0"
                               />
                               <span className="w-7 md:w-8 shrink-0 text-left">{Math.floor(state.audioDuration/60)}:{Math.floor(state.audioDuration%60).toString().padStart(2,'0')}</span>
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
              
              <button 
                className={`p-2 rounded transition-colors ${isAnkiAdding ? 'bg-gray-600 cursor-not-allowed' : 'hover:bg-gray-700'}`}
                title={t.addToAnki} 
                disabled={isAnkiAdding}
                onClick={async (e) => {
                    e.stopPropagation();
                    await handleAddToAnki();
                }}
              >
                  {isAnkiAdding ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="plus-square" />}
              </button>
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
                            onClick={() => handleAddToAnki()}
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
              onAddToAnki={(word, def, sent, scriptDef) => handleAddToAnki(word, def, sent, scriptDef)}
              isAddingToAnki={isAnkiAdding}
              canAppend={false} // Feature not fully wired in original
              onAppendNext={() => {}}
              lang={tempSettings.language || 'zh'}
              searchEngine='google'
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
