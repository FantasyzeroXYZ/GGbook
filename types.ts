export interface Book {
    title: string;
    author: string;
}

export interface Chapter {
    id: string;
    title: string;
    content: string;
    href: string;
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
    wordField: string;
    meaningField: string;
    sentenceField: string;
    tagsField: string;
}

export interface AppSettings {
    fontSize: 'small' | 'medium' | 'large' | 'xlarge';
    theme: 'light' | 'dark' | 'sepia';
    offlineMode: boolean;
    syncProgress: boolean;
    darkMode: boolean;
    autoPlayAudio: boolean;
    syncTextHighlight: boolean;
    audioVolume: number;
}

export interface ReaderState {
    currentBook: Book | null;
    currentChapterIndex: number;
    chapters: Chapter[];
    navigationMap: NavigationItem[];
    currentSectionIndex: number;
    sections: string[]; // HTML strings of pages
    isSidebarOpen: boolean;
    isSettingsOpen: boolean;
    isDarkMode: boolean;
    isLoading: boolean;
    loadingMessage: string;
    
    // Audio State
    isAudioPlaying: boolean;
    audioCurrentTime: number;
    audioDuration: number;
    audioTitle: string;
    
    // Dictionary/Selection
    selectionToolbarVisible: boolean;
    selectionRect: DOMRect | null;
    selectedText: string;
    dictionaryModalVisible: boolean;
    dictionaryData: any | null;
    dictionaryLoading: boolean;
    dictionaryError: string | null;

    // Anki
    ankiConnected: boolean;
    ankiDecks: string[];
    ankiModels: string[];
    ankiFields: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
    fontSize: 'medium',
    theme: 'light',
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
    tagsField: 'epub-reader'
};

// Declare globals for libraries loaded via CDN
declare global {
    const ePub: any;
    const JSZip: any;
}