import { AnkiSettings, AppSettings, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState, BookProgress, Bookmark } from '../types';
import { translations, Language } from './locales';

type StateUpdater = (partialState: Partial<ReaderState>) => void;

export class EpubController {
    // 内部状态
    private book: any = null;
    private rendition: any = null;
    private state: ReaderState;
    private updateReactState: StateUpdater;
    
    // 初始化队列
    private pendingProgress: BookProgress | undefined;
    private pendingBookmarks: Bookmark[] = [];
    
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
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimeout: any = null;

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
        
        this.bindAudioEvents();
        this.setVolume(this.settings.audioVolume / 100);

        // Bind script handler
        this.handleScriptMessage = this.handleScriptMessage.bind(this);
        window.addEventListener('message', this.handleScriptMessage);
        
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
            ttsVoices: [],
            editingBookmarkId: null
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

    private loadVoices() {
        const voices = this.synth.getVoices();
        if (voices.length > 0) {
            this.setState({ ttsVoices: voices });
        }
    }

    public testTTS() {
        if (this.synth.speaking) this.synth.cancel();
        const u = new SpeechSynthesisUtterance(this.settings.language === 'zh' ? "你好，这是语音合成测试。" : "Hello, this is a test for Text to Speech.");
        if (this.settings.ttsVoiceURI) {
            const voice = this.state.ttsVoices.find(v => v.voiceURI === this.settings.ttsVoiceURI);
            if (voice) u.voice = voice;
        }
        this.synth.speak(u);
    }

    public setTTSVoice(uri: string) {
        this.settings.ttsVoiceURI = uri;
        this.saveSettings();
    }

    public toggleTTS() {
        if (!this.settings.ttsEnabled) return;
        if (this.isTTSActive) {
            if (this.synth.paused) {
                this.synth.resume();
                this.setState({ isAudioPlaying: true });
            } else if (this.synth.speaking) {
                this.synth.pause();
                this.setState({ isAudioPlaying: false });
            } else {
                this.playCurrentPageTTS();
            }
        } else {
            this.playCurrentPageTTS();
        }
    }

