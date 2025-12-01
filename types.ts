
export interface Book {
    title: string;
    author: string;
}

// 书架中的书籍元数据
export interface LibraryBook {
    id: string;
    title: string;
    author: string;
    coverUrl?: string; // 封面图片的 blob URL 或 base64
    addedAt: number;
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
    currentCfi: string; // 书籍当前位置
    currentChapterLabel: string; // 当前章节显示名称
    isSidebarOpen: boolean;
    isSettingsOpen: boolean;
    isDarkMode: boolean;
    isLoading: boolean;
    loadingMessage: string;
    
    // 音频状态
    isAudioPlaying: boolean;
    audioCurrentTime: number;
    audioDuration: number;
    audioTitle: string;
    audioList: string[]; // 按顺序的音频文件列表
    showAudioList: boolean; // 切换音频列表 UI
    
    // 词典/选择
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

// 声明全局变量（通过 CDN 加载的库）
declare global {
    const ePub: any;
    const JSZip: any;
}
