import React, { useEffect, useRef, useState, useCallback } from 'react';
import { EpubController } from './lib/EpubController';
import { AnkiSettings, AppSettings, LibraryBook, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState, BookProgress } from './types';
import { translations, Language } from './lib/locales';
import { db } from './lib/db';

const Icon = ({ name, className }: { name: string; className?: string }) => <i className={`fas fa-${name} ${className || ''}`}></i>;

type ViewMode = 'library' | 'reader';

export default function App() {
  const [view, setView] = useState<ViewMode>('library');
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);

  const [state, setState] = useState<ReaderState>({
    currentBook: null,
    navigationMap: [],
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
    currentAudioFile: null,
    selectionToolbarVisible: false,
    selectionRect: null,
    selectedText: '',
    selectedElementId: null,
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

  const t = (key: keyof typeof translations['en']) => {
      const lang = tempSettings.language || 'zh';
      return translations[lang][key];
  };

  useEffect(() => {
    const c = new EpubController(state, (partial) => {
        setState(prev => ({ ...prev, ...partial }));
    });
    controller.current = c;
    
    setTempSettings(c.settings);
    setTempAnki(c.ankiSettings);
    
    if (c.settings.darkMode) {
        document.body.classList.add('dark');
        setState(s => ({ ...s, isDarkMode: true }));
    }

    refreshLibrary();

    const handleKey = (e: KeyboardEvent) => {
        if (view !== 'reader') return;
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

  useEffect(() => {
      if (view !== 'reader' || !currentBookId) return;
      
      const saveTimer = setTimeout(() => {
          if (state.currentCfi) {
              const progress: BookProgress = {
                  cfi: state.currentCfi,
                  audioSrc: state.currentAudioFile || undefined,
                  audioTime: state.audioCurrentTime,
                  timestamp: Date.now()
              };
              db.updateBookProgress(currentBookId, progress).catch(err => console.error("Save progress failed", err));
          }
      }, 2000);

      return () => clearTimeout(saveTimer);
  }, [state.currentCfi, state.audioCurrentTime, currentBookId, view, state.currentAudioFile]);

  useEffect(() => {
      if (view === 'reader' && viewerRef.current && controller.current) {
          controller.current.mount(viewerRef.current);
      }
  }, [view]);

  const refreshLibrary = async () => {
      try {
          const books = await db.getAllBooks();
          setLibraryBooks(books);
      } catch (e) {
          console.error('Error loading library:', e);
      }
  };

  const updateSetting = (key: keyof AppSettings, val: any) => {
      setTempSettings(prev => ({ ...prev, [key]: val }));
      if (controller.current) {
          (controller.current.settings as any)[key] = val;
          controller.current.saveSettings();
          
          if (key === 'darkMode') {
             if (val) document.body.classList.add('dark');
             else document.body.classList.remove('dark');
             setState(s => ({ ...s, isDarkMode: val }));
             controller.current.toggleDarkMode(val);
          } else if (key === 'theme') {
             controller.current.setTheme(val);
          } else if (key === 'audioVolume') {
              controller.current.setVolume(val / 100);
          } else if (key === 'fontSize') {
              controller.current.setFontSize(val);
          }
      }
  };

  const handleImportBook = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          setState(s => ({ ...s, isLoading: true, loadingMessage: t('opening') }));
          
          try {
              const book = ePub(file);
              await book.ready;
              const meta = await book.loaded.metadata;
              
              let coverUrl = '';
              try {
                  const coverBlobUrl = await book.coverUrl();
                  if (coverBlobUrl) {
                      const response = await fetch(coverBlobUrl);
                      const blob = await response.blob();
                      coverUrl = await new Promise((resolve) => {
                          const reader = new FileReader();
                          reader.onloadend = () => resolve(reader.result as string);
                          reader.readAsDataURL(blob);
                      });
                  }
              } catch (err) {
                  console.warn('Cover extraction failed:', err);
              }

              const newBook: LibraryBook = {
                  id: new Date().getTime().toString(),
                  title: meta.title || file.name,
                  author: meta.creator || 'Unknown',
                  coverUrl: coverUrl,
                  addedAt: Date.now()
              };

              await db.addBook(newBook, file);
              await refreshLibrary();
              
              book.destroy();
              setState(s => ({ ...s, isLoading: false }));
          } catch (err: any) {
              console.error(err);
              alert(t('failed') + ': ' + err.message);
              setState(s => ({ ...s, isLoading: false }));
          }
      }
  };

  const openBook = async (book: LibraryBook) => {
      setState(s => ({ ...s, isLoading: true, loadingMessage: t('opening') }));
      try {
          const fileBlob = await db.getBookFile(book.id);
          if (fileBlob) {
              setCurrentBookId(book.id);
              setView('reader');
              setTimeout(() => {
                  controller.current?.loadFile(fileBlob, book.progress);
              }, 100);
          } else {
              alert('Book file not found!');
              setState(s => ({ ...s, isLoading: false }));
          }
      } catch (e) {
          console.error(e);
          setState(s => ({ ...s, isLoading: false }));
      }
  };

  const deleteBook = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm('确定要删除这本书吗？')) {
          await db.deleteBook(id);
          await refreshLibrary();
      }
  };

  const exitReader = () => {
      controller.current?.destroy();
      setView('library');
      setState(s => ({ ...s, currentBook: null }));
      setCurrentBookId(null);
      refreshLibrary();
  };

  useEffect(() => {
      const listener = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (!target.closest('#selection-toolbar')) {
              setState(prev => ({ ...prev, selectionToolbarVisible: false }));
          }
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

  // ===================== 书架视图 =====================
  if (view === 'library') {
      return (
        <div className={`min-h-screen flex flex-col ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-800'}`}>
            <div className="flex justify-between items-center p-4 bg-white dark:bg-gray-800 shadow-md">
                <h1 className="text-xl font-bold flex items-center gap-2">
                    <Icon name="book-reader" /> React EPUB Reader
                </h1>
                <div className="flex gap-4">
                    <button onClick={() => updateSetting('darkMode', !state.isDarkMode)} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                        <Icon name={state.isDarkMode ? 'sun' : 'moon'}/>
                    </button>
                </div>
            </div>

            <div className="flex-1 container mx-auto p-2 md:p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg md:text-2xl font-bold">我的书架</h2>
                    <label className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded cursor-pointer transition-colors flex items-center gap-2">
                        <Icon name="plus" /> 导入
                        <input type="file" className="hidden" accept=".epub" onChange={handleImportBook} />
                    </label>
                </div>

                {state.isLoading && (
                    <div className="text-center py-10">
                        <div className="loader inline-block border-4 border-gray-200 border-t-blue-500 rounded-full w-8 h-8 animate-spin-custom mb-2"></div>
                        <p>{state.loadingMessage}</p>
                    </div>
                )}

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 md:gap-6">
                    {libraryBooks.map(book => (
                        <div key={book.id} onClick={() => openBook(book)} className="bg-white dark:bg-gray-800 rounded-md shadow hover:shadow-lg transition-shadow cursor-pointer overflow-hidden border dark:border-gray-700 flex flex-col group relative h-full">
                            <div className="w-full aspect-[3/4] bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400 overflow-hidden">
                                {book.coverUrl ? (
                                    <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                                ) : (
                                    <Icon name="book" className="text-2xl md:text-4xl" />
                                )}
                            </div>
                            <div className="p-2 flex-1 flex flex-col justify-start">
                                <h3 className="font-bold text-[11px] md:text-base leading-tight mb-1 line-clamp-2" title={book.title}>{book.title}</h3>
                                <p className="text-[10px] md:text-sm text-gray-500 dark:text-gray-400 truncate hidden sm:block">{book.author}</p>
                            </div>
                            {book.progress && (
                                <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] px-1 rounded">
                                    {Math.floor((book.progress.audioTime || 0) / 60)}m
                                </div>
                            )}
                            <button 
                                onClick={(e) => deleteBook(book.id, e)}
                                className="absolute top-1 right-1 p-1.5 md:p-2 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-600 z-10"
                                title="删除"
                            >
                                <Icon name="trash" className="text-xs md:text-sm"/>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      );
  }

  // ===================== 阅读器视图 =====================
  return (
    <div className={`h-screen flex flex-col ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-800'}`}>
      
      {/* 顶部导航 */}
      <div className="flex justify-between items-center p-3 bg-gray-800 text-white shadow-md z-30 h-14 shrink-0 transition-colors duration-300">
        <div className="flex gap-4">
            <button onClick={exitReader} className="hover:text-gray-300" title="返回书架"><Icon name="arrow-left"/></button>
            <div className="h-6 w-px bg-gray-600 mx-2"></div>
            <button onClick={() => setState(s => ({ ...s, isSidebarOpen: !s.isSidebarOpen }))}><Icon name="bars"/></button>
            <button onClick={() => setState(s => ({ ...s, isSettingsOpen: !s.isSettingsOpen }))}><Icon name="cog"/></button>
        </div>
        <div className="font-semibold truncate max-w-xs">{state.currentBook ? state.currentBook.title : 'Loading...'}</div>
        <button onClick={() => updateSetting('darkMode', !state.isDarkMode)}>
             <Icon name={state.isDarkMode ? 'sun' : 'moon'}/>
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden flex">
          {/* 侧边栏 (目录) */}
          <div className={`fixed inset-y-0 left-0 w-72 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-40 ${state.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold text-gray-800 dark:text-gray-100">
                   <span>{t('tableOfContents')}</span>
                   <button onClick={() => setState(s => ({ ...s, isSidebarOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="overflow-y-auto h-full pb-20">
                   {state.navigationMap.length > 0 ? renderTOC(state.navigationMap) : <div className="p-4 text-gray-500">{t('noTOC')}</div>}
               </div>
          </div>

          {/* 阅读区域 */}
          <div className="flex-1 relative flex flex-col overflow-hidden">
               {state.isLoading && (
                   <div className="flex-1 flex flex-col items-center justify-center">
                       <div className="loader border-4 border-gray-200 border-t-blue-500 rounded-full w-12 h-12 animate-spin-custom mb-4"></div>
                       <p className="text-gray-600 dark:text-gray-300">{state.loadingMessage}</p>
                   </div>
               )}

               {/* EPub.js 容器 */}
               <div 
                 id="viewer" 
                 ref={viewerRef} 
                 className={`flex-1 relative bg-white dark:bg-gray-800 ${!state.currentBook ? 'hidden' : ''}`}
               />
               
               {state.currentBook && (
                   <>
                       <div className="absolute top-0 bottom-0 left-0 w-16 z-20 cursor-pointer flex items-center justify-start pl-2 hover:bg-black hover:bg-opacity-5 dark:hover:bg-white dark:hover:bg-opacity-5 transition-colors group" onClick={() => controller.current?.prevPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 group-hover:opacity-50 transition-opacity"><Icon name="chevron-left"/></div>
                       </div>
                       <div className="absolute top-0 bottom-0 right-0 w-16 z-20 cursor-pointer flex items-center justify-end pr-2 hover:bg-black hover:bg-opacity-5 dark:hover:bg-white dark:hover:bg-opacity-5 transition-colors group" onClick={() => controller.current?.nextPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 group-hover:opacity-50 transition-opacity"><Icon name="chevron-right"/></div>
                       </div>
                   </>
               )}
          </div>

          {/* 设置侧边栏 */}
          <div className={`fixed inset-y-0 right-0 w-80 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-40 ${state.isSettingsOpen ? 'translate-x-0' : 'translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold text-gray-800 dark:text-gray-100">
                   <span>{t('settings')}</span>
                   <button onClick={() => setState(s => ({ ...s, isSettingsOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="p-4 overflow-y-auto h-full pb-20 space-y-6 text-gray-800 dark:text-gray-200">
                   <section>
                       <h4 className="font-bold mb-2 text-gray-500 uppercase text-xs">{t('appearance')}</h4>
                       <div className="space-y-3">
                           <div>
                               <label className="block text-sm mb-1">{t('language')}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempSettings.language} onChange={(e) => updateSetting('language', e.target.value)}>
                                   <option value="zh">中文</option>
                                   <option value="en">English</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1">{t('fontSize')}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempSettings.fontSize} onChange={(e) => updateSetting('fontSize', e.target.value)}>
                                   <option value="small">{t('small')}</option>
                                   <option value="medium">{t('medium')}</option>
                                   <option value="large">{t('large')}</option>
                                   <option value="xlarge">{t('xlarge')}</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1">{t('theme')}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value)}>
                                   <option value="light">{t('light')}</option>
                                   <option value="dark">{t('dark')}</option>
                                   <option value="sepia">{t('sepia')}</option>
                               </select>
                           </div>
                       </div>
                   </section>
                   <section>
                       <h4 className="font-bold mb-2 text-gray-500 uppercase text-xs">{t('audio')}</h4>
                       <div className="space-y-3">
                           <label className="flex items-center space-x-2">
                               <input type="checkbox" checked={tempSettings.autoPlayAudio} onChange={e => updateSetting('autoPlayAudio', e.target.checked)} />
                               <span>{t('autoPlay')}</span>
                           </label>
                           <label className="flex items-center space-x-2">
                               <input type="checkbox" checked={tempSettings.syncTextHighlight} onChange={e => updateSetting('syncTextHighlight', e.target.checked)} />
                               <span>{t('syncHighlight')}</span>
                           </label>
                           <div>
                               <label className="block text-sm mb-1">{t('volume')}</label>
                               <input type="range" min="0" max="100" value={tempSettings.audioVolume} onChange={e => updateSetting('audioVolume', parseInt(e.target.value))} className="w-full"/>
                           </div>
                       </div>
                   </section>
                   <section>
                       <h4 className="font-bold mb-2 text-gray-500 uppercase text-xs">{t('ankiConnect')}</h4>
                       <div className="space-y-3 text-sm">
                           <div className="flex gap-2">
                               <input className="w-2/3 p-2 border rounded dark:bg-gray-700 dark:border-gray-600" placeholder={t('host')} value={tempAnki.host} onChange={e => {
                                   const v = { ...tempAnki, host: e.target.value };
                                   setTempAnki(v);
                                   if (controller.current) controller.current.ankiSettings = v;
                               }}/>
                               <input className="w-1/3 p-2 border rounded dark:bg-gray-700 dark:border-gray-600" type="number" placeholder={t('port')} value={tempAnki.port} onChange={e => {
                                   const v = { ...tempAnki, port: parseInt(e.target.value) };
                                   setTempAnki(v);
                                   if (controller.current) controller.current.ankiSettings = v;
                               }}/>
                           </div>
                           <button className="w-full py-2 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500" onClick={() => controller.current?.testAnki()}>{t('testConnection')}</button>
                           {state.ankiConnected && (
                               <>
                                   <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" value={tempAnki.deck} onChange={e => {
                                       const v = { ...tempAnki, deck: e.target.value };
                                       setTempAnki(v);
                                       if (controller.current) controller.current.ankiSettings = v;
                                   }}>
                                       <option value="">{t('selectDeck')}</option>
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
                                       <option value="">{t('selectModel')}</option>
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
                                   <button className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600" onClick={() => controller.current?.saveAnkiSettings()}>{t('saveAnkiSettings')}</button>
                               </>
                           )}
                       </div>
                   </section>
               </div>
          </div>
      </div>

      {/* 音频列表弹窗 */}
      {state.showAudioList && state.audioList.length > 0 && (
          <div className="audio-list-popover fixed bottom-24 left-4 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 max-h-64 overflow-y-auto z-50 text-gray-800 dark:text-gray-200">
              <div className="p-3 border-b dark:border-gray-700 font-bold sticky top-0 bg-white dark:bg-gray-800 flex justify-between items-center">
                  <span>{t('audioTracks')}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{state.audioList.length} {t('tracks')}</span>
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
      <div className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 p-2 flex flex-col md:flex-row items-center justify-between z-30 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] h-20 shrink-0 relative audio-controls-area transition-colors duration-300">
           <div className={`w-full md:w-auto flex items-center gap-4 px-4 transition-transform ${state.isAudioPlaying || state.audioDuration > 0 || state.currentAudioFile ? 'translate-y-0' : 'translate-y-20 opacity-0 md:translate-y-0 md:opacity-100'}`}>
               <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200" onClick={() => controller.current?.toggleAudioList()}><Icon name="list"/></button>
               <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200" onClick={() => controller.current?.seekAudioBy(-10)}><Icon name="backward"/></button>
               <button className="w-10 h-10 rounded-full bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center shadow-lg" onClick={() => controller.current?.toggleAudio()}>
                   <Icon name={state.isAudioPlaying ? "pause" : "play"}/>
               </button>
               <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200" onClick={() => controller.current?.seekAudioBy(10)}><Icon name="forward"/></button>
               
               <div className="flex flex-col min-w-[150px]">
                   <span className="text-xs truncate max-w-[150px] text-gray-800 dark:text-gray-200">{state.audioTitle || 'No Audio'}</span>
                   <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                       <span>{Math.floor(state.audioCurrentTime/60)}:{Math.floor(state.audioCurrentTime%60).toString().padStart(2,'0')}</span>
                       <input 
                         type="range" 
                         min="0" 
                         max={state.audioDuration || 100} 
                         value={state.audioCurrentTime} 
                         onChange={e => controller.current?.seekAudio(parseFloat(e.target.value))} 
                         className="flex-1 h-1 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
                       />
                       <span>{Math.floor(state.audioDuration/60)}:{Math.floor(state.audioDuration%60).toString().padStart(2,'0')}</span>
                   </div>
               </div>
           </div>

           <div className="flex items-center gap-4 mt-2 md:mt-0 text-gray-500 dark:text-gray-400">
               <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onClick={() => controller.current?.prevPage()}><Icon name="chevron-left"/></button>
               <span className="font-mono text-sm">{t('pageNav')}</span>
               <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" onClick={() => controller.current?.nextPage()}><Icon name="chevron-right"/></button>
           </div>
      </div>

      {state.selectionToolbarVisible && state.selectionRect && (
          <div 
            id="selection-toolbar"
            className="fixed bg-gray-800 text-white rounded-lg shadow-lg p-2 flex gap-2 z-50 animate-bounce-in"
            style={{ 
                top: Math.max(10, state.selectionRect.top - 60) + 'px', // 向上偏移以显示在选区上方
                left: Math.min(window.innerWidth - 180, Math.max(10, state.selectionRect.left + state.selectionRect.width/2 - 90)) + 'px' 
            }}
          >
              <button className="p-2 hover:bg-gray-700 rounded transition-colors" title={t('dictionary')} onClick={() => controller.current?.lookupWord(state.selectedText)}>
                  <Icon name="book" />
              </button>
              <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Highlight" onClick={() => controller.current?.highlightSelection()}>
                  <Icon name="highlighter" />
              </button>
              <button 
                className="p-2 hover:bg-gray-700 rounded transition-colors" 
                title={t('addToAnki')} 
                onClick={async () => {
                    // 快速添加：使用选中文本作为单词和句子
                    try {
                        await controller.current?.addToAnki(state.selectedText, '', state.selectedText);
                        alert(t('addedToAnki'));
                        setState(s => ({...s, selectionToolbarVisible: false}));
                    } catch(e: any) {
                        alert(t('failed') + ': ' + e.message);
                    }
                }}
              >
                  <Icon name="plus-square" />
              </button>
              <button 
                className="p-2 hover:bg-gray-700 rounded transition-colors" 
                title="Jump Audio" 
                onClick={() => state.selectedElementId && controller.current?.seekToElementId(state.selectedElementId)}
                disabled={!state.selectedElementId}
              >
                  <Icon name="crosshairs" className={!state.selectedElementId ? "opacity-50" : ""} />
              </button>
          </div>
      )}

      {state.dictionaryModalVisible && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setState(s => ({ ...s, dictionaryModalVisible: false }))}>
              <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-lg shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700 rounded-t-lg">
                      <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100">{t('dictionary')}</h3>
                      <button onClick={() => setState(s => ({ ...s, dictionaryModalVisible: false }))} className="text-gray-600 dark:text-gray-300"><Icon name="times"/></button>
                  </div>
                  <div className="p-6 overflow-y-auto flex-1 text-gray-800 dark:text-gray-200">
                      {state.dictionaryLoading && <div className="text-center"><div className="loader inline-block border-2 border-t-blue-500 w-6 h-6 rounded-full animate-spin-custom"></div> {t('loading')}</div>}
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
                                 alert(t('addedToAnki'));
                                 setState(s => ({ ...s, dictionaryModalVisible: false }));
                             } catch(e: any) {
                                 alert(t('failed') + ': ' + e.message);
                             }
                        }}
                      >
                          <Icon name="plus"/> {t('addToAnki')}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}