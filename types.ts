
export interface Book {
    title: string;
    author: string;
}

export interface BookProgress {
    cfi: string;
    percentage?: number; // 0-1, reading progress
    audioSrc?: string;
    audioTime?: number;
    timestamp: number;
}

export interface Bookmark {
    id: string;
    cfi: string; // Start CFI or Range CFI
    type: 'bookmark' | 'highlight'; // New: Distinguish between page bookmark and highlight
    label: string; // Page number or Chapter name
    text?: string; // New: The actual highlighted text
    createdAt: number;
    audioSrc?: string;
    audioTime?: number;
    note?: string;
    color?: string; // hex code
}

// 书架中的书籍元数据
export interface LibraryBook {
    id: string;
    title: string;
    author: string;
    coverUrl?: string;
    addedAt: number;
    progress?: BookProgress;
    bookmarks?: Bookmark[];
}

export interface NavigationItem {
    id: string;
    href: string;
    label: string;
    subitems?: NavigationItem[];
}

export interface AnkiSettings {
    host: string;
    port: number;
    deck: string;
    model: string;
    wordField?: string; // Optional
    meaningField?: string; // Optional
    sentenceField?: string; // Optional
    audioField?: string; // New: Optional Audio Field
    tagsField: string;
}

// Dictionary Response Types
export interface DictionaryEntry {
    language?: string;
    partOfSpeech: string;
    phonetic?: string;
    pronunciations?: { text: string; audio?: string }[];
    senses: {
        definition: string;
        examples?: string[];
        synonyms?: string[];
        antonyms?: string[];
    }[];
}

export interface DictionaryResponse {
    word: string;
    entries: DictionaryEntry[];
}

export type UILanguage = 'en' | 'zh';
export type LearningLanguage = 'en' | 'zh' | 'ja' | 'es' | 'fr' | 'ru';

export interface AppSettings {
    language: UILanguage;
    dictionaryLanguage: LearningLanguage; 
    fontSize: 'small' | 'medium' | 'large' | 'xlarge';
    theme: 'light' | 'dark' | 'sepia';
    layoutMode: 'single' | 'double'; 
    direction: 'horizontal' | 'vertical';
    pageDirection: 'ltr' | 'rtl'; 
    offlineMode: boolean;
    syncProgress: boolean;
    darkMode: boolean;
    autoPlayAudio: boolean;
    syncTextHighlight: boolean;
    audioVolume: number;
    // TTS Settings
    ttsEnabled: boolean;
    ttsVoiceURI: string;
    // Dictionary Settings
    dictionaryMode: 'modal' | 'panel';
    // Library Settings
    libraryLayout: 'grid' | 'list'; // New: Library display mode
}

export interface ReaderState {
    currentBook: Book | null;
    navigationMap: NavigationItem[];
    bookmarks: Bookmark[]; 
    currentCfi: string;
    currentChapterLabel: string;
    isSidebarOpen: boolean;
    isSettingsOpen: boolean;
    isDarkMode: boolean;
    isLoading: boolean;
    loadingMessage: string;
    
    // 音频状态
    hasAudio: boolean; 
    isAudioPlaying: boolean;
    audioCurrentTime: number;
    audioDuration: number;
    audioTitle: string;
    audioList: string[];
    showAudioList: boolean;
    currentAudioFile?: string | null;
    
    // TTS 状态
    ttsVoices: SpeechSynthesisVoice[];
    
    // 词典/选词状态
    selectionToolbarVisible: boolean;
    selectionRect: DOMRect | null;
    selectedText: string;
    selectedSentence?: string; 
    selectedElementId: string | null;
    selectedCfiRange: string | null; 
    dictionaryModalVisible: boolean;
    dictionaryData: DictionaryResponse | null;
    dictionaryLoading: boolean;
    dictionaryError: string | null;
    
    // Script Dictionary (Tampermonkey)
    scriptTabContent: string | null;
    scriptTabLoading: boolean;
    scriptTabError: string | null;

    // Anki 集成
    ankiConnected: boolean;
    ankiDecks: string[];
    ankiModels: string[];
    ankiFields: string[];

    // UI Feedback
    toastMessage: string | null;
    
    // Bookmark Editing
    editingBookmarkId: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
    language: 'zh',
    dictionaryLanguage: 'en',
    fontSize: 'medium',
    theme: 'light',
    layoutMode: 'single',
    direction: 'horizontal',
    pageDirection: 'ltr', 
    offlineMode: false,
    syncProgress: true,
    darkMode: false,
    autoPlayAudio: true,
    syncTextHighlight: true,
    audioVolume: 80,
    ttsEnabled: false,
    ttsVoiceURI: '',
    dictionaryMode: 'panel',
    libraryLayout: 'grid'
};

export const DEFAULT_ANKI_SETTINGS: AnkiSettings = {
    host: '127.0.0.1',
    port: 8765,
    deck: '',
    model: '',
    wordField: '',
    meaningField: '',
    sentenceField: '',
    audioField: '',
    tagsField: 'epub-reader'
};

declare global {
    const ePub: any;
    const JSZip: any;
}
