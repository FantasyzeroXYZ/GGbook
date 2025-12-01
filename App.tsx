import React, { useEffect, useRef, useState, useCallback } from 'react';
import { EpubController } from './lib/EpubController';
import { AnkiSettings, AppSettings, Book, Chapter, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState } from './types';

// Icons
const Icon = ({ name }: { name: string }) => <i className={`fas fa-${name}`}></i>;

export default function App() {
  // ===================== State =====================
  // We mirror the internal state of the controller here for reactivity
  const [state, setState] = useState<ReaderState>({
    currentBook: null,
    currentChapterIndex: 0,
    chapters: [],
    navigationMap: [],
    currentSectionIndex: 0,
    sections: [],
    isSidebarOpen: false,
    isSettingsOpen: false,
    isDarkMode: false,
    isLoading: false,
    loadingMessage: '',
    isAudioPlaying: false,
    audioCurrentTime: 0,
    audioDuration: 0,
    audioTitle: '',
    selectionToolbarVisible: false,
    selectionRect: null,
    selectedText: '',
    dictionaryModalVisible: false,
    dictionaryData: null,
    dictionaryLoading: false,
    dictionaryError: null,
    ankiConnected: false,
    ankiDecks: [],
    ankiModels: [],
    ankiFields: []
  });

  // Settings local state (syncs with controller on save)
  const [tempSettings, setTempSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [tempAnki, setTempAnki] = useState<AnkiSettings>(DEFAULT_ANKI_SETTINGS);

  // Controller Ref
  const controller = useRef<EpubController | null>(null);
  const readerContentRef = useRef<HTMLDivElement>(null);

  // ===================== Initialization =====================
  useEffect(() => {
    // Initialize controller only once
    const c = new EpubController(state, (partial) => {
        setState(prev => ({ ...prev, ...partial }));
    });
    controller.current = c;
    
    // Load saved settings into local state
    setTempSettings(c.settings);
    setTempAnki(c.ankiSettings);
    
    // Apply dark mode immediately
    if (c.settings.darkMode) {
        document.body.classList.add('dark');
    }

    // Keyboard listeners
    const handleKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === 'ArrowLeft') c.prevPage();
        if (e.key === 'ArrowRight') c.nextPage();
        if (e.key === ' ') { e.preventDefault(); c.toggleAudio(); }
    };

    // Resize listener for layout refresh
    let resizeTimer: any;
    const handleResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            c.refreshLayout();
        }, 200);
    };

    window.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleResize);
    
    return () => {
        c.stopAudio();
        window.removeEventListener('keydown', handleKey);
        window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update container ref whenever book changes to ensure layout logic has access to DOM
  useEffect(() => {
    if (state.currentBook && readerContentRef.current && controller.current) {
        controller.current.setContainerRef(readerContentRef.current);
        // Refresh layout now that we have the actual DOM container
        controller.current.refreshLayout();
    }
  }, [state.currentBook]);

  // Sync Settings when they change locally
  const updateSetting = (key: keyof AppSettings, val: any) => {
      setTempSettings(prev => ({ ...prev, [key]: val }));
      if (controller.current) {
          // Cast to any to avoid "Type 'any' is not assignable to type 'never'" error
          (controller.current.settings as any)[key] = val;
          controller.current.saveSettings();
          if (key === 'darkMode') {
             document.body.classList.toggle('dark', val);
             setState(s => ({ ...s, isDarkMode: val }));
          }
          if (key === 'audioVolume') {
              controller.current.setVolume(val / 100);
          }
          if (key === 'fontSize' && state.sections.length > 0) {
              // Reload current chapter to re-paginate with new font size
              controller.current.refreshLayout();
          }
      }
  };

  // ===================== Event Handlers =====================
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          controller.current?.loadFile(e.target.files[0]);
      }
  };

  const handleSelection = useCallback(() => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0 && !state.dictionaryModalVisible) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setState(prev => ({
              ...prev,
              selectionToolbarVisible: true,
              selectionRect: rect,
              selectedText: selection.toString().trim()
          }));
      } else {
          // Only hide if not clicking the toolbar
      }
  }, [state.dictionaryModalVisible]);

  // Click away to hide toolbar
  useEffect(() => {
      const listener = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (!target.closest('#selection-toolbar') && !window.getSelection()?.toString()) {
              setState(prev => ({ ...prev, selectionToolbarVisible: false }));
          }
      };
      document.addEventListener('mouseup', listener);
      document.addEventListener('keyup', handleSelection);
      document.addEventListener('mouseup', handleSelection);
      return () => {
          document.removeEventListener('mouseup', listener);
          document.removeEventListener('keyup', handleSelection);
          document.removeEventListener('mouseup', handleSelection);
      };
  }, [handleSelection]);


  // ===================== Render Helpers =====================
  const renderTOC = (items: NavigationItem[], level = 0) => {
      return items.map((item, idx) => (
          <div key={idx}>
              <div 
                className={`p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 truncate ${state.chapters.find(c => c.href === item.href)?.id === state.chapters[state.currentChapterIndex]?.id ? 'text-blue-500 font-bold' : ''}`}
                style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
                onClick={() => {
                    // Find index
                    const chIdx = state.chapters.findIndex(c => c.href === item.href || c.href.endsWith(item.href));
                    if (chIdx !== -1) {
                        controller.current?.loadChapter(chIdx);
                        setState(s => ({ ...s, isSidebarOpen: false }));
                    }
                }}
              >
                  {item.label}
              </div>
              {item.subitems && renderTOC(item.subitems, level + 1)}
          </div>
      ));
  };

  return (
    <div className={`h-screen flex flex-col ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-800'}`}>
      
      {/* Top Nav */}
      <div className="flex justify-between items-center p-3 bg-gray-800 text-white shadow-md z-30">
        <div className="flex gap-4">
            <button onClick={() => setState(s => ({ ...s, isSidebarOpen: !s.isSidebarOpen }))}><Icon name="bars"/></button>
            <button onClick={() => setState(s => ({ ...s, isSettingsOpen: !s.isSettingsOpen }))}><Icon name="cog"/></button>
        </div>
        <div className="font-semibold truncate max-w-xs">{state.currentBook ? state.currentBook.title : 'React EPUB Reader'}</div>
        <button onClick={() => updateSetting('darkMode', !state.isDarkMode)}>
             <Icon name={state.isDarkMode ? 'sun' : 'moon'}/>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden flex">
          
          {/* Sidebar */}
          <div className={`fixed inset-y-0 left-0 w-72 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-40 ${state.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold">
                   <span>Table of Contents</span>
                   <button onClick={() => setState(s => ({ ...s, isSidebarOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="overflow-y-auto h-full pb-20">
                   {state.navigationMap.length > 0 ? renderTOC(state.navigationMap) : (
                       state.chapters.map((c, i) => (
                           <div key={i} className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer" onClick={() => { controller.current?.loadChapter(i); setState(s => ({ ...s, isSidebarOpen: false })); }}>
                               {c.title}
                           </div>
                       ))
                   )}
               </div>
          </div>

          {/* Reader Area */}
          <div className="flex-1 relative flex flex-col">
               {/* Upload */}
               {!state.currentBook && !state.isLoading && (
                   <div className="flex-1 flex flex-col items-center justify-center p-10 border-2 border-dashed border-gray-300 m-10 rounded-lg">
                       <Icon name="book-open"/>
                       <h3 className="text-xl mt-4 mb-2">Upload EPUB</h3>
                       <p className="text-gray-500 mb-6">Drag & drop or click to select</p>
                       <label className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded cursor-pointer">
                           Select File
                           <input type="file" className="hidden" accept=".epub" onChange={handleFileUpload} />
                       </label>
                   </div>
               )}

               {/* Loading */}
               {state.isLoading && (
                   <div className="flex-1 flex flex-col items-center justify-center">
                       <div className="loader border-4 border-gray-200 border-t-blue-500 rounded-full w-12 h-12 animate-spin-custom mb-4"></div>
                       <p>{state.loadingMessage}</p>
                   </div>
               )}

               {/* Content */}
               {state.currentBook && !state.isLoading && (
                   <div className="flex-1 relative overflow-hidden bg-white dark:bg-gray-800" ref={readerContentRef}>
                       {/* Edge Taps */}
                       <div className="absolute top-0 bottom-0 left-0 w-12 z-10" onClick={() => controller.current?.prevPage()}></div>
                       <div className="absolute top-0 bottom-0 right-0 w-12 z-10" onClick={() => controller.current?.nextPage()}></div>
                       
                       {/* Pages */}
                       {state.sections.map((html, idx) => (
                           <div 
                             key={idx}
                             className={`absolute inset-0 p-8 md:p-12 overflow-y-auto no-scrollbar transition-opacity duration-300 ${idx === state.currentSectionIndex ? 'opacity-100 z-0' : 'opacity-0 -z-10 pointer-events-none'}`}
                             style={{ fontSize: controller.current?.getFontSizeValue(tempSettings.fontSize) }}
                             dangerouslySetInnerHTML={{ __html: html }} 
                           />
                       ))}
                   </div>
               )}
          </div>

          {/* Settings Sidebar */}
          <div className={`fixed inset-y-0 right-0 w-80 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-40 ${state.isSettingsOpen ? 'translate-x-0' : 'translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold">
                   <span>Settings</span>
                   <button onClick={() => setState(s => ({ ...s, isSettingsOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="p-4 overflow-y-auto h-full pb-20 space-y-6">
                   {/* Appearance */}
                   <section>
                       <h4 className="font-bold mb-2 text-gray-500 uppercase text-xs">Appearance</h4>
                       <div className="space-y-3">
                           <div>
                               <label className="block text-sm mb-1">Font Size</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempSettings.fontSize} onChange={(e) => updateSetting('fontSize', e.target.value)}>
                                   <option value="small">Small</option>
                                   <option value="medium">Medium</option>
                                   <option value="large">Large</option>
                                   <option value="xlarge">Extra Large</option>
                               </select>
                           </div>
                       </div>
                   </section>

                   {/* Audio */}
                   <section>
                       <h4 className="font-bold mb-2 text-gray-500 uppercase text-xs">Audio</h4>
                       <div className="space-y-3">
                           <label className="flex items-center space-x-2">
                               <input type="checkbox" checked={tempSettings.autoPlayAudio} onChange={e => updateSetting('autoPlayAudio', e.target.checked)} />
                               <span>Auto Play</span>
                           </label>
                           <label className="flex items-center space-x-2">
                               <input type="checkbox" checked={tempSettings.syncTextHighlight} onChange={e => updateSetting('syncTextHighlight', e.target.checked)} />
                               <span>Sync Highlight</span>
                           </label>
                           <div>
                               <label className="block text-sm mb-1">Volume</label>
                               <input type="range" min="0" max="100" value={tempSettings.audioVolume} onChange={e => updateSetting('audioVolume', parseInt(e.target.value))} className="w-full"/>
                           </div>
                       </div>
                   </section>

                   {/* Anki */}
                   <section>
                       <h4 className="font-bold mb-2 text-gray-500 uppercase text-xs">Anki Connect</h4>
                       <div className="space-y-3 text-sm">
                           <div className="flex gap-2">
                               <input className="w-2/3 p-2 border rounded dark:bg-gray-700 dark:border-gray-600" placeholder="Host" value={tempAnki.host} onChange={e => {
                                   const v = { ...tempAnki, host: e.target.value };
                                   setTempAnki(v);
                                   if (controller.current) controller.current.ankiSettings = v;
                               }}/>
                               <input className="w-1/3 p-2 border rounded dark:bg-gray-700 dark:border-gray-600" type="number" placeholder="Port" value={tempAnki.port} onChange={e => {
                                   const v = { ...tempAnki, port: parseInt(e.target.value) };
                                   setTempAnki(v);
                                   if (controller.current) controller.current.ankiSettings = v;
                               }}/>
                           </div>
                           <button className="w-full py-2 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300" onClick={() => controller.current?.testAnki()}>Test Connection</button>
                           {state.ankiConnected && (
                               <>
                                   <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempAnki.deck} onChange={e => {
                                       const v = { ...tempAnki, deck: e.target.value };
                                       setTempAnki(v);
                                       if (controller.current) controller.current.ankiSettings = v;
                                   }}>
                                       <option value="">Select Deck</option>
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
                                       <option value="">Select Model</option>
                                       {state.ankiModels.map(m => <option key={m} value={m}>{m}</option>)}
                                   </select>
                                   {/* Field mapping */}
                                   {['Word', 'Meaning', 'Sentence'].map(f => (
                                       <select key={f} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" 
                                         value={(tempAnki as any)[`${f.toLowerCase()}Field`]} 
                                         onChange={e => {
                                            const v = { ...tempAnki, [`${f.toLowerCase()}Field`]: e.target.value };
                                            setTempAnki(v);
                                            if (controller.current) controller.current.ankiSettings = v;
                                       }}>
                                           <option value="">{f} Field</option>
                                           {state.ankiFields.map(field => <option key={field} value={field}>{field}</option>)}
                                       </select>
                                   ))}
                                   <button className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={() => controller.current?.saveAnkiSettings()}>Save Anki Settings</button>
                               </>
                           )}
                       </div>
                   </section>
               </div>
          </div>
      </div>

      {/* Bottom Controls */}
      <div className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 p-2 flex flex-col md:flex-row items-center justify-between z-30 shadow-[0_-2px_10px_rgba(0,0,0,0.1)]">
           {/* Audio Player */}
           <div className={`w-full md:w-auto flex items-center gap-4 px-4 transition-transform ${state.isAudioPlaying || state.audioDuration > 0 ? 'translate-y-0' : 'translate-y-20 opacity-0 md:translate-y-0 md:opacity-100'}`}>
               <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 flex items-center justify-center" onClick={() => controller.current?.stopAudio()}><Icon name="stop"/></button>
               <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 flex items-center justify-center" onClick={() => controller.current?.seekAudioBy(-10)}><Icon name="backward"/></button>
               <button className="w-10 h-10 rounded-full bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center shadow-lg" onClick={() => controller.current?.toggleAudio()}>
                   <Icon name={state.isAudioPlaying ? "pause" : "play"}/>
               </button>
               <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 flex items-center justify-center" onClick={() => controller.current?.seekAudioBy(10)}><Icon name="forward"/></button>
               
               <div className="flex flex-col min-w-[150px]">
                   <span className="text-xs truncate max-w-[150px]">{state.audioTitle || 'No Audio'}</span>
                   <div className="flex items-center gap-2 text-xs text-gray-500">
                       <span>{Math.floor(state.audioCurrentTime/60)}:{Math.floor(state.audioCurrentTime%60).toString().padStart(2,'0')}</span>
                       <input 
                         type="range" 
                         min="0" 
                         max={state.audioDuration || 100} 
                         value={state.audioCurrentTime} 
                         onChange={e => controller.current?.seekAudio(parseFloat(e.target.value))} 
                         className="flex-1 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                       />
                       <span>{Math.floor(state.audioDuration/60)}:{Math.floor(state.audioDuration%60).toString().padStart(2,'0')}</span>
                   </div>
               </div>
           </div>

           {/* Page Navigation */}
           <div className="flex items-center gap-4 mt-2 md:mt-0">
               <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onClick={() => controller.current?.prevPage()}><Icon name="chevron-left"/></button>
               <span className="font-mono text-sm">{state.currentSectionIndex + 1} / {state.sections.length || 1}</span>
               <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onClick={() => controller.current?.nextPage()}><Icon name="chevron-right"/></button>
           </div>
      </div>

      {/* Selection Toolbar */}
      {state.selectionToolbarVisible && state.selectionRect && (
          <div 
            id="selection-toolbar"
            className="fixed bg-gray-800 text-white rounded-lg shadow-lg p-1 flex gap-1 z-50 animate-bounce-in"
            style={{ 
                top: Math.max(10, state.selectionRect.top - 50) + 'px', 
                left: Math.min(window.innerWidth - 150, Math.max(10, state.selectionRect.left + state.selectionRect.width/2 - 75)) + 'px' 
            }}
          >
              <button className="p-2 hover:bg-gray-700 rounded" onClick={() => controller.current?.lookupWord(state.selectedText)}><Icon name="book"/></button>
              <button className="p-2 hover:bg-gray-700 rounded" onClick={() => { navigator.clipboard.writeText(state.selectedText); setState(s => ({...s, selectionToolbarVisible: false})) }}><Icon name="copy"/></button>
          </div>
      )}

      {/* Dictionary Modal */}
      {state.dictionaryModalVisible && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setState(s => ({ ...s, dictionaryModalVisible: false }))}>
              <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-lg shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700 rounded-t-lg">
                      <h3 className="font-bold text-lg">Dictionary</h3>
                      <button onClick={() => setState(s => ({ ...s, dictionaryModalVisible: false }))}><Icon name="times"/></button>
                  </div>
                  <div className="p-6 overflow-y-auto flex-1">
                      {state.dictionaryLoading && <div className="text-center"><div className="loader inline-block border-2 border-t-blue-500 w-6 h-6 rounded-full animate-spin-custom"></div> Loading...</div>}
                      {state.dictionaryError && <div className="text-red-500 text-center">{state.dictionaryError}</div>}
                      {state.dictionaryData && (
                          <div>
                              <div className="flex items-baseline gap-2 mb-2">
                                  <h2 className="text-2xl font-bold text-blue-600">{state.dictionaryData.word}</h2>
                                  <span className="text-gray-500 italic">{state.dictionaryData.phonetic}</span>
                              </div>
                              {state.dictionaryData.meanings.map((m: any, i: number) => (
                                  <div key={i} className="mb-4">
                                      <div className="font-bold text-gray-700 dark:text-gray-300 mb-1">{m.partOfSpeech}</div>
                                      <ul className="list-disc pl-5 space-y-1 text-sm">
                                          {m.definitions.slice(0,3).map((d: any, j: number) => (
                                              <li key={j}>
                                                  {d.definition}
                                                  {d.example && <div className="text-gray-500 italic text-xs mt-1">Ex: {d.example}</div>}
                                              </li>
                                          ))}
                                      </ul>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
                  <div className="p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700 rounded-b-lg flex justify-end">
                      <button 
                        className={`px-4 py-2 rounded text-white flex items-center gap-2 ${state.ankiConnected ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'}`}
                        disabled={!state.ankiConnected || !state.dictionaryData}
                        onClick={async () => {
                             if (!state.dictionaryData) return;
                             const def = state.dictionaryData.meanings[0]?.definitions[0]?.definition || '';
                             // Try to find full sentence from text? Hard without maintaining selection context deeply.
                             // For now, use selected text as sentence placeholder or context.
                             try {
                                 await controller.current?.addToAnki(state.selectedText, def, state.selectedText);
                                 alert('Added to Anki!');
                                 setState(s => ({ ...s, dictionaryModalVisible: false }));
                             } catch(e: any) {
                                 alert('Failed: ' + e.message);
                             }
                        }}
                      >
                          <Icon name="plus"/> Add to Anki
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}