    private playCurrentPageTTS(startFromText?: string) {
        if (!this.rendition) return;
        this.removeTTSHighlights();
        try {
            const location = this.rendition.currentLocation();
            let text = "";
            let contents = this.rendition.getContents()[0];
            if (location && location.start && location.end && contents) {
                try {
                    const range = contents.range(location.start.cfi, location.end.cfi);
                    if (range) text = range.toString();
                } catch (e) {}
            }
            if ((!text || text.trim().length === 0) && contents) text = contents.document.body.innerText;
            if (!text || text.trim().length === 0) {
                if (this.isTTSActive && !this.isTurningPage) this.performTTSPageTurn();
                else { alert("No text found on this page."); this.stopAudio(); }
                return;
            }
            const cleanText = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
            const sentences = cleanText.match(/[^.!?。！？]+[.!?。！？]+["'”’]?|.+$/g) || [cleanText];
            this.ttsQueue = sentences.map(s => s.trim()).filter(s => s.length > 0);
            if (startFromText) {
                const normalizedJump = startFromText.trim().replace(/\s+/g, ' ');
                const jumpKey = normalizedJump.substring(0, Math.min(20, normalizedJump.length));
                const startIndex = this.ttsQueue.findIndex(s => s.includes(jumpKey));
                if (startIndex !== -1) this.ttsQueue = this.ttsQueue.slice(startIndex);
            }
            if (this.ttsQueue.length === 0) return;
            this.isTTSActive = true;
            this.isTurningPage = false;
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
        } catch (e) { console.error("TTS Failed", e); this.stopAudio(); }
    }

    private playNextTTS() {
        if (!this.isTTSActive) { this.stopAudio(); return; }
        if (this.ttsQueue.length === 0) {
            this.removeTTSHighlights();
            if (!this.isTurningPage) this.performTTSPageTurn();
            return;
        }
        const sentence = this.ttsQueue.shift()!;
        this.removeTTSHighlights();
        const contents = this.rendition.getContents()[0];
        if (contents) {
            try {
                const sel = contents.window.getSelection();
                if (sel.rangeCount > 0) sel.collapseToEnd();
                const found = contents.window.find(sentence, false, false, true, false, false, false);
                if (found) {
                    const range = sel.getRangeAt(0);
                    const span = contents.document.createElement('span');
                    span.className = 'audio-highlight';
                    span.style.backgroundColor = 'rgba(255, 255, 0, 0.4)';
                    span.style.borderRadius = '2px';
                    span.style.pointerEvents = 'none'; 
                    try {
                        range.surroundContents(span);
                        span.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        sel.removeAllRanges(); 
                        const newRange = contents.document.createRange();
                        newRange.selectNode(span);
                        newRange.collapse(false);
                        sel.addRange(newRange);
                    } catch (surroundError) {}
                }
            } catch(e) {}
        }
        if (this.ttsUtterance) { this.ttsUtterance.onend = null; this.ttsUtterance.onerror = null; }
        this.synth.cancel();
        this.ttsUtterance = new SpeechSynthesisUtterance(sentence);
        if (this.settings.ttsVoiceURI) {
            const voice = this.state.ttsVoices.find(v => v.voiceURI === this.settings.ttsVoiceURI);
            if (voice) this.ttsUtterance.voice = voice;
        }
        this.ttsUtterance.onend = () => { if (this.isTTSActive) this.playNextTTS(); };
        this.ttsUtterance.onerror = (e: any) => { if (e.error !== 'canceled') this.stopAudio(); };
        this.synth.speak(this.ttsUtterance);
    }

    private async performTTSPageTurn() {
        if (!this.rendition || this.isTurningPage) return;
        this.isTurningPage = true;
        try {
            await this.rendition.next();
            this.syncLayout();
            setTimeout(() => {
                this.isTurningPage = false;
                if (this.isTTSActive) this.playCurrentPageTTS();
            }, 1000);
        } catch(e) { this.stopAudio(); this.isTurningPage = false; }
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
                    while (span.firstChild) parent.insertBefore(span.firstChild, span);
                    parent.removeChild(span);
                    parent.normalize();
                }
            });
        });
    }

    /**
     * 强力同步布局：强制触发 epubjs 和浏览器的重绘逻辑
     */
    private syncLayout() {
        if (!this.rendition) return;
        requestAnimationFrame(() => {
            try {
                this.rendition.resize();
                // 关键补丁：分发全局 resize 事件让 epubjs 内部的分页逻辑重新校验
                window.dispatchEvent(new Event('resize'));
            } catch (e) {}
        });
    }

    public async mount(element: HTMLElement) {
        this.containerRef = element;

        // 设置 ResizeObserver 并增加更积极的防抖处理，彻底解决重新打开时的空白问题
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.resizeObserver = new ResizeObserver((entries) => {
            if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                this.syncLayout();
            }, 100);
        });
        this.resizeObserver.observe(element);

        if (this.book && !this.rendition) {
            await this.renderBookAndDisplay();
        } else if (this.rendition) {
            // 立即并延迟触发两次同步，确保动画结束后布局正确
            this.syncLayout();
            setTimeout(() => this.syncLayout(), 300);
        }
    }

    public destroy() {
        this.stopAudio();
        window.removeEventListener('message', this.handleScriptMessage);
        if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);

        if (this.rendition) {
            try { this.rendition.destroy(); } catch (e) {}
            this.rendition = null;
        }
        if (this.book) {
            try { this.book.destroy(); } catch (e) {}
            this.book = null;
        }
        this.audioPlayer.pause();
        this.audioPlayer.removeAttribute('src');
        this.pendingProgress = undefined;
        this.pendingBookmarks = [];
        if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }

        this.setState({
            isAudioPlaying: false,
            audioCurrentTime: 0,
            audioDuration: 0,
            audioTitle: '',
            audioList: [],
            hasAudio: false,
            showAudioList: false,
            currentAudioFile: null,
            selectionToolbarVisible: false,
            editingBookmarkId: null
        });
    }

    public async loadFile(file: File | Blob, initialProgress?: BookProgress, bookmarks: Bookmark[] = []) {
        try {
            this.destroy();
            this.setState({ isLoading: true, loadingMessage: this.t('opening'), bookmarks: bookmarks });
            this.book = ePub(file);
            this.pendingProgress = initialProgress;
            this.pendingBookmarks = bookmarks;
            await this.book.ready;
            await this.book.loaded.spine;
            this.book.locations.generate(1000).catch(() => {});
            const metadata = await this.book.loaded.metadata;
            const navigation = await this.book.loaded.navigation;
            this.setState({
                currentBook: { title: metadata.title, author: metadata.creator },
                navigationMap: navigation.toc || [],
                loadingMessage: this.t('rendering')
            });
            if (this.containerRef) await this.renderBookAndDisplay();
            this.setState({ isLoading: false });
            this.loadAudioFromEPUB().then(async () => {
                if (this.state.hasAudio) {
                    if (initialProgress && initialProgress.audioSrc) {
                        await this.playAudioFile(initialProgress.audioSrc, false);
                        if (initialProgress.audioTime) this.audioPlayer.currentTime = initialProgress.audioTime;
                    } else if (this.state.audioList.length > 0) {
                        await this.playAudioFile(this.state.audioList[0], false);
                    }
                }
            }).catch(() => {});
        } catch (e: any) {
            console.error(e);
            this.setState({ isLoading: false });
            alert(this.t('failed') + ': ' + e.message);
        }
    }

    private async renderBookAndDisplay() {
        if (!this.book || !this.containerRef) return;
        this.containerRef.innerHTML = '';
        this.rendition = this.book.renderTo(this.containerRef, {
            width: '100%', height: '100%', flow: 'paginated', manager: 'default', allowScriptedContent: true
        });
        this.registerThemesAndHooks();
        
        // 关键：监听渲染完成事件，再次同步布局
        this.rendition.on('displayed', () => {
            this.syncLayout();
            // 普通书籍需要更长时间处理样式导致的重排
            setTimeout(() => this.syncLayout(), 500);
        });

        try {
            await this.safeDisplay(this.pendingProgress?.cfi);
            this.restoreHighlights(this.pendingBookmarks);
            this.applySettings();
            this.pendingProgress = undefined;
            this.pendingBookmarks = [];
            
            // 多次延迟触发确保布局彻底稳定
            setTimeout(() => this.syncLayout(), 100);
            setTimeout(() => this.syncLayout(), 800);
            setTimeout(() => this.syncLayout(), 2000);
        } catch (renderError) { console.error(renderError); }
    }

    private async safeDisplay(target?: string) {
        if (!this.rendition) return;
        if (this.book?.loaded?.spine) await this.book.loaded.spine;
        try {
            await this.rendition.display(target || undefined);
        } catch (e) {
            try { await this.rendition.display(); } catch (retryError) {
                if (this.book.spine && this.book.spine.length > 0) await this.rendition.display(this.book.spine.get(0).href);
            }
        }
    }

    private getHighlightStyle(color: string) {
        return { fill: color || '#FFEB3B', fillOpacity: '0.4', mixBlendMode: 'normal' };
    }

    private restoreHighlights(bookmarks: Bookmark[]) {
        if (!this.rendition) return;
        bookmarks.filter(b => b.type === 'highlight').forEach(bm => {
            try {
                this.rendition.annotations.add('highlight', bm.cfi, this.getHighlightStyle(bm.color || '#FFEB3B'), undefined, 'highlight-' + bm.id);
            } catch (e) {}
        });
    }

    private registerThemesAndHooks() {
        if (!this.rendition) return;

        this.rendition.themes.register('light', { body: { color: '#333 !important', background: '#fff !important' } });
        this.rendition.themes.register('dark', { body: { color: '#ddd !important', background: '#111 !important' } });
        this.rendition.themes.register('sepia', { body: { color: '#5f4b32 !important', background: '#f6f1d1 !important' } });
        this.rendition.themes.register('highlight', { '.highlight': { 'opacity': '1' } });
        
        this.rendition.hooks.content.register((contents: any) => {
             const style = contents.document.createElement('style');
             style.id = 'epub-reader-custom-style';
             let css = `
                html, body { -webkit-touch-callout: none !important; -webkit-user-select: text !important; user-select: text !important; pointer-events: auto !important; height: 100% !important; }
                iframe { pointer-events: auto !important; }
                rt { user-select: none !important; -webkit-user-select: none !important; }
                ::selection { background: rgba(59, 130, 246, 0.3); }
                .audio-highlight { background-color: rgba(255, 255, 0, 0.4) !important; border-radius: 2px; }
             `;
             css += this.settings.direction === 'vertical' ? `html, body { writing-mode: vertical-rl !important; -webkit-writing-mode: vertical-rl !important; }` : `html, body { writing-mode: horizontal-tb !important; -webkit-writing-mode: horizontal-tb !important; }`;
             style.innerHTML = css;
             contents.document.head.appendChild(style);
             
             // 解决工具栏不自动关闭的问题：监听 iframe 内的点击
             contents.document.addEventListener('click', (e: MouseEvent) => {
                 const sel = contents.window.getSelection();
                 if (!sel || sel.isCollapsed || !sel.toString().trim()) {
                     this.setState({ selectionToolbarVisible: false, selectionRect: null });
                 }
             });

             contents.document.addEventListener('contextmenu', (e: Event) => { e.preventDefault(); e.stopPropagation(); }, false);
             
             // 为普通书籍增加渲染后的重排触发
             setTimeout(() => this.syncLayout(), 100);
        });

        this.rendition.on('relocated', (location: any) => {
            this.setState({ currentCfi: location.start.cfi });
            // 如果页面跳转后发现选区消失，静默关闭工具栏
            const contents = this.rendition.getContents()[0];
            if (contents) {
                const sel = contents.window.getSelection();
                if (!sel || sel.isCollapsed) {
                    this.setState({ selectionToolbarVisible: false, selectionRect: null });
                }
            }
        });

        this.rendition.on('selected', (cfiRange: string, contents: any) => {
            const range = contents.range(cfiRange);
            const text = range.toString();
            if (!text || text.trim().length === 0) {
                 this.setState({ selectionToolbarVisible: false, selectionRect: null });
                 return;
            }
            
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
            if (iframeRect && rect) {
                const absoluteRect = { left: rect.left + iframeRect.left, top: rect.top + iframeRect.top, width: rect.width, height: rect.height } as DOMRect; 
                this.setState({
                    selectionToolbarVisible: true, selectionRect: absoluteRect, selectedText: text,
                    selectedSentence: text, // Simplified context capture
                    selectedElementId: elementId, selectedCfiRange: cfiRange
                });
            }
        });
    }

    public setLayoutMode(mode: 'single' | 'double') {
        this.settings.layoutMode = mode;
        this.saveSettings();
        if (this.rendition) {
            try { 
                this.rendition.spread(mode === 'single' ? 'none' : 'auto'); 
                setTimeout(() => this.syncLayout(), 150);
            } catch (e) {}
        }
    }

    public getCurrentPercentage(): number {
        if (!this.rendition || !this.book) return 0;
        const currentLocation = this.rendition.currentLocation();
        if (currentLocation && currentLocation.start && this.book.locations && this.book.locations.length() > 0) {
            return this.book.locations.percentageFromCfi(currentLocation.start.cfi);
        }
        return 0;
    }

    public setDirection(direction: 'horizontal' | 'vertical') {
        this.settings.direction = direction;
        this.saveSettings();
        if (this.rendition) {
            this.rendition.getContents().forEach((c: any) => {
                const doc = c.document; if (!doc) return;
                let style = doc.getElementById('epub-reader-direction-style') || doc.createElement('style');
                style.id = 'epub-reader-direction-style';
                style.innerHTML = `html, body { writing-mode: ${direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb'} !important; -webkit-writing-mode: ${direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb'} !important; }`;
                if (!style.parentNode) doc.head.appendChild(style);
            });
            setTimeout(() => this.syncLayout(), 150);
        }
    }

    public setPageDirection(dir: 'ltr' | 'rtl') {
        this.settings.pageDirection = dir;
        this.saveSettings();
        if (this.rendition) try { this.rendition.direction(dir); } catch(e) {}
    }

    public async addBookmark() {
        if (!this.rendition) return;
        const location = this.rendition.currentLocation();
        if (location && location.start) {
            const newBookmark: Bookmark = {
                id: Date.now().toString(), cfi: location.start.cfi, type: 'bookmark',
                label: `Page ${location.start.displayed.page} (${new Date().toLocaleTimeString()})`,
                createdAt: Date.now(), color: '#FFEB3B', note: ''
            };
            const newBookmarks = [...this.state.bookmarks, newBookmark];
            this.setState({ bookmarks: newBookmarks, editingBookmarkId: newBookmark.id }); 
            return newBookmarks;
        }
        return null;
    }

    public async addHighlight(color: string, explicitCfiRange?: string, explicitText?: string) {
        const cfiRange = explicitCfiRange || this.state.selectedCfiRange;
        const text = explicitText || this.state.selectedText;
        if (!this.rendition || !cfiRange) return;
        const id = Date.now().toString();
        try {
            this.rendition.annotations.add('highlight', cfiRange, this.getHighlightStyle(color), undefined, 'highlight-' + id);
        } catch (e) {}
        const location = this.rendition.currentLocation();
        const newHighlight: Bookmark = {
            id, cfi: cfiRange, type: 'highlight', label: `Page ${location?.start?.displayed?.page || '?'}`,
            text: text || '', createdAt: Date.now(), color, note: ''
        };
        const newBookmarks = [...this.state.bookmarks, newHighlight];
        this.setState({ bookmarks: newBookmarks }); 
        return newBookmarks;
    }

    public updateBookmark(id: string, updates: Partial<Bookmark>) {
        const target = this.state.bookmarks.find(b => b.id === id);
        if (target && target.type === 'highlight' && updates.color && updates.color !== target.color) {
            try {
                this.rendition.annotations.remove(target.cfi, 'highlight');
                this.rendition.annotations.add('highlight', target.cfi, this.getHighlightStyle(updates.color), undefined, 'highlight-' + id);
            } catch (e) {}
        }
        const newBookmarks = this.state.bookmarks.map(bm => bm.id === id ? { ...bm, ...updates } : bm);
        this.setState({ bookmarks: newBookmarks });
        return newBookmarks;
    }

    public removeBookmark(id: string) {
        const target = this.state.bookmarks.find(b => b.id === id);
        if (target && target.type === 'highlight') try { this.rendition.annotations.remove(target.cfi, 'highlight'); } catch(e) {}
        const newBookmarks = this.state.bookmarks.filter(b => b.id !== id);
        this.setState({ bookmarks: newBookmarks });
        return newBookmarks;
    }

    public async restoreBookmark(bookmark: Bookmark) {
        if (!this.rendition) return;
        await this.display(bookmark.cfi);
        if (bookmark.audioSrc && this.state.hasAudio) {
            await this.playAudioFile(bookmark.audioSrc, false);
            if (bookmark.audioTime !== undefined) this.seekAudio(bookmark.audioTime);
        }
    }

    public seekToElementId(elementId: string) {
        if (!this.state.hasAudio && this.settings.ttsEnabled && this.state.selectedText) {
            if (this.ttsUtterance) { this.ttsUtterance.onend = null; this.ttsUtterance.onerror = null; }
            this.synth.cancel(); this.removeTTSHighlights();
            this.playCurrentPageTTS(this.state.selectedText);
            this.setState({ selectionToolbarVisible: false }); return;
        }
        if (!elementId) { alert(this.t('audioError')); return; }
        const fragment = this.mediaOverlayData.find(f => f.textSrc.endsWith('#' + elementId));
        if (fragment) {
            this.display(fragment.textSrc).then(() => this.highlightElement(elementId));
            const playAndSeek = () => {
                this.seekAudio(this.parseTime(fragment.clipBegin));
                if (!this.state.isAudioPlaying) this.toggleAudio();
            };
            if (this.currentAudioFile !== fragment.audioSrc) this.playAudioFile(fragment.audioSrc, false).then(playAndSeek);
            else playAndSeek();
        }
    }
    
    public copySelection() {
        if (this.state.selectedText) {
            navigator.clipboard.writeText(this.state.selectedText).then(() => {
                this.setState({ toastMessage: "Copied!", selectionToolbarVisible: false });
                setTimeout(() => this.setState({ toastMessage: null }), 2000);
            });
        }
    }

    public applySettings() {
        if (!this.rendition) return;
        this.setFontSize(this.settings.fontSize);
        this.updateThemeColors(this.settings.darkMode ? 'dark' : this.settings.theme);
        this.setDirection(this.settings.direction);
        this.setPageDirection(this.settings.pageDirection);
        this.setLayoutMode(this.settings.layoutMode);
    }

    public setFontSize(size: string) {
        this.settings.fontSize = size as any; this.saveSettings();
        if (this.rendition?.themes) this.rendition.themes.fontSize(size === 'small' ? '80%' : size === 'large' ? '120%' : size === 'xlarge' ? '150%' : '100%');
    }

    public setTheme(theme: string) {
        this.settings.theme = theme as any; this.saveSettings();
        if (!this.settings.darkMode) this.updateThemeColors(theme);
    }

    public toggleDarkMode(enabled: boolean) {
        this.settings.darkMode = enabled; this.saveSettings();
        this.updateThemeColors(enabled ? 'dark' : (this.settings.theme || 'light'));
    }
    
    private updateThemeColors(theme: string) {
        const bg = theme === 'dark' ? '#111827' : theme === 'sepia' ? '#f6f1d1' : '#f3f4f6';
        const txt = theme === 'dark' ? '#ddd' : theme === 'sepia' ? '#5f4b32' : '#333';
        document.body.style.backgroundColor = bg;
        if (this.rendition?.themes) {
            this.rendition.themes.select(theme);
            this.rendition.getContents().forEach((c: any) => {
                const doc = c.document;
                const bodyBg = theme === 'light' ? '#fff' : (theme === 'dark' ? '#111' : '#f6f1d1');
                doc.documentElement.style.backgroundColor = bodyBg;
                doc.body.style.backgroundColor = bodyBg;
                doc.body.style.color = txt;
                doc.body.style.cssText += `;background-color: ${bodyBg} !important; color: ${txt} !important;`;
            });
        }
    }

    public prevPage() { if (!this.state.isLoading && this.rendition) { if(this.isTTSActive) this.stopAudio(); this.rendition.prev(); } }
    public nextPage() { if (!this.state.isLoading && this.rendition) { if(this.isTTSActive) this.stopAudio(); this.rendition.next(); } }
    public async display(target?: string) { await this.safeDisplay(target); }

    private bindAudioEvents() {
        this.audioPlayer.addEventListener('loadedmetadata', () => this.setState({ audioDuration: this.audioPlayer.duration }));
        this.audioPlayer.addEventListener('timeupdate', () => {
            this.setState({ audioCurrentTime: this.audioPlayer.currentTime });
            if (this.settings.syncTextHighlight) this.updateAudioHighlight();
        });
        this.audioPlayer.addEventListener('ended', () => this.playNextAudio());
        this.audioPlayer.addEventListener('error', () => this.setState({ isAudioPlaying: false }));
    }

    public async updateAudioHighlight() {
        if (!this.state.isAudioPlaying || !this.currentAudioFile || !this.rendition) return;
        const frags = this.audioGroups.get(this.currentAudioFile);
        if (!frags) return;
        const time = this.audioPlayer.currentTime;
        const current = frags.find(f => time >= this.parseTime(f.clipBegin) && time < this.parseTime(f.clipEnd));
        if (current && current.originalIndex !== this.currentAudioIndex) {
            this.currentAudioIndex = current.originalIndex;
            const parts = current.textSrc.split('#');
            if (parts[1]) {
                this.clearAudioHighlight();
                await this.display(current.textSrc);
                this.highlightElement(parts[1]);
            }
        }
    }
    
    private highlightElement(id: string) {
        if (!this.rendition) return;
        this.rendition.getContents().forEach((c: any) => {
            const el = c.document.getElementById(id);
            if (el) {
                el.classList.add('audio-highlight');
                el.style.backgroundColor = 'rgba(255, 255, 0, 0.4)';
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        });
    }
    
    private clearAudioHighlight() {
         if(!this.rendition) return;
         this.rendition.getContents().forEach((c: any) => {
             c.document.querySelectorAll('.audio-highlight').forEach((el: HTMLElement) => {
                 el.classList.remove('audio-highlight');
                 el.style.backgroundColor = '';
             });
         });
    }

    private parseTime(t: string): number {
        if (!t) return 0; if (t.includes('s')) return parseFloat(t);
        if (t.includes(':')) {
            const parts = t.split(':').map(parseFloat);
            return parts.length === 3 ? parts[0]*3600 + parts[1]*60 + parts[2] : parts[0]*60 + parts[1];
        }
        return parseFloat(t);
    }

    public toggleAudio() {
        if (!this.state.hasAudio && this.settings.ttsEnabled) { this.toggleTTS(); return; }
        if (this.state.isAudioPlaying) { this.audioPlayer.pause(); this.setState({ isAudioPlaying: false }); }
        else {
            if (this.audioPlayer.src && !this.audioPlayer.src.endsWith('/')) { this.audioPlayer.play(); this.setState({ isAudioPlaying: true }); }
            else if (this.currentAudioFile) this.playAudioFile(this.currentAudioFile);
            else if (this.audioGroups.size > 0) this.playAudioFile(this.audioGroups.keys().next().value);
        }
    }

    public playNextAudio() {
        const idx = this.state.audioList.indexOf(this.currentAudioFile || '');
        if (idx !== -1 && idx < this.state.audioList.length - 1) this.playAudioFile(this.state.audioList[idx + 1]);
        else this.setState({ isAudioPlaying: false });
    }

    public stopAudio() {
        if (this.synth.speaking) this.synth.cancel();
        this.isTTSActive = false; this.ttsQueue = []; this.removeTTSHighlights();
        this.audioPlayer.pause(); this.audioPlayer.currentTime = 0;
        this.setState({ isAudioPlaying: false, audioCurrentTime: 0 });
        this.clearAudioHighlight();
    }

    public seekAudio(time: number) { if (this.audioPlayer.src) this.audioPlayer.currentTime = time; }

    public playPrevSentence() {
        if (!this.currentAudioFile) return;
        const frags = this.audioGroups.get(this.currentAudioFile); if (!frags) return;
        const time = this.audioPlayer.currentTime;
        const idx = frags.findIndex(f => time >= this.parseTime(f.clipBegin) && time < this.parseTime(f.clipEnd));
        if (idx > 0) this.seekAudio(this.parseTime(frags[idx - 1].clipBegin));
    }

    public playNextSentence() {
        if (!this.currentAudioFile) return;
        const frags = this.audioGroups.get(this.currentAudioFile); if (!frags) return;
        const next = frags.find(f => this.parseTime(f.clipBegin) > this.audioPlayer.currentTime + 0.2);
        if (next) this.seekAudio(this.parseTime(next.clipBegin));
    }

    public setVolume(val: number) { this.audioPlayer.volume = val; this.settings.audioVolume = val * 100; this.saveSettings(); }
    
    private async loadAudioFromEPUB() {
        if (!this.book) return;
        const manifest = await this.book.loaded.manifest;
        const smilItems = Object.values(manifest).filter((item: any) => {
            const type = (item['media-type'] || item.type || '').toLowerCase();
            return type.includes('smil') || (item.href && item.href.endsWith('.smil'));
        });
        this.mediaOverlayData = [];
        for (const item of smilItems) this.mediaOverlayData.push(...(await this.processSmil(item)));
        this.audioGroups.clear();
        this.mediaOverlayData.forEach((frag, idx) => {
            if (!this.audioGroups.has(frag.audioSrc)) this.audioGroups.set(frag.audioSrc, []);
            this.audioGroups.get(frag.audioSrc)!.push({ ...frag, originalIndex: idx });
        });
        const audioList = Array.from(this.audioGroups.keys());
        this.setState({ audioList, hasAudio: audioList.length > 0 });
    }

    private async processSmil(item: any) {
        try {
            let text = '';
            const doc = await this.book.load(item.href);
            if (doc instanceof Blob) text = await doc.text();
            else if (typeof doc === 'string') text = doc;
            else if (doc?.documentElement) text = new XMLSerializer().serializeToString(doc);
            if (!text) return [];
            const xml = new DOMParser().parseFromString(text, 'application/xml');
            const pars = xml.getElementsByTagName('par');
            const fragments = [];
            for(let i=0; i<pars.length; i++) {
                const t = pars[i].getElementsByTagName('text')[0];
                const a = pars[i].getElementsByTagName('audio')[0];
                if (t && a) {
                    fragments.push({
                        textSrc: this.resolvePath(t.getAttribute('src'), item.href),
                        audioSrc: this.resolvePath(a.getAttribute('src'), item.href),
                        clipBegin: a.getAttribute('clipBegin') || a.getAttribute('clip-begin'),
                        clipEnd: a.getAttribute('clipEnd') || a.getAttribute('clip-end')
                    });
                }
            }
            return fragments;
        } catch (e) { return []; }
    }

    private resolvePath(rel: string | null, base: string) {
        if (!rel) return ''; if (rel.startsWith('/')) return rel;
        const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
        const stack = baseDir.split('/').filter(x => x && x !== '.');
        rel.split('/').forEach(p => { if (p === '..') stack.pop(); else if (p && p !== '.') stack.push(p); });
        return stack.join('/');
    }

    private async findAudioBlob(path: string): Promise<string | null> {
        const getBlob = async (p: string) => { try { return await this.book.archive.getBlob(p); } catch(e) { return null; } };
        let blob = await getBlob(path) || await getBlob('/' + path);
        if (!blob && this.book.container?.packagePath) {
             const pkgDir = this.book.container.packagePath.substring(0, this.book.container.packagePath.lastIndexOf('/'));
             blob = await getBlob(`/${pkgDir}/${path}`);
        }
        if (blob) return URL.createObjectURL(blob);
        return null;
    }

    public async playAudioFile(audioPath: string, autoPlay: boolean = true) {
        this.currentAudioFile = audioPath;
        const url = await this.findAudioBlob(audioPath);
        if (url) {
            this.audioPlayer.src = url;
            const title = audioPath.split('/').pop() || 'Audio';
            this.setState({ isAudioPlaying: autoPlay, audioTitle: title, currentAudioFile: audioPath });
            if (autoPlay) this.audioPlayer.play();
        } else this.setState({ audioTitle: this.t('audioError'), currentAudioFile: audioPath });
    }

    private async captureAudioSegment(start: number, end: number): Promise<{base64: string, extension: string}> {
        const duration = (end - start) * 1000;
        if (!this.audioContext) this.audioContext = new AudioContext();
        await this.audioContext.resume();
        if (!this.mediaElementSource) {
            this.mediaElementSource = this.audioContext.createMediaElementSource(this.audioPlayer);
            this.mediaElementSource.connect(this.audioContext.destination);
        }
        const dest = this.audioContext.createMediaStreamDestination();
        this.mediaElementSource.connect(dest);
        const recorder = new MediaRecorder(dest.stream);
        const chunks: Blob[] = [];
        return new Promise((resolve, reject) => {
            recorder.ondataavailable = (e) => chunks.push(e.data);
            recorder.onstop = async () => {
                 this.mediaElementSource?.disconnect(dest);
                 const reader = new FileReader();
                 reader.onloadend = () => resolve({ base64: (reader.result as string).split(',')[1], extension: "webm" });
                 reader.readAsDataURL(new Blob(chunks));
            };
            this.audioPlayer.currentTime = start;
            this.audioPlayer.play().then(() => {
                recorder.start();
                setTimeout(() => { recorder.stop(); this.audioPlayer.pause(); }, duration);
            });
        });
    }

    private handleScriptMessage(event: MessageEvent) {
        if (event.data?.type === 'VAM_SEARCH_RESPONSE') {
            this.setState({ scriptTabContent: event.data.payload.html, scriptTabError: event.data.payload.error, scriptTabLoading: false });
        }
    }

    public searchWithScript(word: string) {
        this.setState({ scriptTabLoading: true, scriptTabContent: null });
        window.postMessage({ type: 'VAM_SEARCH_REQUEST', payload: { word, lang: this.settings.language } }, '*');
    }

    public async lookupWord(word: string) {
        if (!word) return;
        this.setState({ dictionaryModalVisible: true, dictionaryLoading: true, dictionaryError: null, selectedText: word, scriptTabContent: null, scriptTabLoading: true });
        this.searchWithScript(word);
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
            if (!res.ok) throw new Error('Not found');
            this.setState({ dictionaryData: (await res.json())[0], dictionaryLoading: false });
        } catch (e: any) { this.setState({ dictionaryError: e.message, dictionaryLoading: false }); }
    }
    
    public async testAnki() {
         try {
             const res = await this.ankiRequest('version');
             if (res) {
                 this.setState({ ankiConnected: true, ankiDecks: await this.ankiRequest('deckNames') || [], ankiModels: await this.ankiRequest('modelNames') || [] });
                 return true;
             }
         } catch(e) { this.setState({ ankiConnected: false }); }
         return false;
    }

    public async loadAnkiFields(modelName: string) {
        this.setState({ ankiFields: await this.ankiRequest('modelFieldNames', { modelName }) || [] });
    }

    private async ankiRequest(action: string, params = {}) {
        const res = await fetch(`http://${this.ankiSettings.host}:${this.ankiSettings.port}`, { method: 'POST', body: JSON.stringify({ action, version: 6, params }) });
        const json = await res.json(); if (json.error) throw new Error(json.error); return json.result;
    }

    public async addToAnki(word: string, meaning: string, sentence: string) {
        const { deck, model, wordField, meaningField, sentenceField, audioField, tagsField } = this.ankiSettings;
        const fields: any = {};
        if (wordField) fields[wordField] = word; if (meaningField) fields[meaningField] = meaning;
        if (sentenceField) fields[sentenceField] = sentence.replace(new RegExp(`(${word})`, 'gi'), '<b>$1</b>');
        const note: any = { deckName: deck, modelName: model, fields, tags: tagsField.split(',').map(t => t.trim()) };
        if (audioField && this.currentAudioFile) {
            try {
                const frags = this.audioGroups.get(this.currentAudioFile);
                const current = frags?.find(f => this.audioPlayer.currentTime >= this.parseTime(f.clipBegin) && this.audioPlayer.currentTime < this.parseTime(f.clipEnd));
                if (current) {
                    const { base64, extension } = await this.captureAudioSegment(this.parseTime(current.clipBegin), this.parseTime(current.clipEnd));
                    note.audio = [{ url: "", data: base64, filename: `anki_${Date.now()}.${extension}`, fields: [audioField] }];
                }
            } catch (e) {}
        }
        return await this.ankiRequest('addNote', { note });
    }
    
    public saveSettings() { localStorage.setItem('epubReaderSettings', JSON.stringify(this.settings)); }
    public saveAnkiSettings() { localStorage.setItem('epubReaderAnkiSettings', JSON.stringify(this.ankiSettings)); }
}