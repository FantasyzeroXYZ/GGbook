import { AnkiSettings, AppSettings, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState, BookProgress, Bookmark } from '../types';
import { translations, Language } from './locales';

type StateUpdater = (partialState: Partial<ReaderState>) => void;

export class EpubController {
    // 内部状态
    private book: any = null;
    private rendition: any = null;
    private state: ReaderState;
    private updateReactState: StateUpdater;
    
    // 设置
    public settings: AppSettings;
    public ankiSettings: AnkiSettings;
    
    // 音频
    private audioPlayer: HTMLAudioElement;
    private mediaOverlayData: any[] = [];
    private audioGroups: Map<string, any[]> = new Map();
    private currentAudioFile: string | null = null;
    private currentAudioIndex: number = -1;

    // TTS Logic
    private synth: SpeechSynthesis;
    private ttsUtterance: SpeechSynthesisUtterance | null = null;
    private ttsQueue: string[] = [];
    private isTTSActive: boolean = false;
    private isTurningPage: boolean = false; // Flag to prevent multiple turns

    // 音频处理 (MediaRecorder 方案)
    private mediaElementSource: MediaElementAudioSourceNode | null = null;
    private audioContext: AudioContext | null = null;
    
    // 引用
    private containerRef: HTMLElement | null = null;

    constructor(initialState: ReaderState, updateState: StateUpdater) {
        this.state = initialState;
        this.updateReactState = updateState;
        
        const savedSettings = localStorage.getItem('epubReaderSettings');
        this.settings = savedSettings ? JSON.parse(savedSettings) : { ...DEFAULT_SETTINGS };
        if (!this.settings.language) this.settings.language = 'zh';
        if (!this.settings.layoutMode) this.settings.layoutMode = 'single';
        if (!this.settings.theme) this.settings.theme = 'light';
        if (!this.settings.direction) this.settings.direction = 'horizontal';
        if (!this.settings.pageDirection) this.settings.pageDirection = 'ltr';
        if (this.settings.ttsEnabled === undefined) this.settings.ttsEnabled = false;

        const savedAnki = localStorage.getItem('epubReaderAnkiSettings');
        this.ankiSettings = savedAnki ? JSON.parse(savedAnki) : { ...DEFAULT_ANKI_SETTINGS };

        this.audioPlayer = new Audio();
        this.audioPlayer.crossOrigin = "anonymous";
        
        // Initialize TTS
        this.synth = window.speechSynthesis;
        
        // Fix: Robust voice loading
        this.loadVoices();
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.loadVoices();
        }
        // Retry for Chrome
        let attempts = 0;
        const voiceInterval = setInterval(() => {
            if (this.state.ttsVoices.length > 0 || attempts > 5) {
                clearInterval(voiceInterval);
            } else {
                this.loadVoices();
                attempts++;
            }
        }, 500);
        
        this.bindAudioEvents();
        this.setVolume(this.settings.audioVolume / 100);
        
        // 初始主题应用
        if (this.settings.darkMode) {
            document.body.style.backgroundColor = '#111827';
        } else {
             document.body.style.backgroundColor = this.settings.theme === 'sepia' ? '#f6f1d1' : '#f3f4f6';
        }
        
