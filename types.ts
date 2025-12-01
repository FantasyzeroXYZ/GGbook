export interface Book {
    title: string;
    author: string;
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
    language: 'en' | 'zh';
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
    navigationMap: NavigationItem[];
    currentCfi: string; // Current location in book
    currentChapterLabel: string; // Display name of current chapter
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
    audioList: string[]; // List of audio files in order
    showAudioList: boolean; // Toggle for audio playlist UI
    
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
    language: 'zh',
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