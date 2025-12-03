import React, { useEffect, useRef, useState, useCallback } from 'react';
import { EpubController } from './lib/EpubController';
import { AnkiSettings, AppSettings, LibraryBook, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState, BookProgress, Bookmark } from './types';
import { translations, Language } from './lib/locales';
import { db } from './lib/db';

const Icon = ({ name, className }: { name: string; className?: string }) => <i className={`fas fa-${name} ${className || ''}`}></i>;

type ViewMode = 'library' | 'reader';
type SidebarTab = 'toc' | 'bookmarks';

export default function App() {
  const [view, setView] = useState<ViewMode>('library');
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('toc');

  // Local state for Anki adding process to show specific loading UI
  const [isAnkiAdding, setIsAnkiAdding] = useState(false);

  const [state, setState] = useState<ReaderState>({
    currentBook: null,
    navigationMap: [],
    bookmarks: [],
    currentCfi: '',
    currentChapterLabel: '',
    isSidebarOpen: false,
    isSettingsOpen: false,
    isDarkMode: false,
    isLoading: false,
    loadingMessage: '',
    hasAudio: false,
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
    selectedSentence: '',
    selectedElementId: null,
    dictionaryModalVisible: false,
    dictionaryData: null,
    dictionaryLoading: false,
    dictionaryError: null,
    ankiConnected: false,
    ankiDecks: [],
    ankiModels: [],
    ankiFields: [],
    toastMessage: null
  });

  const [tempSettings, setTempSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [tempAnki, setTempAnki] = useState<AnkiSettings>(DEFAULT_ANKI_SETTINGS);

  const controller = useRef<EpubController | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const t = (key: keyof typeof translations['en']) => {
      const lang = tempSettings.language || 'zh';
      return translations[lang][key];
  };

  // 格式化释义为 HTML
  const formatDefinition = (data: any) => {
      if (!data) return '';
      let html = `<div><b>${data.word}</b> <span style="color:#666">${data.phonetic || ''}</span></div>`;
      data.meanings.forEach((m: any) => {
          html += `<div style="margin-top:5px"><i>${m.partOfSpeech}</i></div><ul>`;
          m.definitions.slice(0, 3).forEach((d: any) => {
               html += `<li>${d.definition}`;
               if (d.example) html += `<br><small style="color:#888">Ex: ${d.example}</small>`;
               html += `</li>`;
          });
          html += `</ul>`;
      });
      return html;
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

  // 同步书签到数据库
  useEffect(() => {
      if (view === 'reader' && currentBookId) {
          db.updateBookBookmarks(currentBookId, state.bookmarks);
      }
  }, [state.bookmarks, currentBookId, view]);

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
          } else if (key === 'layoutMode') {
              controller.current.setLayoutMode(val);
          } else if (key === 'direction') {
              controller.current.setDirection(val);
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
                  addedAt: Date.now(),
                  bookmarks: []
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
              // 稍微延迟以确保视图切换完成
              setTimeout(() => {
                  controller.current?.loadFile(fileBlob, book.progress, book.bookmarks || []);
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
      await db.deleteBook(id);
      await refreshLibrary();
  };

  const exitReader = () => {
      controller.current?.destroy();
      setView('library');
      setState(s => ({ ...s, currentBook: null }));
      setCurrentBookId(null);
      refreshLibrary();
  };

  const handleAddBookmark = async () => {
      if (controller.current) {
          const newBookmarks = await controller.current.addBookmark();
          if (newBookmarks) {
              setState(s => ({...s, toastMessage: "Bookmark Added!" }));
              setTimeout(() => setState(s => ({...s, toastMessage: null })), 2000);
          }
      }
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

  const renderBookmarks = () => {
      if (state.bookmarks.length === 0) {
          return <div className="p-4 text-gray-500">{t('noBookmarks')}</div>;
      }
      return state.bookmarks.map((bm) => (
          <div key={bm.id} className="p-3 border-b dark:border-gray-700 flex justify-between items-center hover:bg-gray-100 dark:hover:bg-gray-700">
              <div 
                  className="cursor-pointer truncate flex-1 text-gray-800 dark:text-gray-200 flex flex-col" 
                  onClick={() => {
                      controller.current?.restoreBookmark(bm);
                      setState(s => ({ ...s, isSidebarOpen: false }));
                  }}
              >
                  <span>{bm.label}</span>
                  {bm.audioSrc && <span className="text-xs text-blue-500"><Icon name="volume-up"/> Audio saved</span>}
              </div>
              <button onClick={() => controller.current?.removeBookmark(bm.id)} className="text-red-500 hover:text-red-700 ml-2">
                  <Icon name="trash" />
              </button>
          </div>
      ));
  };

  // ===================== 书架视图 =====================
  if (view === 'library') {
      return (
        <div className={`min-h-[100dvh] flex flex-col ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-800'}`}>
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
  // 阻止浏览器默认右键菜单
  return (
    <div 
        className={`h-[100dvh] flex flex-col overflow-hidden ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-800'}`}
        onContextMenu={(e) => e.preventDefault()}
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
            <button onClick={handleAddBookmark} className="hover:text-gray-300" title={t('addBookmark')}>
                <Icon name="bookmark" />
            </button>
            <div className="w-px bg-gray-600 h-6 mx-2"></div>
            <button onClick={() => updateSetting('darkMode', !state.isDarkMode)}>
                <Icon name={state.isDarkMode ? 'sun' : 'moon'}/>
            </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden flex">
          {/* 覆盖层：点击空白处关闭侧边栏/设置栏 */}
          {(state.isSidebarOpen || state.isSettingsOpen) && (
              <div 
                  className="absolute inset-0 z-40 bg-black/20"
                  onClick={() => setState(s => ({ ...s, isSidebarOpen: false, isSettingsOpen: false }))}
              ></div>
          )}

          {/* 侧边栏 (目录/书签) */}
          <div className={`fixed inset-y-0 left-0 w-72 bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-50 ${state.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col`}>
               <div className="flex border-b dark:border-gray-700">
                   <button 
                       className={`flex-1 p-3 font-bold ${sidebarTab === 'toc' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-600 dark:text-gray-400'}`}
                       onClick={() => setSidebarTab('toc')}
                   >
                       {t('tableOfContents')}
                   </button>
                   <button 
                       className={`flex-1 p-3 font-bold ${sidebarTab === 'bookmarks' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-600 dark:text-gray-400'}`}
                       onClick={() => setSidebarTab('bookmarks')}
                   >
                       {t('bookmarks')}
                   </button>
               </div>
               <div className="overflow-y-auto flex-1 pb-20">
                   {sidebarTab === 'toc' ? (
                       state.navigationMap.length > 0 ? renderTOC(state.navigationMap) : <div className="p-4 text-gray-500">{t('noTOC')}</div>
                   ) : (
                       renderBookmarks()
                   )}
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

               {/* EPub.js 容器 */}
               <div 
                 id="viewer" 
                 ref={viewerRef} 
                 className={`flex-1 relative bg-white dark:bg-gray-800 ${!state.currentBook ? 'hidden' : ''}`}
               />
               
               {state.currentBook && (
                   <>
                       {/* 缩小触发范围：将 w-16 改为 w-8 */}
                       <div className="absolute top-0 bottom-0 left-0 w-8 z-20 cursor-pointer flex items-center justify-start pl-1 hover:bg-black hover:bg-opacity-5 dark:hover:bg-white dark:hover:bg-opacity-5 transition-colors group tap-highlight-transparent" onClick={() => controller.current?.prevPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 group-hover:opacity-50 transition-opacity transform scale-75"><Icon name="chevron-left"/></div>
                       </div>
                       <div className="absolute top-0 bottom-0 right-0 w-8 z-20 cursor-pointer flex items-center justify-end pr-1 hover:bg-black hover:bg-opacity-5 dark:hover:bg-white dark:hover:bg-opacity-5 transition-colors group tap-highlight-transparent" onClick={() => controller.current?.nextPage()}>
                           <div className="bg-gray-800 text-white p-2 rounded-full opacity-0 group-hover:opacity-50 transition-opacity transform scale-75"><Icon name="chevron-right"/></div>
                       </div>
                   </>
               )}
          </div>

          {/* 设置侧边栏 - 使用 details/summary 实现默认折叠 */}
          <div className={`fixed inset-y-0 right-0 w-80 max-w-full bg-white dark:bg-gray-800 shadow-xl transform transition-transform z-50 ${state.isSettingsOpen ? 'translate-x-0' : 'translate-x-full'}`}>
               <div className="p-4 bg-gray-100 dark:bg-gray-700 flex justify-between items-center font-bold text-gray-800 dark:text-gray-100">
                   <span>{t('settings')}</span>
                   <button onClick={() => setState(s => ({ ...s, isSettingsOpen: false }))}><Icon name="times"/></button>
               </div>
               <div className="p-4 overflow-y-auto h-full pb-20 space-y-4 text-gray-800 dark:text-gray-200">
                   {/* 外观设置 */}
                   <details className="group" open>
                       <summary className="font-bold text-gray-500 uppercase text-xs border-b pb-1 cursor-pointer list-none flex justify-between items-center">
                           {t('appearance')}
                           <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-[10px]" /></span>
                       </summary>
                       <div className="space-y-3 pt-3 pl-2">
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t('language')}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.language} onChange={(e) => updateSetting('language', e.target.value)}>
                                   <option value="zh">中文</option>
                                   <option value="en">English</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t('layout')}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.layoutMode} onChange={(e) => updateSetting('layoutMode', e.target.value)}>
                                   <option value="single">{t('singlePage')}</option>
                                   <option value="double">{t('doublePage')}</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">Direction</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.direction} onChange={(e) => updateSetting('direction', e.target.value)}>
                                   <option value="horizontal">Horizontal (横排)</option>
                                   <option value="vertical">Vertical (竖排 - 日语)</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t('fontSize')}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.fontSize} onChange={(e) => updateSetting('fontSize', e.target.value)}>
                                   <option value="small">{t('small')}</option>
                                   <option value="medium">{t('medium')}</option>
                                   <option value="large">{t('large')}</option>
                                   <option value="xlarge">{t('xlarge')}</option>
                               </select>
                           </div>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t('theme')}</label>
                               <select className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 text-sm" value={tempSettings.theme} onChange={(e) => updateSetting('theme', e.target.value)}>
                                   <option value="light">{t('light')}</option>
                                   <option value="dark">{t('dark')}</option>
                                   <option value="sepia">{t('sepia')}</option>
                               </select>
                           </div>
                       </div>
                   </details>

                   {/* 音频设置 */}
                   <details className="group">
                       <summary className="font-bold text-gray-500 uppercase text-xs border-b pb-1 cursor-pointer list-none flex justify-between items-center">
                           {t('audio')}
                           <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-[10px]" /></span>
                       </summary>
                       <div className="space-y-3 pt-3 pl-2">
                           <label className="flex items-center space-x-2 cursor-pointer">
                               <input type="checkbox" checked={tempSettings.autoPlayAudio} onChange={e => updateSetting('autoPlayAudio', e.target.checked)} className="rounded text-blue-500" />
                               <span className="text-sm">{t('autoPlay')}</span>
                           </label>
                           <label className="flex items-center space-x-2 cursor-pointer">
                               <input type="checkbox" checked={tempSettings.syncTextHighlight} onChange={e => updateSetting('syncTextHighlight', e.target.checked)} className="rounded text-blue-500" />
                               <span className="text-sm">{t('syncHighlight')}</span>
                           </label>
                           <div>
                               <label className="block text-sm mb-1 text-gray-600 dark:text-gray-400">{t('volume')}</label>
                               <input type="range" min="0" max="100" value={tempSettings.audioVolume} onChange={e => updateSetting('audioVolume', parseInt(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"/>
                           </div>
                       </div>
                   </details>
                   
                   {/* Anki 设置 */}
                   <details className="group">
                       <summary className="font-bold text-gray-500 uppercase text-xs border-b pb-1 cursor-pointer list-none flex justify-between items-center">
                           {t('ankiConnect')}
                           <span className="transition-transform group-open:rotate-180"><Icon name="chevron-down" className="text-[10px]" /></span>
                       </summary>
                       <div className="space-y-3 text-sm pt-3 pl-2">
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
                           <button className="w-full py-2 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors" onClick={() => controller.current?.testAnki()}>{t('testConnection')}</button>
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
                                   {['Word', 'Meaning', 'Sentence', 'Audio'].map(f => (
                                       <select key={f} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600" 
                                         value={(tempAnki as any)[`${f.toLowerCase()}Field`]} 
                                         onChange={e => {
                                            const v = { ...tempAnki, [`${f.toLowerCase()}Field`]: e.target.value };
                                            setTempAnki(v);
                                            if (controller.current) controller.current.ankiSettings = v;
                                       }}>
                                           <option value="">{f === 'Audio' ? t('audioField') : (t as any)(`${f.toLowerCase()}Field`)}</option>
                                           {state.ankiFields.map(field => <option key={field} value={field}>{field}</option>)}
                                       </select>
                                   ))}
                                   <button className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors" onClick={() => controller.current?.saveAnkiSettings()}>{t('saveAnkiSettings')}</button>
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

      {/* 底部 / 音频播放器 (仅当有音频时显示) */}
      {state.hasAudio && (
          <div className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 p-2 flex items-center justify-center z-30 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] h-20 shrink-0 relative audio-controls-area transition-colors duration-300 w-full overflow-hidden">
               <div className="w-full flex items-center gap-2 md:gap-4 px-2 md:px-4 transition-transform translate-y-0 opacity-100 max-w-full overflow-hidden">
                   <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 shrink-0" onClick={() => controller.current?.toggleAudioList()}><Icon name="list"/></button>
                   <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 shrink-0" onClick={() => controller.current?.playPrevSentence()}><Icon name="step-backward"/></button>
                   <button className="w-10 h-10 rounded-full bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center shadow-lg shrink-0" onClick={() => controller.current?.toggleAudio()}>
                       <Icon name={state.isAudioPlaying ? "pause" : "play"}/>
                   </button>
                   <button className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-200 shrink-0" onClick={() => controller.current?.playNextSentence()}><Icon name="step-forward"/></button>
                   
                   <div className="flex flex-col flex-1 min-w-0 mx-1 md:mx-2 overflow-hidden">
                       <span className="text-xs truncate text-gray-800 dark:text-gray-200 text-center mb-1 w-full">{state.audioTitle || 'No Audio'}</span>
                       <div className="flex items-center gap-1 md:gap-2 text-xs text-gray-500 dark:text-gray-400 w-full">
                           <span className="w-8 md:w-10 text-right shrink-0">{Math.floor(state.audioCurrentTime/60)}:{Math.floor(state.audioCurrentTime%60).toString().padStart(2,'0')}</span>
                           <input 
                             type="range" 
                             min="0" 
                             max={state.audioDuration || 100} 
                             value={state.audioCurrentTime} 
                             onChange={e => controller.current?.seekAudio(parseFloat(e.target.value))} 
                             className="flex-1 h-1 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer min-w-0"
                           />
                           <span className="w-8 md:w-10 shrink-0 text-left">{Math.floor(state.audioDuration/60)}:{Math.floor(state.audioDuration%60).toString().padStart(2,'0')}</span>
                       </div>
                   </div>
               </div>
          </div>
      )}

      {state.selectionToolbarVisible && state.selectionRect && (
          <div 
            id="selection-toolbar"
            className="fixed bg-gray-800 text-white rounded-lg shadow-lg p-2 flex gap-2 z-50 animate-bounce-in max-w-[95vw] overflow-x-auto"
            style={{ 
                top: Math.max(10, state.selectionRect.top - 60) + 'px', 
                left: Math.min(window.innerWidth - 220, Math.max(10, state.selectionRect.left + state.selectionRect.width/2 - 90)) + 'px' 
            }}
          >
              <button className="p-2 hover:bg-gray-700 rounded transition-colors" title={t('dictionary')} onClick={() => controller.current?.lookupWord(state.selectedText)}>
                  <Icon name="book" />
              </button>
              <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Copy" onClick={() => controller.current?.copySelection()}>
                  <Icon name="copy" />
              </button>
              <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Highlight" onClick={() => controller.current?.highlightSelection()}>
                  <Icon name="highlighter" />
              </button>
              <button 
                className={`p-2 rounded transition-colors ${isAnkiAdding ? 'bg-gray-600 cursor-not-allowed' : 'hover:bg-gray-700'}`}
                title={t('addToAnki')} 
                disabled={isAnkiAdding}
                onClick={async () => {
                    try {
                        setIsAnkiAdding(true);
                        // 使用选中的句子（如果有），否则使用选中的文本
                        await controller.current?.addToAnki(state.selectedText, '', state.selectedSentence || state.selectedText);
                        setState(s => ({...s, toastMessage: t('addedToAnki'), selectionToolbarVisible: false}));
                        setTimeout(() => setState(s => ({...s, toastMessage: null})), 2000);
                    } catch(e: any) {
                        alert(t('failed') + ': ' + e.message);
                    } finally {
                        setIsAnkiAdding(false);
                    }
                }}
              >
                  {isAnkiAdding ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="plus-square" />}
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
      
      {/* Toast Notification */}
      {state.toastMessage && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-70 text-white px-4 py-2 rounded-full shadow-lg z-[60] animate-bounce-in">
              {state.toastMessage}
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
                        disabled={!state.ankiConnected || !state.dictionaryData || isAnkiAdding}
                        onClick={async () => {
                             if (!state.dictionaryData) return;
                             setIsAnkiAdding(true);
                             const def = formatDefinition(state.dictionaryData);
                             try {
                                 await controller.current?.addToAnki(state.selectedText, def, state.selectedSentence || state.selectedText);
                                 setState(s => ({...s, toastMessage: t('addedToAnki'), dictionaryModalVisible: false}));
                                 setTimeout(() => setState(s => ({...s, toastMessage: null})), 2000);
                             } catch(e: any) {
                                 alert(t('failed') + ': ' + e.message);
                             } finally {
                                 setIsAnkiAdding(false);
                             }
                        }}
                      >
                          {isAnkiAdding ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="plus"/>}
                          {t('addToAnki')}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}