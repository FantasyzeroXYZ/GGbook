import React, { useEffect, useRef, useState, useCallback } from 'react';
import { EpubController } from './lib/EpubController';
import { AnkiSettings, AppSettings, Book, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState } from './types';

const Icon = ({ name }: { name: string }) => <i className={`fas fa-${name}`}></i>;

export default function App() {
  const [state, setState] = useState<ReaderState>({
    currentBook: null,
    currentChapterIndex: 0,
    navigationMap: [],
    currentSectionIndex: 0,
    currentCfi: '',
    currentChapterLabel: '',
    isSidebarOpen: false,
    isSettingsOpen: false,
    isDarkMode: false,
    isLoading: false,
    loadingMessage: '',
    isAudioPlaying: false,
    audioCurrentTime: 0,
    audioDuration: 0,
    audioTitle: '',
    audioList: [],
    showAudioList: false,
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

  const [tempSettings, setTempSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [tempAnki, setTempAnki] = useState<AnkiSettings>(DEFAULT_ANKI_SETTINGS);

  const controller = useRef<EpubController | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new EpubController(state, (partial) => {
        setState(prev => ({ ...prev, ...partial }));
    });
    controller.current = c;
    
    setTempSettings(c.settings);
    setTempAnki(c.ankiSettings);
    
    if (c.settings.darkMode) document.body.classList.add('dark');

    // Mount epubjs if ref is ready
    if (viewerRef.current) {
        c.mount(viewerRef.current);
    }

    const handleKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === 'ArrowLeft') c.prevPage();
        if (e.key === 'ArrowRight') c.nextPage();
        if (e.key === ' ') { e.preventDefault(); c.toggleAudio(); }
    };

    window.addEventListener('keydown', handleKey);
    
    return () => {
        c.stopAudio();
        window.removeEventListener('keydown', handleKey);
    };
  }, []);

  const updateSetting = (key: keyof AppSettings, val: any) => {
      setTempSettings(prev => ({ ...prev, [key]: val }));
      if (controller.current) {
          (controller.current.settings as any)[key] = val;
          controller.current.saveSettings();
          
          if (key === 'darkMode') {
             document.body.classList.toggle('dark', val);
             setState(s => ({ ...s, isDarkMode: val }));
             // Re-apply theme to rendition
             controller.current.setTheme(val ? 'dark' : 'light');
          } else if (key === 'theme') {
             controller.current.setTheme(val);
          } else if (key === 'audioVolume') {
              controller.current.setVolume(val / 100);
          } else if (key === 'fontSize') {
              controller.current.setFontSize(val);
          }
      }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          controller.current?.loadFile(e.target.files[0]);
      }
  };

  // Close Selection Toolbar on click away
  useEffect(() => {
      const listener = (e: MouseEvent) => {
          // Note: clicks inside iframe don't propagate here usually, this handles outside clicks
          const target = e.target as HTMLElement;
          if (!target.closest('#selection-toolbar')) {
              setState(prev => ({ ...prev, selectionToolbarVisible: false }));
          }
          // Close audio list on click away if clicking outside player controls
          if (!target.closest('.audio-controls-area') && !target.closest('.audio-list-popover')) {
              setState(prev => ({ ...prev, showAudioList: false }));
          }
      };
      document.addEventListener('mouseup', listener);
      return () => document.removeEventListener('mouseup', listener);
  }, []);

  const renderTOC = (items: NavigationItem[], level = 0) => {
      return items.map((item, idx) => (
          <div key={idx}>
              <div 
                className={`p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 truncate`}
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

  return (
    <div className={`h-screen flex flex-col ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-800'}`}>
      
      {/* Top Nav */}
      <div className="flex justify-between items-center p-3 bg-gray-800 text-white shadow-md z-30 h-14 shrink-0">
        <div className="flex gap-4">
            <button onClick={() => setState(s => ({ ...s, isSidebarOpen: !s.isSidebarOpen }))}><Icon name="bars"/></button>
            <button onClick={() => setState(s => ({ ...s, isSettingsOpen: !s.isSettingsOpen }))}><Icon name="cog"/></button>
        </div>
        <div className="font-semibold truncate max-w-xs">{state.currentBook ? state.currentBook.title : 'React EPUB Reader'}</div>
        <button onClick={() => updateSetting('darkMode', !state.isDarkMode)}>
             <Icon name={state.isDarkMode ? 'sun' : 'moon'}/>
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden flex">
          {/* Sidebar */}
          <div className={`fixed inset-y-0 left-0 w-72 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-40 ${state.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold">
                   <span>Table of Contents</span>
                   <button onClick={() => setState(s => ({ ...s, isSidebarOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="overflow-y-auto h-full pb-20">
                   {state.navigationMap.length > 0 ? renderTOC(state.navigationMap) : <div className="p-4 text-gray-500">No Table of Contents</div>}
               </div>
          </div>

          {/* Reader Area */}
          <div className="flex-1 relative flex flex-col overflow-hidden">
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

               {state.isLoading && (
                   <div className="flex-1 flex flex-col items-center justify-center">
                       <div className="loader border-4 border-gray-200 border-t-blue-500 rounded-full w-12 h-12 animate-spin-custom mb-4"></div>
                       <p>{state.loadingMessage}</p>
                   </div>
               )}

               {/* EPub.js Container */}
               <div 
                 id="viewer" 
                 ref={viewerRef} 
                 className={`flex-1 relative bg-white dark:bg-gray-800 ${!state.currentBook ? 'hidden' : ''}`}
               />
               
               {state.currentBook && (
                   <>
                       <div className="absolute top-0 bottom-0 left-0 w-16 z-20 cursor-pointer flex items-center justify-start pl-2 hover:bg-black hover:bg-opacity-5 transition-colors" onClick={() => controller.current?.prevPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 hover:opacity-50"><Icon name="chevron-left"/></div>
                       </div>
                       <div className="absolute top-0 bottom-0 right-0 w-16 z-20 cursor-pointer flex items-center justify-end pr-2 hover:bg-black hover:bg-opacity-5 transition-colors" onClick={() => controller.current?.nextPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 hover:opacity-50"><Icon name="chevron-right"/></div>
                       </div>
                   </>
               )}
          </div>

          {/* Settings Sidebar */}
          <div className={`fixed inset-y-0 right-0 w-80 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-40 ${state.isSettingsOpen ? 'translate-x-0' : 'translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold">
                   <span>Settings</span>
                   <button onClick={() => setState(s => ({ ...s, isSettingsOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="p-4 overflow-y-auto h-full pb-20 space-y-6">
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
                           <div>
                               <label className="block text-sm mb-1">Theme</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value)}>
                                   <option value="light">Light</option>
                                   <option value="dark">Dark</option>
                                   <option value="sepia">Sepia</option>
                               </select>
                           </div>
                       </div>
                   </section>
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

      {/* Audio List Popover */}
      {state.showAudioList && state.audioList.length > 0 && (
          <div className="audio-list-popover fixed bottom-24 left-4 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 max-h-64 overflow-y-auto z-50">
              <div className="p-3 border-b dark:border-gray-700 font-bold sticky top-0 bg-white dark:bg-gray-800 flex justify-between">
                  <span>Audio Tracks</span>
                  <span className="text-xs text-gray-500">{state.audioList.length} tracks</span>
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

      <div className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 p-2 flex flex-col md:flex-row items-center justify-between z-30 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] h-20 shrink-0 relative audio-controls-area">
           <div className={`w-full md:w-auto flex items-center gap-4 px-4 transition-transform ${state.isAudioPlaying || state.audioDuration > 0 ? 'translate-y-0' : 'translate-y-20 opacity-0 md:translate-y-0 md:opacity-100'}`}>
               <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 flex items-center justify-center" onClick={() => controller.current?.toggleAudioList()}><Icon name="list"/></button>
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

           <div className="flex items-center gap-4 mt-2 md:mt-0">
               <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onClick={() => controller.current?.prevPage()}><Icon name="chevron-left"/></button>
               <span className="font-mono text-sm text-gray-500">Page Navigation</span>
               <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onClick={() => controller.current?.nextPage()}><Icon name="chevron-right"/></button>
           </div>
      </div>

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