
import React, { useEffect, useRef, useState } from 'react';
import { EpubController } from './lib/EpubController';
import { AnkiSettings, AppSettings, LibraryBook, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, ReaderState, BookProgress } from './types';
import { db } from './lib/db';
import { LibraryView } from './components/LibraryView';
import { ReaderView } from './components/ReaderView';
import { translations } from './lib/locales';

type ViewMode = 'library' | 'reader';

export default function App() {
  const [view, setView] = useState<ViewMode>('library');
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);

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
    
    // TTS State
    ttsVoices: [],

    selectionToolbarVisible: false,
    selectionRect: null,
    selectedText: '',
    selectedSentence: '',
    selectedElementId: null,
    selectedCfiRange: null,
    dictionaryModalVisible: false,
    dictionaryData: null,
    dictionaryLoading: false,
    dictionaryError: null,
    
    // Script Dictionary
    scriptTabContent: null,
    scriptTabLoading: false,
    scriptTabError: null,

    ankiConnected: false,
    ankiDecks: [],
    ankiModels: [],
    ankiFields: [],
    toastMessage: null,

    // Bookmark Editing
    editingBookmarkId: null
  });

  const [tempSettings, setTempSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [tempAnki, setTempAnki] = useState<AnkiSettings>(DEFAULT_ANKI_SETTINGS);

  const controller = useRef<EpubController | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  
  // Use a ref to track loading state for event listeners (closures)
  const isLoadingRef = useRef(state.isLoading);
  useEffect(() => { isLoadingRef.current = state.isLoading; }, [state.isLoading]);

  const t = translations[tempSettings.language || 'zh'];

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
        if (isLoadingRef.current) return; // 阻止加载时的键盘操作
        
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        
        // Handle RTL page direction for arrow keys
        if (c.settings.pageDirection === 'rtl') {
            if (e.key === 'ArrowLeft') c.nextPage();
            if (e.key === 'ArrowRight') c.prevPage();
        } else {
            if (e.key === 'ArrowLeft') c.prevPage();
            if (e.key === 'ArrowRight') c.nextPage();
        }
        
        if (e.key === ' ') { e.preventDefault(); c.toggleAudio(); }
    };

    window.addEventListener('keydown', handleKey);
    
    return () => {
        c.stopAudio();
        window.removeEventListener('keydown', handleKey);
    };
  }, [view]); // Add view dependency to ensure listener is current

  useEffect(() => {
      if (view !== 'reader' || !currentBookId) return;
      
      const saveTimer = setTimeout(() => {
          if (state.currentCfi && controller.current) {
              const percentage = controller.current.getCurrentPercentage();
              const progress: BookProgress = {
                  cfi: state.currentCfi,
                  percentage: percentage, // Ensure percentage is updated
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
          // 直接更新 controller 中的设置
          (controller.current.settings as any)[key] = val;
          controller.current.saveSettings();
          
          // 触发特定的更新逻辑
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
          } else if (key === 'pageDirection') {
              controller.current.setPageDirection(val);
          } else if (key === 'ttsVoiceURI') {
              controller.current.setTTSVoice(val);
          }
      }
  };

  const handleImportBook = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          setState(s => ({ ...s, isLoading: true, loadingMessage: t.opening }));
          
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
              alert(t.failed + ': ' + err.message);
              setState(s => ({ ...s, isLoading: false }));
          }
      }
  };

  const openBook = async (book: LibraryBook) => {
      setState(s => ({ ...s, isLoading: true, loadingMessage: t.opening }));
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

  // ===================== 书架视图 =====================
  if (view === 'library') {
      return (
          <LibraryView 
              state={state}
              libraryBooks={libraryBooks}
              openBook={openBook}
              deleteBook={deleteBook}
              handleImportBook={handleImportBook}
              updateSetting={updateSetting}
              tempSettings={tempSettings}
              onToggleSettings={() => setState(s => ({ ...s, isSettingsOpen: !s.isSettingsOpen }))}
              tempAnki={tempAnki}
              setTempAnki={setTempAnki}
              controller={controller}
          />
      );
  }

  // ===================== 阅读器视图 =====================
  return (
      <ReaderView 
          state={state}
          tempSettings={tempSettings}
          tempAnki={tempAnki}
          exitReader={exitReader}
          setState={setState}
          updateSetting={updateSetting}
          setTempAnki={setTempAnki}
          handleAddBookmark={handleAddBookmark}
          controller={controller}
          viewerRef={viewerRef}
          isAnkiAdding={isAnkiAdding}
          setIsAnkiAdding={setIsAnkiAdding}
          formatDefinition={formatDefinition}
      />
  );
}
