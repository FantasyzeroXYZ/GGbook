

export interface Book {
    title: string;
    author: string;
}

export interface BookProgress {
    cfi: string;
    audioSrc?: string;
    audioTime?: number;
    timestamp: number;
}

export interface Bookmark {
    id: string;
    cfi: string;
    label: string;
    createdAt: number;
    // New: Audio state for bookmarks
    audioSrc?: string;
    audioTime?: number;
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

export interface AppSettings {
    language: 'en' | 'zh';
    fontSize: 'small' | 'medium' | 'large' | 'xlarge';
    theme: 'light' | 'dark' | 'sepia';
    layoutMode: 'single' | 'double'; // New: Single or Double page
    direction: 'horizontal' | 'vertical';
    offlineMode: boolean;
    syncProgress: boolean;
    darkMode: boolean;
    autoPlayAudio: boolean;
    syncTextHighlight: boolean;
    audioVolume: number;
}

export interface ReaderState {
    currentBook: Book | null;
    navigationMap: NavigationItem[];
    bookmarks: Bookmark[]; // New: Current bookmarks
    currentCfi: string;
    currentChapterLabel: string;
    isSidebarOpen: boolean;
    isSettingsOpen: boolean;
    isDarkMode: boolean;
    isLoading: boolean;
    loadingMessage: string;
    
    // 音频状态
    hasAudio: boolean; // New: Does the book have audio?
    isAudioPlaying: boolean;
    audioCurrentTime: number;
    audioDuration: number;
    audioTitle: string;
    audioList: string[];
    showAudioList: boolean;
    currentAudioFile?: string | null;
    
    // 词典/选词状态
    selectionToolbarVisible: boolean;
    selectionRect: DOMRect | null;
    selectedText: string;
    selectedSentence?: string; // New: Captured sentence context
    selectedElementId: string | null;
    dictionaryModalVisible: boolean;
    dictionaryData: any | null;
    dictionaryLoading: boolean;
    dictionaryError: string | null;

    // Anki 集成
    ankiConnected: boolean;
    ankiDecks: string[];
    ankiModels: string[];
    ankiFields: string[];

    // UI Feedback
    toastMessage: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
    language: 'zh',
    fontSize: 'medium',
    theme: 'light',
    layoutMode: 'single',
    direction: 'horizontal',
    offlineMode: false,
    syncProgress: true,
    darkMode: false,
    autoPlayAudio: true,
    syncTextHighlight: true,
    audioVolume: 80
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