        this.setState({
            isDarkMode: this.settings.darkMode,
            ankiConnected: false,
            hasAudio: false,
            ttsVoices: []
        });
    }

    private setState(partial: Partial<ReaderState>) {
        this.state = { ...this.state, ...partial };
        this.updateReactState(partial);
    }

    private t(key: keyof typeof translations['en']) {
        const lang = this.settings.language || 'zh';
        return translations[lang][key];
    }

    // TTS: Load available voices
    private loadVoices() {
        const voices = this.synth.getVoices();
        if (voices.length > 0) {
            this.setState({ ttsVoices: voices });
        }
    }

    // TTS: Test current voice
    public testTTS() {
        if (this.synth.speaking) {
            this.synth.cancel();
        }
        const u = new SpeechSynthesisUtterance("Hello, this is a test for Text to Speech.");
        if (this.settings.language === 'zh') {
            u.text = "你好，这是语音合成测试。";
        }
        
        if (this.settings.ttsVoiceURI) {
            const voice = this.state.ttsVoices.find(v => v.voiceURI === this.settings.ttsVoiceURI);
            if (voice) u.voice = voice;
        }
        this.synth.speak(u);
    }

    // TTS: Set Voice
    public setTTSVoice(uri: string) {
        this.settings.ttsVoiceURI = uri;
        this.saveSettings();
    }

    // TTS: Toggle Logic
    public toggleTTS() {
        if (!this.settings.ttsEnabled) return;

        // If active, toggle pause/resume
        if (this.isTTSActive) {
            if (this.synth.paused) {
                this.synth.resume();
                this.setState({ isAudioPlaying: true });
            } else if (this.synth.speaking) {
                this.synth.pause();
                this.setState({ isAudioPlaying: false });
            } else {
                // Active but not speaking/paused? Restart
                this.playCurrentPageTTS();
            }
        } else {
            // Start reading current visible text
            this.playCurrentPageTTS();
        }
    }

    // TTS: Play Current Page with Highlighting
    private playCurrentPageTTS(startFromText?: string) {
        if (!this.rendition) return;
        
        // Clear previous highlights
        this.removeTTSHighlights();

        try {
            const location = this.rendition.currentLocation();
            let text = "";
            let contents: any = null;

            // Method 1: Try getting range via CFI (Most accurate for pagination)
            if (location && location.start && location.end) {
                contents = this.rendition.getContents()[0];
                if (contents) {
                    try {
                        const range = contents.range(location.start.cfi, location.end.cfi);
                        if (range) {
                            text = range.toString();
                        }
                    } catch (e) {
                        console.warn("CFI Range extraction failed, falling back to body text");
                    }
                }
            }

            // Method 2: Fallback to visible body text if range failed
            if ((!text || text.trim().length === 0) && contents) {
                text = contents.document.body.innerText;
            }
            
            if (!text || text.trim().length === 0) {
                // No text on this page
                // If we are auto-turning, try next page, otherwise stop
                if (this.isTTSActive && !this.isTurningPage) {
                     this.isTurningPage = true;
                     this.nextPage();
                } else {
                    alert("No text found on this page.");
                    this.stopAudio();
                }
                return;
            }

            // Clean and split text
            const cleanText = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
            // Split by sentence delimiters
            const sentences = cleanText.match(/[^.!?。！？]+[.!?。！？]+["'”’]?|.+$/g) || [cleanText];
            
            this.ttsQueue = sentences.map(s => s.trim()).filter(s => s.length > 0);
            
            // If starting from specific text (jump feature)
            if (startFromText) {
                // Try to find the sentence containing the selected text
                // Normalize jump text
                const normalizedJump = startFromText.trim().replace(/\s+/g, ' ');
                const jumpKey = normalizedJump.substring(0, Math.min(20, normalizedJump.length));
                
                const startIndex = this.ttsQueue.findIndex(s => s.includes(jumpKey));
                if (startIndex !== -1) {
                    this.ttsQueue = this.ttsQueue.slice(startIndex);
                }
            }

            if (this.ttsQueue.length === 0) return;

            this.isTTSActive = true;
            this.isTurningPage = false; // Reset turn flag on success

            // Reset selection to start of page to ensure find() works from top
            if (contents) {
                const sel = contents.window.getSelection();
                sel.removeAllRanges();
                const range = contents.document.createRange();
                range.selectNodeContents(contents.document.body);
                range.collapse(true);
                sel.addRange(range);
            }

            this.setState({ isAudioPlaying: true, audioTitle: "TTS Reading..." });
            this.playNextTTS();

        } catch (e) {
            console.error("Failed to extract text for TTS", e);
            this.stopAudio();
        }
    }

    private playNextTTS() {
        if (!this.isTTSActive) {
            this.stopAudio();
            return;
        }

        if (this.ttsQueue.length === 0) {
            // End of page, try to turn page
            this.removeTTSHighlights();
            if (!this.isTurningPage) {
                this.isTurningPage = true;
                this.nextPage(); 
            }
            return;
        }

        const sentence = this.ttsQueue.shift()!;
        this.removeTTSHighlights();

        const contents = this.rendition.getContents()[0];
        if (contents) {
            try {
                // Collapse selection to end of previous finding to continue search forward
                const sel = contents.window.getSelection();
                if (sel.rangeCount > 0) {
                    sel.collapseToEnd();
                }
                
                // Use window.find to locate the text range
                const found = contents.window.find(sentence, false, false, true, false, false, false);
                
                if (found) {
                    // Create highlight span using range surround
                    const range = sel.getRangeAt(0);
                    // Clear native blue selection visually
                    sel.removeAllRanges(); 

                    const span = contents.document.createElement('span');
                    span.className = 'audio-highlight';
                    // Inline styles as backup
                    span.style.backgroundColor = 'rgba(255, 255, 0, 0.4)';
                    span.style.borderRadius = '2px';
                    span.style.boxShadow = '0 0 2px rgba(255, 255, 0, 0.8)';
                    
                    try {
                        range.surroundContents(span);
                        // Scroll into view
                        span.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        
                        // Restore range for next search continuity
                        sel.addRange(range);
                        sel.collapseToEnd(); // Collapse to end of highlight
                    } catch (surroundError) {
                        // Fallback: re-select to show blue highlight if yellow fails
                        sel.addRange(range);
                    }
                } else {
                    // Fallback search for partial
                    const subSentence = sentence.substring(0, 20);
                    contents.window.find(subSentence, false, false, true, false, false, false);
                }
            } catch(e) { console.warn("Highlight error", e); }
        }

        // Cleanup previous utterance handlers
        if (this.ttsUtterance) {
            this.ttsUtterance.onend = null;
            this.ttsUtterance.onerror = null;
        }

        // Cancel any pending speech
        this.synth.cancel();

        this.ttsUtterance = new SpeechSynthesisUtterance(sentence);
        
        if (this.settings.ttsVoiceURI) {
            const voice = this.state.ttsVoices.find(v => v.voiceURI === this.settings.ttsVoiceURI);
            if (voice) this.ttsUtterance.voice = voice;
        }
        
        this.ttsUtterance.onend = () => {
            if (this.isTTSActive) {
                this.playNextTTS();
            }
        };
        
        this.ttsUtterance.onerror = (e: any) => {
            // Ignore interruption/cancellation errors which happen naturally
            if (e.error === 'canceled' || e.error === 'interrupted') {
                return;
            }
            console.error("TTS Error", e);
            // Don't recursive loop on error, just stop
            if (this.isTTSActive) {
                // Optional: try skipping to next sentence?
                // this.playNextTTS(); 
                this.stopAudio();
            }
        };

        this.synth.speak(this.ttsUtterance);
    }

    private removeTTSHighlights() {
        if (!this.rendition) return;
        const contents = this.rendition.getContents();
        contents.forEach((c: any) => {
            const doc = c.document;
            const highlights = doc.querySelectorAll('.audio-highlight');
            highlights.forEach((span: HTMLElement) => {
                const parent = span.parentNode;
                if (parent) {
                    while (span.firstChild) {
                        parent.insertBefore(span.firstChild, span);
                    }
                    parent.removeChild(span);
                    parent.normalize(); // Merge text nodes
                }
            });
            // Don't clear selection here, as we might need position for next search
        });
    }

    public mount(element: HTMLElement) {
        this.containerRef = element;
        if (this.book && !this.rendition) {
            this.renderBook();
        }
    }

    public destroy() {
        this.stopAudio();

        if (this.rendition) {
            try {
                this.rendition.destroy();
            } catch (e) { console.warn("Rendition destroy failed", e); }
            this.rendition = null;
        }
        if (this.book) {
            try {
                this.book.destroy();
            } catch (e) { console.warn("Book destroy failed", e); }
            this.book = null;
        }
        
        this.audioPlayer.pause();
        this.audioPlayer.removeAttribute('src');
        try {
            this.audioPlayer.load();
        } catch(e) {}

        this.mediaOverlayData = [];
        this.audioGroups.clear();
        this.currentAudioFile = null;
        this.currentAudioIndex = -1;
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
            this.mediaElementSource = null;
        }

        this.setState({
            isAudioPlaying: false,
            audioCurrentTime: 0,
            audioDuration: 0,
            audioTitle: '',
            audioList: [],
            hasAudio: false,
            showAudioList: false,
            currentAudioFile: null,
            selectionToolbarVisible: false
        });
    }

    // ... (loadFile and other methods) ...
    public async loadFile(file: File | Blob, initialProgress?: BookProgress, bookmarks: Bookmark[] = []) {
        try {
            this.destroy();
            this.setState({ isLoading: true, loadingMessage: this.t('opening'), bookmarks: bookmarks });
            
            this.book = ePub(file);
            await this.book.ready;

            this.book.locations.generate(1000).catch((e: any) => console.warn("Locations generation failed", e));

            const metadata = await this.book.loaded.metadata;
            const navigation = await this.book.loaded.navigation;
            
            this.setState({
                currentBook: { title: metadata.title, author: metadata.creator },
                navigationMap: navigation.toc || [],
                loadingMessage: this.t('rendering')
            });

            if (this.containerRef) {
                this.renderBook();
                try {
                    if (initialProgress && initialProgress.cfi) {
                        await this.display(initialProgress.cfi);
                    } else {
                        await this.display();
                    }
                } catch (renderError) {
                    console.error("Initial render failed", renderError);
                }
                this.applySettings();
            }

            this.setState({ isLoading: false });

            this.loadAudioFromEPUB().then(async () => {
                if (this.state.hasAudio) {
                    if (initialProgress && initialProgress.audioSrc) {
                        await this.playAudioFile(initialProgress.audioSrc, false);
                        if (initialProgress.audioTime) {
                            this.audioPlayer.currentTime = initialProgress.audioTime;
                            this.setState({ audioCurrentTime: initialProgress.audioTime });
                        }
                    } else if (this.state.audioList.length > 0) {
                        await this.playAudioFile(this.state.audioList[0], false);
                    }
                }
            }).catch(e => {
                console.warn('Audio parse warning:', e);
            });

        } catch (e: any) {
            console.error(e);
            this.setState({ isLoading: false });
            alert(this.t('failed') + ': ' + e.message);
        }
    }

    private renderBook() {
        if (!this.book || !this.containerRef) return;

        this.rendition = this.book.renderTo(this.containerRef, {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            manager: 'default',
            allowScriptedContent: true
        });

        this.rendition.themes.register('light', { body: { color: '#333 !important', background: '#fff !important' } });
        this.rendition.themes.register('dark', { body: { color: '#ddd !important', background: '#111 !important' } });
        this.rendition.themes.register('sepia', { body: { color: '#5f4b32 !important', background: '#f6f1d1 !important' } });
        
        this.rendition.themes.register('highlight', { 
            '.highlight': { 'background-color': 'rgba(255, 235, 59, 0.5)' } 
        });
        
        this.rendition.themes.register('audio-highlight', { 
            '.audio-highlight': { 
                'background-color': 'rgba(255, 255, 0, 0.4) !important', 
                'border-radius': '2px',
                'transition': 'background-color 0.3s'
            } 
        });

        this.rendition.hooks.content.register((contents: any) => {
             const style = contents.document.createElement('style');
             style.id = 'epub-reader-custom-style';
             let css = `
                html, body { 
                    -webkit-touch-callout: none !important;
                    -webkit-user-select: text !important;
                    user-select: text !important;
                    pointer-events: auto !important;
                }
                iframe { pointer-events: auto !important; }
                rt { user-select: none !important; -webkit-user-select: none !important; }
                ::selection { background: rgba(59, 130, 246, 0.3); }
                .audio-highlight { background-color: rgba(255, 255, 0, 0.4) !important; border-radius: 2px; }
             `;
             if (this.settings.direction === 'vertical') {
                 css += `html, body { writing-mode: vertical-rl !important; -webkit-writing-mode: vertical-rl !important; }`;
             } else {
                 css += `html, body { writing-mode: horizontal-tb !important; -webkit-writing-mode: horizontal-tb !important; }`;
             }
             style.innerHTML = css;
             contents.document.head.appendChild(style);
             contents.document.addEventListener('contextmenu', (e: Event) => {
                 e.preventDefault(); e.stopPropagation(); return false;
             }, false);
        });

        this.rendition.on('relocated', (location: any) => {
            this.setState({ currentCfi: location.start.cfi });
            // TTS Auto-turn logic: If active, start reading new page
            if (this.isTTSActive && this.settings.ttsEnabled && this.isTurningPage) {
                // Small delay to ensure render is settled
                setTimeout(() => {
                    this.isTurningPage = false; // Reset flag
                    this.playCurrentPageTTS();
                }, 1000);
            }
        });

        this.rendition.on('selected', (cfiRange: string, contents: any) => {
            const range = contents.range(cfiRange);
            const text = range.toString();
            
            let elementId = null;
            let node = range.commonAncestorContainer;
            if (node.nodeType !== 1) node = node.parentNode;
            while (node && node.nodeName !== 'BODY') {
                if (node.id) { elementId = node.id; break; }
                node = node.parentNode;
            }

            const rect = range.getBoundingClientRect();
            const iframe = this.containerRef?.querySelector('iframe');
            const iframeRect = iframe?.getBoundingClientRect();
            
            let sentence = text;
            try {
                const block = range.commonAncestorContainer.nodeType === 1 
                    ? range.commonAncestorContainer 
                    : range.commonAncestorContainer.parentNode;
                if (block && block.textContent) {
                    const sentences = block.textContent.split(/(?<=[.?!])\s+/);
                    for (const s of sentences) {
                        if (s.includes(text)) { sentence = s.trim(); break; }
                    }
                }
            } catch(e) { console.warn("Sentence extraction failed", e); }
            
            if (iframeRect && rect) {
                const absoluteRect = {
                    left: rect.left + iframeRect.left,
                    top: rect.top + iframeRect.top,
                    width: rect.width,
                    height: rect.height
                } as DOMRect; 
                this.setState({
                    selectionToolbarVisible: true,
                    selectionRect: absoluteRect,
                    selectedText: text,
                    selectedSentence: sentence,
                    selectedElementId: elementId
                });
            }
        });

        this.applySettings();
        this.setLayoutMode(this.settings.layoutMode);
    }

    public setLayoutMode(mode: 'single' | 'double') {
        this.settings.layoutMode = mode;
        this.saveSettings();
        if (this.rendition) {
            try { this.rendition.spread(mode === 'single' ? 'none' : 'auto'); } catch (e) { console.warn("Spread mode set failed", e); }
        }
    }

    public getCurrentPercentage(): number {
        if (!this.rendition || !this.book) return 0;
        const currentLocation = this.rendition.currentLocation();
        if (currentLocation && currentLocation.start) {
             if (this.book.locations && this.book.locations.length() > 0) {
                 return this.book.locations.percentageFromCfi(currentLocation.start.cfi);
             }
        }
        return 0;
    }

    public setDirection(direction: 'horizontal' | 'vertical') {
        this.settings.direction = direction;
        this.saveSettings();
        if (this.rendition) {
            const contents = this.rendition.getContents();
            if (contents && contents.length > 0) {
                contents.forEach((c: any) => {
                    const doc = c.document;
                    if (!doc) return;
                    let style = doc.getElementById('epub-reader-direction-style');
                    if (!style) {
                        style = doc.createElement('style');
                        style.id = 'epub-reader-direction-style';
                        doc.head.appendChild(style);
                    }
                    style.innerHTML = `
                        html, body { 
                            writing-mode: ${direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb'} !important; 
                            -webkit-writing-mode: ${direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb'} !important; 
                        }
                    `;
                });
                try {
                    if (typeof this.rendition.resize === 'function') {
                        requestAnimationFrame(() => { try { this.rendition.resize(); } catch(e) {} });
                    }
                } catch (e) { console.warn("Rendition resize failed:", e); }
            }
        }
    }

    public setPageDirection(dir: 'ltr' | 'rtl') {
        this.settings.pageDirection = dir;
        this.saveSettings();
        if (this.rendition) {
            try { this.rendition.direction(dir); } catch(e) { console.warn("Set direction failed", e); }
        }
    }

    public async addBookmark() {
        if (!this.rendition) return;
        const location = this.rendition.currentLocation();
        if (location && location.start) {
            let label = `Page ${location.start.displayed.page}`;
            const shouldRecordAudio = this.state.isAudioPlaying && this.currentAudioFile;
            const newBookmark: Bookmark = {
                id: new Date().getTime().toString(),
                cfi: location.start.cfi,
                label: label + ` (${new Date().toLocaleTimeString()})`,
                createdAt: Date.now(),
                audioSrc: shouldRecordAudio ? this.currentAudioFile! : undefined,
                audioTime: shouldRecordAudio ? this.audioPlayer.currentTime : undefined
            };
            const newBookmarks = [...this.state.bookmarks, newBookmark];
            this.setState({ bookmarks: newBookmarks });
            return newBookmarks;
        }
        return null;
    }

    public removeBookmark(id: string) {
        const newBookmarks = this.state.bookmarks.filter(b => b.id !== id);
        this.setState({ bookmarks: newBookmarks });
        return newBookmarks;
    }

    public async restoreBookmark(bookmark: Bookmark) {
        if (!this.rendition) return;
        await this.display(bookmark.cfi);
        if (bookmark.audioSrc && this.state.hasAudio) {
            await this.playAudioFile(bookmark.audioSrc, false);
            if (bookmark.audioTime !== undefined) {
                this.seekAudio(bookmark.audioTime);
                this.audioPlayer.pause();
                this.setState({ isAudioPlaying: false });
            }
        } else {
            if (this.state.isAudioPlaying) {
                this.audioPlayer.pause();
                this.setState({ isAudioPlaying: false });
            }
        }
    }

    public seekToElementId(elementId: string) {
        // TTS: Jump to text
        if (!this.state.hasAudio && this.settings.ttsEnabled && this.state.selectedText) {
            // Cleanup existing
            if (this.ttsUtterance) {
                this.ttsUtterance.onend = null;
                this.ttsUtterance.onerror = null;
            }
            this.synth.cancel();
            
            // Restart with selection
            this.playCurrentPageTTS(this.state.selectedText);
            this.setState({ selectionToolbarVisible: false });
            return;
        }

        if (!elementId) {
            alert(this.t('audioError'));
            return;
        }
        const fragment = this.mediaOverlayData.find(f => f.textSrc.endsWith('#' + elementId));
        if (fragment) {
            if (this.rendition) {
                this.display(fragment.textSrc).then(() => {
                    this.highlightElement(elementId);
                });
            }
            const playAndSeek = () => {
                this.seekAudio(this.parseTime(fragment.clipBegin));
                if (!this.state.isAudioPlaying) {
                    this.toggleAudio();
                }
            };
            if (this.currentAudioFile !== fragment.audioSrc) {
                this.playAudioFile(fragment.audioSrc, false).then(() => {
                    playAndSeek();
                });
            } else {
                playAndSeek();
            }
        } else {
            console.warn("No audio fragment found for ID:", elementId);
        }
    }
    
    public copySelection() {
        if (this.state.selectedText) {
            navigator.clipboard.writeText(this.state.selectedText).then(() => {
                this.setState({ toastMessage: "Copied!", selectionToolbarVisible: false });
                setTimeout(() => this.setState({ toastMessage: null }), 2000);
            }).catch(err => {
                console.error("Copy failed", err);
                alert("Copy failed");
            });
        }
    }

    public applySettings() {
        if (!this.rendition) return;
        this.setFontSize(this.settings.fontSize);
        const themeToApply = this.settings.darkMode ? 'dark' : this.settings.theme;
        this.updateThemeColors(themeToApply);
        this.setDirection(this.settings.direction);
        this.setPageDirection(this.settings.pageDirection);
    }

    public setFontSize(size: string) {
        this.settings.fontSize = size as any;
        this.saveSettings();
        if (this.rendition && this.rendition.themes) {
            try { this.rendition.themes.fontSize(this.getFontSizeValue(size)); } catch (e) { console.warn("Set font size failed:", e); }
        }
    }

    public setTheme(theme: string) {
        this.settings.theme = theme as any;
        this.saveSettings();
        if (!this.settings.darkMode) {
            this.updateThemeColors(theme);
        }
    }

    public toggleDarkMode(enabled: boolean) {
        this.settings.darkMode = enabled;
        this.saveSettings();
        if (enabled) {
            this.updateThemeColors('dark');
        } else {
            const targetTheme = this.settings.theme || 'light';
            this.updateThemeColors(targetTheme);
        }
    }
    
    private updateThemeColors(theme: string) {
        let bgColor = '#fff';
        let txtColor = '#333';
        if (theme === 'dark') {
            bgColor = '#111827';
            txtColor = '#ddd';
        } else if (theme === 'sepia') {
            bgColor = '#f6f1d1';
            txtColor = '#5f4b32';
        } else {
            bgColor = '#f3f4f6';
            txtColor = '#333';
        }
        document.body.style.backgroundColor = bgColor;
        if (this.rendition && this.rendition.themes) {
            try { this.rendition.themes.select(theme); } catch (e) { console.warn("Theme selection failed", e); }
            const contents = this.rendition.getContents();
            contents.forEach((c: any) => {
                const doc = c.document;
                const iframeBodyBg = theme === 'light' ? '#fff' : (theme === 'dark' ? '#111' : '#f6f1d1');
                doc.documentElement.style.backgroundColor = iframeBodyBg;
                doc.body.style.backgroundColor = iframeBodyBg;
                doc.body.style.color = txtColor;
                doc.body.style.cssText += `;background-color: ${iframeBodyBg} !important; color: ${txtColor} !important;`;
            });
        }
    }

    private getFontSizeValue(size: string) {
        switch(size) {
            case 'small': return '80%';
            case 'large': return '120%';
            case 'xlarge': return '150%';
            default: return '100%';
        }
    }

    public prevPage() {
        if (this.state.isLoading) return;
        if (this.rendition) {
            try { this.rendition.prev(); } catch(e) {}
        }
    }

    public nextPage() {
        if (this.state.isLoading) return;
        if (this.rendition) {
            try { this.rendition.next(); } catch(e) {}
        }
    }

    public async display(target?: string) {
        if (this.rendition) {
            try {
                await this.rendition.display(target);
            } catch(e) {
                console.warn("Display failed", e);
            }
        }
    }

    public highlightSelection() {
        if(!this.rendition) return;
        const selection = this.rendition.getContents()[0]?.window.getSelection();
        if(selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const span = document.createElement('span');
            span.style.backgroundColor = 'rgba(255, 235, 59, 0.5)';
            try {
                range.surroundContents(span);
                this.setState({ selectionToolbarVisible: false });
            } catch(e) {
                alert("Cannot highlight across block elements");
            }
        }
    }

    private bindAudioEvents() {
        this.audioPlayer.addEventListener('loadedmetadata', () => {
            this.setState({ audioDuration: this.audioPlayer.duration });
        });
        
        this.audioPlayer.addEventListener('timeupdate', () => {
            this.setState({ audioCurrentTime: this.audioPlayer.currentTime });
            if (this.settings.syncTextHighlight) {
                this.updateAudioHighlight();
            }
        });
        
        this.audioPlayer.addEventListener('ended', () => {
            this.playNextAudio();
        });
        
        this.audioPlayer.addEventListener('error', (e) => {
            if (!this.audioPlayer.src || this.audioPlayer.src === window.location.href || this.audioPlayer.src.endsWith('/')) {
                return;
            }
            console.error('Audio error event:', e);
            this.setState({ isAudioPlaying: false });
        });
    }

    public async updateAudioHighlight() {
        if (!this.state.isAudioPlaying || !this.currentAudioFile || !this.rendition) return;
        
        const frags = this.audioGroups.get(this.currentAudioFile);
        if (!frags) return;
        
        const time = this.audioPlayer.currentTime;
        const current = frags.find(f => {
            const start = this.parseTime(f.clipBegin);
            const end = this.parseTime(f.clipEnd);
            return time >= start && time < end;
        });

        if (current && current.originalIndex !== this.currentAudioIndex) {
            this.currentAudioIndex = current.originalIndex;
            const parts = current.textSrc.split('#');
            const id = parts.length > 1 ? parts[1] : null;
            
            if (id) {
                this.clearAudioHighlight();
                await this.display(current.textSrc);
                this.highlightElement(id);
            }
        }
    }
    
    private highlightElement(id: string) {
        if (!this.rendition) return;
        const contents = this.rendition.getContents();
        let found = false;
        
        for(const c of contents) {
            const el = c.document.getElementById(id);
            if (el) {
                el.classList.add('audio-highlight');
                el.style.backgroundColor = 'rgba(255, 255, 0, 0.4)';
                el.style.transition = 'background-color 0.3s';
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                found = true;
            }
        }
        
        if (!found) {
            setTimeout(() => this.highlightElement(id), 200);
        }
    }
    
    private clearAudioHighlight() {
         if(!this.rendition) return;
         const contents = this.rendition.getContents();
         for(const c of contents) {
             const els = c.document.querySelectorAll('.audio-highlight');
             els.forEach((el: HTMLElement) => {
                 el.classList.remove('audio-highlight');
                 el.style.backgroundColor = '';
             });
         }
    }

    private parseTime(t: string): number {
        if (!t) return 0;
        if (t.includes('s')) return parseFloat(t);
        if (t.includes(':')) {
            const parts = t.split(':').map(parseFloat);
            if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
            return parts[0]*60 + parts[1];
        }
        return parseFloat(t);
    }

    public toggleAudio() {
        if (!this.state.hasAudio && this.settings.ttsEnabled) {
            this.toggleTTS();
            return;
        }

        if (this.state.isAudioPlaying) {
            this.audioPlayer.pause();
            this.setState({ isAudioPlaying: false });
        } else {
            if (this.audioPlayer.src && this.audioPlayer.src !== window.location.href) {
                this.audioPlayer.play().catch(e => console.error("Play failed", e));
                this.setState({ isAudioPlaying: true });
            } else if (this.currentAudioFile) {
                this.playAudioFile(this.currentAudioFile);
            } else if (this.audioGroups.size > 0) {
                const first = this.audioGroups.keys().next().value;
                this.playAudioFile(first);
            }
        }
    }

    public toggleAudioList() {
        this.setState({ showAudioList: !this.state.showAudioList });
    }

    public playNextAudio() {
        const list = this.state.audioList;
        const current = this.currentAudioFile;
        if (!list || list.length === 0 || !current) {
            this.setState({ isAudioPlaying: false });
            return;
        }
        const idx = list.indexOf(current);
        if (idx !== -1 && idx < list.length - 1) {
            this.playAudioFile(list[idx + 1]);
        } else {
            this.setState({ isAudioPlaying: false });
        }
    }

    public stopAudio() {
        if (this.synth.speaking) {
            this.synth.cancel();
        }
        this.isTTSActive = false;
        this.ttsQueue = [];
        this.removeTTSHighlights();

        this.audioPlayer.pause();
        this.audioPlayer.currentTime = 0;
        this.setState({ isAudioPlaying: false, audioCurrentTime: 0 });
        this.clearAudioHighlight();
    }

    public seekAudio(time: number) {
        if (this.audioPlayer.src) this.audioPlayer.currentTime = time;
    }

    public seekAudioBy(seconds: number) {
        if (this.audioPlayer.src) {
            this.audioPlayer.currentTime = Math.max(0, Math.min(this.audioPlayer.duration, this.audioPlayer.currentTime + seconds));
        }
    }
    
    public playPrevSentence() {
        if (this.settings.ttsEnabled && this.isTTSActive) {
            // TTS previous sentence logic could be added here
            return;
        }

        if (!this.currentAudioFile) return;
        const frags = this.audioGroups.get(this.currentAudioFile);
        if (!frags || frags.length === 0) return;
        const time = this.audioPlayer.currentTime;
        let idx = -1;
        idx = frags.findIndex(f => {
            const s = this.parseTime(f.clipBegin);
            const e = this.parseTime(f.clipEnd);
            return time >= s && time < e;
        });
        if (idx === -1) {
             for (let i = frags.length - 1; i >= 0; i--) {
                 if (this.parseTime(frags[i].clipBegin) < time) {
                     idx = i;
                     break;
                 }
             }
        }
        if (idx > 0) {
             this.seekAudio(this.parseTime(frags[idx - 1].clipBegin));
        } else if (frags.length > 0) {
             this.seekAudio(this.parseTime(frags[0].clipBegin));
        }
    }

    public playNextSentence() {
        if (this.settings.ttsEnabled && this.isTTSActive) {
            return;
        }

        if (!this.currentAudioFile) return;
        const frags = this.audioGroups.get(this.currentAudioFile);
        if (!frags || frags.length === 0) return;
        const time = this.audioPlayer.currentTime;
        const next = frags.find(f => this.parseTime(f.clipBegin) > time + 0.2);
        if (next) {
            this.seekAudio(this.parseTime(next.clipBegin));
        }
    }

    public setVolume(val: number) {
        this.audioPlayer.volume = Math.max(0, Math.min(1, val));
        this.settings.audioVolume = val * 100;
        this.saveSettings();
    }

    private async loadAudioFromEPUB() {
        if (!this.book) return;
        const manifest = await this.book.loaded.manifest;
        const smilItems = Object.values(manifest).filter((item: any) => {
            if (!item || !item.href) return false;
            const type = (item['media-type'] || item.type || '').toLowerCase();
            return type.includes('smil') || item.href.endsWith('.smil');
        });
        this.mediaOverlayData = [];
        for (const item of smilItems) {
            const res = await this.processSmil(item);
            if (res.length) this.mediaOverlayData.push(...res);
        }
        this.audioGroups.clear();
        this.mediaOverlayData.forEach((frag, idx) => {
            const file = frag.audioSrc;
            if (!this.audioGroups.has(file)) this.audioGroups.set(file, []);
            this.audioGroups.get(file)!.push({ ...frag, originalIndex: idx });
        });
        const audioList = Array.from(this.audioGroups.keys());
        const hasAudio = audioList.length > 0;
        this.setState({ audioList, hasAudio });
    }

    private async processSmil(item: any) {
        try {
            let text = '';
            try {
                const doc = await this.book.load(item.href);
                if (doc instanceof Blob) text = await doc.text();
                else if (typeof doc === 'string') text = doc;
                else if (doc && doc.documentElement) text = new XMLSerializer().serializeToString(doc);
            } catch(e) {
                text = await this.book.archive.getText(item.href);
            }
            if (!text) return [];
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'application/xml');
            if (xml.querySelector('parsererror')) return [];
            const pars = xml.getElementsByTagName('par');
            const fragments: any[] = [];
            for(let i=0; i<pars.length; i++) {
                const par = pars[i];
                const t = par.getElementsByTagName('text')[0];
                const a = par.getElementsByTagName('audio')[0];
                if (t && a) {
                    const textSrc = this.resolvePath(t.getAttribute('src'), item.href);
                    const audioSrc = this.resolvePath(a.getAttribute('src'), item.href);
                    const clipBegin = a.getAttribute('clipBegin') || a.getAttribute('clip-begin');
                    const clipEnd = a.getAttribute('clipEnd') || a.getAttribute('clip-end');
                    if (textSrc && audioSrc) fragments.push({ textSrc, audioSrc, clipBegin, clipEnd });
                }
            }
            return fragments;
        } catch (e) { return []; }
    }

    private resolvePath(rel: string | null, base: string) {
        if (!rel) return '';
        if (rel.startsWith('/')) return rel;
        const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
        const stack = baseDir.split('/').filter(x => x && x !== '.');
        const parts = rel.split('/').filter(x => x && x !== '.');
        for (const p of parts) {
            if (p === '..') { if (stack.length > 0) stack.pop(); }
            else stack.push(p);
        }
        return stack.join('/');
    }

    private async findAudioBlob(path: string): Promise<string | null> {
        try {
             let blob = await this.book.archive.getBlob(path);
             if (blob) return URL.createObjectURL(blob);
        } catch(e) {}
        if (this.book.container && this.book.container.packagePath) {
             const pkgPath = this.book.container.packagePath;
             const pkgDir = pkgPath.substring(0, pkgPath.lastIndexOf('/'));
             if (pkgDir) {
                 const absPath = `/${pkgDir}/${path.startsWith('/') ? path.slice(1) : path}`;
                 try {
                     const blob = await this.book.archive.getBlob(absPath);
                     if (blob) return URL.createObjectURL(blob);
                 } catch(e) {}
             }
        }
        try {
            const p = path.startsWith('/') ? path : '/' + path;
            const blob = await this.book.archive.getBlob(p);
            if (blob) return URL.createObjectURL(blob);
        } catch(e) {}
        if (this.book.archive && this.book.archive.zip && this.book.archive.zip.files) {
             const targetName = path.split('/').pop()?.toLowerCase();
             if (targetName) {
                 const entries = Object.keys(this.book.archive.zip.files);
                 const match = entries.find(e => e.toLowerCase().endsWith('/' + targetName) || e.toLowerCase() === targetName);
                 if (match) {
                     const fileObj = this.book.archive.zip.files[match];
                     if (fileObj) {
                         try {
                             const blob = await fileObj.async('blob');
                             const ext = targetName.split('.').pop();
                             let mime = 'application/octet-stream';
                             if (ext === 'mp3') mime = 'audio/mpeg';
                             if (ext === 'm4a' || ext === 'mp4') mime = 'audio/mp4';
                             if (ext === 'ogg') mime = 'audio/ogg';
                             if (ext === 'wav') mime = 'audio/wav';
                             return URL.createObjectURL(new Blob([blob], { type: mime }));
                         } catch(e) {}
                     }
                 }
             }
        }
        return null;
    }

    public async playAudioFile(audioPath: string, autoPlay: boolean = true) {
        try {
            this.currentAudioFile = audioPath;
            const url = await this.findAudioBlob(audioPath);
            if (url) {
                this.audioPlayer.src = url;
                const title = audioPath.split('/').pop() || 'Audio';
                if (autoPlay) {
                    this.audioPlayer.play().catch(e => console.error('Play failed', e));
                    this.setState({ isAudioPlaying: true, audioTitle: title, currentAudioFile: audioPath });
                } else {
                    this.setState({ isAudioPlaying: false, audioTitle: title, currentAudioFile: audioPath });
                }
            } else {
                console.error("Audio not found:", audioPath);
                this.setState({ audioTitle: this.t('audioError'), currentAudioFile: audioPath });
            }
        } catch (e) { console.error("Play error", e); }
    }

    private async captureAudioSegment(start: number, end: number): Promise<{base64: string, extension: string}> {
        const duration = (end - start) * 1000;
        if (duration <= 0) throw new Error("Invalid duration");
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
        if (!this.mediaElementSource) {
            try {
                this.mediaElementSource = this.audioContext.createMediaElementSource(this.audioPlayer);
                this.mediaElementSource.connect(this.audioContext.destination);
            } catch (e) { console.error("Source creation failed", e); }
        }
        if (!this.mediaElementSource) throw new Error("Audio source unavailable");
        const dest = this.audioContext.createMediaStreamDestination();
        this.mediaElementSource.connect(dest);
        let mimeType = "audio/webm;codecs=opus";
        let extension = "webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = "audio/mp4"; extension = "m4a";
            if (!MediaRecorder.isTypeSupported(mimeType)) { mimeType = ""; extension = "webm"; }
        }
        const options = mimeType ? { mimeType } : undefined;
        let recorder: MediaRecorder;
        try { recorder = new MediaRecorder(dest.stream, options); } catch (e) { 
             this.mediaElementSource.disconnect(dest); throw new Error("Recorder init failed"); 
        }
        const chunks: Blob[] = [];
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => { cleanup(); reject(new Error("Recording timeout")); }, duration + 5000);
            const cleanup = () => {
                clearTimeout(timeoutId);
                try { if (recorder.state !== 'inactive') recorder.stop(); } catch(e){}
                try { this.mediaElementSource?.disconnect(dest); } catch(e){}
            };
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = async () => {
                 cleanup();
                 const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                 const reader = new FileReader();
                 reader.onloadend = () => {
                     const base64 = (reader.result as string).split(',')[1];
                     resolve({ base64, extension });
                 };
                 reader.onerror = reject;
                 reader.readAsDataURL(blob);
            };
            recorder.onerror = (e) => { cleanup(); reject(e); };
            this.audioPlayer.currentTime = start;
            this.audioPlayer.play().then(() => {
                try {
                    recorder.start();
                    setTimeout(() => { if (recorder.state === 'recording') { recorder.stop(); this.audioPlayer.pause(); } }, duration);
                } catch (e) { cleanup(); reject(e); }
            }).catch((e) => { cleanup(); reject(e); });
        });
    }

    public async lookupWord(word: string) {
        if (!word) return;
        this.setState({ dictionaryModalVisible: true, dictionaryLoading: true, dictionaryError: null, selectedText: word });
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
            if (!res.ok) throw new Error('Word not found');
            const data = await res.json();
            this.setState({ dictionaryData: data[0], dictionaryLoading: false });
        } catch (e: any) {
            this.setState({ dictionaryError: e.message, dictionaryLoading: false });
        }
    }
    
    public async testAnki() {
         try {
             const res = await this.ankiRequest('version');
             if (res) {
                 const decks = await this.ankiRequest('deckNames');
                 const models = await this.ankiRequest('modelNames');
                 this.setState({ ankiConnected: true, ankiDecks: decks || [], ankiModels: models || [] });
                 return true;
             }
         } catch(e) { this.setState({ ankiConnected: false }); return false; }
         return false;
    }

    public async loadAnkiFields(modelName: string) {
        if (!modelName) return;
        const fields = await this.ankiRequest('modelFieldNames', { modelName });
        this.setState({ ankiFields: fields || [] });
    }

    private async ankiRequest(action: string, params = {}) {
        const { host, port } = this.ankiSettings;
        const res = await fetch(`http://${host}:${port}`, {
            method: 'POST', body: JSON.stringify({ action, version: 6, params })
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        return json.result;
    }

    public async addToAnki(word: string, meaning: string, sentence: string) {
        const { deck, model, wordField, meaningField, sentenceField, audioField, tagsField } = this.ankiSettings;
        if (!deck || !model) throw new Error(this.t('ankiFieldsConfigError'));
        if (!wordField && !meaningField && !sentenceField && !audioField) throw new Error(this.t('ankiFieldsConfigError'));
        const fields: Record<string, string> = {};
        if (wordField) fields[wordField] = word;
        if (meaningField) fields[meaningField] = meaning;
        if (sentenceField && sentence) {
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const boldedSentence = sentence.replace(new RegExp(`(${escapedWord})`, 'gi'), '<b>$1</b>');
            fields[sentenceField] = boldedSentence;
        }
        const note: any = { deckName: deck, modelName: model, fields: fields, tags: tagsField.split(',').map(t => t.trim()) };
        if (audioField && this.currentAudioFile) {
            let fragment = null;
            if (this.state.selectedElementId) fragment = this.mediaOverlayData.find(f => f.textSrc.endsWith('#' + this.state.selectedElementId));
            if (!fragment && this.state.isAudioPlaying) {
                 const frags = this.audioGroups.get(this.currentAudioFile);
                 const time = this.audioPlayer.currentTime;
                 if (frags) fragment = frags.find(f => {
                        const start = this.parseTime(f.clipBegin);
                        const end = this.parseTime(f.clipEnd);
                        return time >= start && time < end;
                    });
            }
            if (fragment && fragment.audioSrc === this.currentAudioFile) {
                 try {
                     const start = this.parseTime(fragment.clipBegin);
                     const end = this.parseTime(fragment.clipEnd);
                     const duration = end - start;
                     if (duration > 0) {
                         const { base64, extension } = await this.captureAudioSegment(start, end);
                         const filename = `anki_${new Date().getTime()}.${extension}`;
                         note.audio = [{ url: "", data: base64, filename: filename, fields: [audioField] }];
                     }
                 } catch (e) { console.error("Audio recording failed", e); }
            }
        }
        return await this.ankiRequest('addNote', { note });
    }
    
    public saveSettings() { localStorage.setItem('epubReaderSettings', JSON.stringify(this.settings)); }
    public saveAnkiSettings() { localStorage.setItem('epubReaderAnkiSettings', JSON.stringify(this.ankiSettings)); }
}