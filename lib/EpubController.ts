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

        const savedAnki = localStorage.getItem('epubReaderAnkiSettings');
        this.ankiSettings = savedAnki ? JSON.parse(savedAnki) : { ...DEFAULT_ANKI_SETTINGS };

        this.audioPlayer = new Audio();
        // 设置跨域属性，虽然本地 Blob 还是需要的，防止录制时出现 tainted canvas/media 报错
        this.audioPlayer.crossOrigin = "anonymous";
        
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
            hasAudio: false
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

    public mount(element: HTMLElement) {
        this.containerRef = element;
        if (this.book && !this.rendition) {
            this.renderBook();
        }
    }

    public destroy() {
        if (this.rendition) {
            this.rendition.destroy();
            this.rendition = null;
        }
        if (this.book) {
            this.book.destroy();
            this.book = null;
        }
        
        this.audioPlayer.pause();
        this.audioPlayer.src = '';
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

    public async loadFile(file: File | Blob, initialProgress?: BookProgress, bookmarks: Bookmark[] = []) {
        try {
            this.destroy();
            this.setState({ isLoading: true, loadingMessage: this.t('opening'), bookmarks: bookmarks });
            
            this.book = ePub(file);
            await this.book.ready;

            const metadata = await this.book.loaded.metadata;
            const navigation = await this.book.loaded.navigation;
            
            this.setState({
                currentBook: { title: metadata.title, author: metadata.creator },
                navigationMap: navigation.toc || [],
                loadingMessage: this.t('rendering')
            });

            if (this.containerRef) {
                this.renderBook();
                
                if (initialProgress && initialProgress.cfi) {
                    this.display(initialProgress.cfi);
                }
            }

            this.setState({ isLoading: false });

            // 异步加载音频，不阻塞 UI
            this.loadAudioFromEPUB().then(async () => {
                if (this.state.hasAudio) {
                    if (initialProgress && initialProgress.audioSrc) {
                        await this.playAudioFile(initialProgress.audioSrc, false);
                        if (initialProgress.audioTime) {
                            this.audioPlayer.currentTime = initialProgress.audioTime;
                            this.setState({ audioCurrentTime: initialProgress.audioTime });
                        }
                    } else if (this.state.audioList.length > 0) {
                        // 第一次打开，加载第一个音频用于预热，但不播放
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

        // 注册主题
        // 注意：使用 !important 确保覆盖默认样式
        this.rendition.themes.register('light', { body: { color: '#333 !important', background: '#fff !important' } });
        this.rendition.themes.register('dark', { body: { color: '#ddd !important', background: '#111 !important' } });
        this.rendition.themes.register('sepia', { body: { color: '#5f4b32 !important', background: '#f6f1d1 !important' } });
        
        // 注册高亮样式
        this.rendition.themes.register('highlight', { 
            '.highlight': { 'background-color': 'rgba(255, 235, 59, 0.5)' } 
        });
        
        // 注册音频高亮样式 - 使用更显眼的颜色
        this.rendition.themes.register('audio-highlight', { 
            '.audio-highlight': { 
                'background-color': 'rgba(255, 255, 0, 0.4) !important', 
                'border-radius': '2px',
                'transition': 'background-color 0.3s'
            } 
        });

        // 注入全局样式，禁止默认长按菜单和工具栏，但允许选词和 Yomitan
        this.rendition.hooks.content.register((contents: any) => {
             const style = contents.document.createElement('style');
             style.id = 'epub-reader-custom-style';
             let css = `
                html, body { 
                    -webkit-touch-callout: none !important; /* iOS 禁止默认菜单 */
                    -webkit-user-select: text !important; /* 允许选词 */
                    user-select: text !important;
                    pointer-events: auto !important; /* 确保 Yomitan 可以获取事件 */
                }
                iframe {
                    pointer-events: auto !important;
                }
                /* 关键：防止 Yomitan 选中注音假名，避免干扰取词 */
                rt {
                    user-select: none !important;
                    -webkit-user-select: none !important;
                }
                /* 尝试隐藏部分浏览器的默认弹窗，虽然不一定所有浏览器生效 */
                ::selection {
                    background: rgba(59, 130, 246, 0.3); 
                }
             `;
             
             // 根据当前设置应用横竖排，使用 !important 强制覆盖
             if (this.settings.direction === 'vertical') {
                 css += `
                    html, body {
                        writing-mode: vertical-rl !important;
                        -webkit-writing-mode: vertical-rl !important;
                    }
                 `;
             } else {
                 css += `
                    html, body {
                        writing-mode: horizontal-tb !important;
                        -webkit-writing-mode: horizontal-tb !important;
                    }
                 `;
             }

             style.innerHTML = css;
             contents.document.head.appendChild(style);
             
             // 关键：阻止右键菜单，通常可以阻止默认的“复制/分享”弹出框
             contents.document.addEventListener('contextmenu', (e: Event) => {
                 e.preventDefault();
                 e.stopPropagation();
                 return false;
             }, false);
        });

        this.rendition.on('relocated', (location: any) => {
            this.setState({ currentCfi: location.start.cfi });
        });

        this.rendition.on('selected', (cfiRange: string, contents: any) => {
            const range = contents.range(cfiRange);
            const text = range.toString();
            
            let elementId = null;
            let node = range.commonAncestorContainer;
            if (node.nodeType !== 1) node = node.parentNode;
            while (node && node.nodeName !== 'BODY') {
                if (node.id) {
                    elementId = node.id;
                    break;
                }
                node = node.parentNode;
            }

            const rect = range.getBoundingClientRect();
            const iframe = this.containerRef?.querySelector('iframe');
            const iframeRect = iframe?.getBoundingClientRect();
            
            let sentence = text;
            try {
                // 尝试提取完整句子
                const block = range.commonAncestorContainer.nodeType === 1 
                    ? range.commonAncestorContainer 
                    : range.commonAncestorContainer.parentNode;
                
                if (block && block.textContent) {
                    const sentences = block.textContent.split(/(?<=[.?!])\s+/);
                    for (const s of sentences) {
                        if (s.includes(text)) {
                            sentence = s.trim();
                            break;
                        }
                    }
                }
            } catch(e) {
                console.warn("Sentence extraction failed", e);
            }
            
            if (iframeRect && rect) {
                const absoluteRect = {
                    left: rect.left + iframeRect.left,
                    top: rect.top + iframeRect.top,
                    width: rect.width,
                    height: rect.height
                } as DOMRect; 
                
                // 手机端避免工具栏超出屏幕
                let adjustedTop = absoluteRect.top - 60;
                let adjustedLeft = absoluteRect.left + absoluteRect.width/2 - 90;
                
                if (adjustedLeft < 10) adjustedLeft = 10;
                if (adjustedLeft + 180 > window.innerWidth) adjustedLeft = window.innerWidth - 190;
                if (adjustedTop < 10) adjustedTop = absoluteRect.bottom + 10;

                this.setState({
                    selectionToolbarVisible: true,
                    selectionRect: absoluteRect, // 保持原始Rect，在App.tsx中计算位置
                    selectedText: text,
                    selectedSentence: sentence,
                    selectedElementId: elementId
                });
            }
        });

        this.rendition.display();
        this.applySettings();
        this.setLayoutMode(this.settings.layoutMode);
    }

    public setLayoutMode(mode: 'single' | 'double') {
        this.settings.layoutMode = mode;
        this.saveSettings();
        if (this.rendition) {
            this.rendition.spread(mode === 'single' ? 'none' : 'auto');
        }
    }

    public setDirection(direction: 'horizontal' | 'vertical') {
        this.settings.direction = direction;
        this.saveSettings();
        
        if (this.rendition) {
            // 使用直接 DOM 操作而非 addStylesheetRules，避免 replaceCss 错误
            const contents = this.rendition.getContents();
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

            // 安全调用 resize
            try {
                if (typeof this.rendition.resize === 'function') {
                    this.rendition.resize();
                }
            } catch (e) {
                console.warn("Rendition resize failed:", e);
            }
        }
    }

    public setPageDirection(dir: 'ltr' | 'rtl') {
        this.settings.pageDirection = dir;
        this.saveSettings();
        if (this.rendition) {
            this.rendition.direction(dir);
        }
    }

    public async addBookmark() {
        if (!this.rendition) return;
        const location = this.rendition.currentLocation();
        if (location && location.start) {
            let label = `Page ${location.start.displayed.page}`;
            
            // 只有当音频正在播放时，才记录音频状态
            const shouldRecordAudio = this.state.isAudioPlaying && this.currentAudioFile;
            
            const newBookmark: Bookmark = {
                id: new Date().getTime().toString(),
                cfi: location.start.cfi,
                label: label + ` (${new Date().toLocaleTimeString()})`,
                createdAt: Date.now(),
                // 记录音频状态 (仅当播放时)
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
        
        await this.rendition.display(bookmark.cfi);
        
        // 恢复音频逻辑优化
        if (bookmark.audioSrc && this.state.hasAudio) {
            // 如果书签有音频，跳转并暂停
            await this.playAudioFile(bookmark.audioSrc, false); // false = do not play
            if (bookmark.audioTime !== undefined) {
                this.seekAudio(bookmark.audioTime);
                this.audioPlayer.pause();
                this.setState({ isAudioPlaying: false });
            }
        } else {
            // 如果书签没有音频，暂停当前播放器（如果在播放）
            if (this.state.isAudioPlaying) {
                this.audioPlayer.pause();
                this.setState({ isAudioPlaying: false });
            }
        }
    }

    public seekToElementId(elementId: string) {
        if (!elementId) {
            alert(this.t('audioError'));
            return;
        }

        const fragment = this.mediaOverlayData.find(f => f.textSrc.endsWith('#' + elementId));
        
        if (fragment) {
            // 同步跳转文字
            if (this.rendition) {
                this.rendition.display(fragment.textSrc).then(() => {
                    this.highlightElement(elementId);
                });
            }

            // 音频切换和跳转
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
        
        this.rendition.themes.fontSize(this.getFontSizeValue(this.settings.fontSize));
        
        // 强制应用主题逻辑
        const themeToApply = this.settings.darkMode ? 'dark' : this.settings.theme;
        this.updateThemeColors(themeToApply);
        
        // 应用方向
        this.setDirection(this.settings.direction);
        this.setPageDirection(this.settings.pageDirection);
    }

    public setFontSize(size: string) {
        this.settings.fontSize = size as any;
        this.saveSettings();
        if (this.rendition) {
            this.rendition.themes.fontSize(this.getFontSizeValue(size));
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
    
    // 统一处理主题颜色，防止残留
    private updateThemeColors(theme: string) {
        let bgColor = '#fff';
        let txtColor = '#333';
        
        if (theme === 'dark') {
            bgColor = '#111827';
            txtColor = '#ddd';
        } else if (theme === 'sepia') {
            bgColor = '#f6f1d1';
            txtColor = '#5f4b32';
        } else { // light
            bgColor = '#f3f4f6'; // app bg
            txtColor = '#333';
        }

        // 设置 App Body 背景
        document.body.style.backgroundColor = bgColor;

        if (this.rendition) {
            // EPub.js 主题切换
            this.rendition.themes.select(theme);
            
            // 强力清除 iframe 内部的样式残留
            const contents = this.rendition.getContents();
            contents.forEach((c: any) => {
                const doc = c.document;
                const iframeBodyBg = theme === 'light' ? '#fff' : (theme === 'dark' ? '#111' : '#f6f1d1');
                
                doc.documentElement.style.backgroundColor = iframeBodyBg;
                doc.body.style.backgroundColor = iframeBodyBg;
                doc.body.style.color = txtColor;
                
                // 确保样式被应用
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
        this.rendition?.prev();
    }

    public nextPage() {
        this.rendition?.next();
    }

    public display(target: string) {
        this.rendition?.display(target);
    }

    public highlightSelection() {
        if(!this.rendition) return;
        // 简化高亮实现
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
            console.error('Audio error event:', e);
            if (this.audioPlayer.error) {
                console.error('Audio error code:', this.audioPlayer.error.code);
                console.error('Audio error message:', this.audioPlayer.error.message);
            }
            this.setState({ isAudioPlaying: false });
        });
    }

    public toggleAudio() {
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
    
    // 切换到上一句
    public playPrevSentence() {
        if (!this.currentAudioFile) return;
        const frags = this.audioGroups.get(this.currentAudioFile);
        if (!frags || frags.length === 0) return;

        const time = this.audioPlayer.currentTime;
        // 查找当前或刚刚结束的句子
        // 我们查找 start <= time 的最后一个片段
        let idx = -1;
        
        // 1. 查找当前正在播放的片段
        idx = frags.findIndex(f => {
            const s = this.parseTime(f.clipBegin);
            const e = this.parseTime(f.clipEnd);
            return time >= s && time < e;
        });

        // 2. 如果没在片段中，查找在此时间点之前开始的最后一个片段
        if (idx === -1) {
             for (let i = frags.length - 1; i >= 0; i--) {
                 if (this.parseTime(frags[i].clipBegin) < time) {
                     idx = i;
                     break;
                 }
             }
        }
        
        if (idx > 0) {
             // 跳转到上一句
             this.seekAudio(this.parseTime(frags[idx - 1].clipBegin));
        } else if (frags.length > 0) {
             // 如果已经是第一句或之前，跳到第一句开始
             this.seekAudio(this.parseTime(frags[0].clipBegin));
        }
    }

    // 切换到下一句
    public playNextSentence() {
        if (!this.currentAudioFile) return;
        const frags = this.audioGroups.get(this.currentAudioFile);
        if (!frags || frags.length === 0) return;

        const time = this.audioPlayer.currentTime;
        
        // 查找第一个开始时间大于当前时间（加一点缓冲）的片段
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

    private async updateAudioHighlight() {
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
                // 关键修复：确保先跳转并等待页面加载完成
                await this.rendition.display(current.textSrc);
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
                // 强制应用样式以防 css 不生效
                el.style.backgroundColor = 'rgba(255, 255, 0, 0.4)';
                el.style.transition = 'background-color 0.3s';
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                found = true;
            }
        }
        
        if (!found) {
            // 如果没找到，可能是刚翻页 DOM 还没准备好，稍后重试
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

    // --- Audio Processing for Anki (Real-time Play & Record) ---

    private async captureAudioSegment(start: number, end: number): Promise<{base64: string, extension: string}> {
        const duration = (end - start) * 1000; // ms
        if (duration <= 0) throw new Error("Invalid duration");

        // 1. 初始化 AudioContext (如果需要)
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // 2. 初始化源节点 (单例模式，避免 createMediaElementSource 重复调用报错)
        if (!this.mediaElementSource) {
            try {
                this.mediaElementSource = this.audioContext.createMediaElementSource(this.audioPlayer);
                // 默认连接到输出设备，保证正常播放有声音
                this.mediaElementSource.connect(this.audioContext.destination);
            } catch (e) {
                console.error("Source creation failed, possibly due to existing context", e);
                // 如果创建失败，可能需要重置 context 或做其他处理
                // 但通常单例模式能避免此问题
            }
        }
        
        // 确保有 source 才能继续
        if (!this.mediaElementSource) throw new Error("Audio source unavailable");

        // 3. 创建录制流目的地
        const dest = this.audioContext.createMediaStreamDestination();
        this.mediaElementSource.connect(dest);

        // 4. 选择录制格式
        // 优先使用 WebM (Chrome/Android), Safari 可能需要 fallback
        let mimeType = "audio/webm;codecs=opus";
        let extension = "webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = "audio/mp4"; // Safari
            extension = "m4a";
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                 mimeType = ""; // Browser default
                 extension = "webm"; // Guess
            }
        }
        
        const options = mimeType ? { mimeType } : undefined;
        let recorder: MediaRecorder;
        try {
             recorder = new MediaRecorder(dest.stream, options);
        } catch (e) {
             console.error("MediaRecorder init failed", e);
             this.mediaElementSource.disconnect(dest);
             throw new Error("Recorder init failed");
        }

        const chunks: Blob[] = [];
        
        return new Promise((resolve, reject) => {
            // 安全超时，防止永远不返回导致界面卡死
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error("Recording timeout"));
            }, duration + 5000);

            const cleanup = () => {
                clearTimeout(timeoutId);
                try {
                     if (recorder.state !== 'inactive') recorder.stop();
                } catch(e){}
                try {
                     this.mediaElementSource?.disconnect(dest);
                } catch(e){}
            };

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };
            
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

            recorder.onerror = (e) => {
                cleanup();
                reject(e);
            };

            // 5. 跳转并播放
            this.audioPlayer.currentTime = start;
            this.audioPlayer.play().then(() => {
                try {
                    recorder.start();
                    
                    // 定时停止
                    setTimeout(() => {
                        if (recorder.state === 'recording') {
                            recorder.stop();
                            this.audioPlayer.pause();
                        }
                    }, duration);
                } catch (e) {
                    cleanup();
                    reject(e);
                }
            }).catch((e) => {
                cleanup();
                reject(e);
            });
        });
    }

    // --- End Audio Processing ---

    public async lookupWord(word: string) {
        if (!word) return;
        this.setState({ 
            dictionaryModalVisible: true, 
            dictionaryLoading: true, 
            dictionaryError: null,
            selectedText: word
        });
        
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
         } catch(e) {
             this.setState({ ankiConnected: false });
             return false;
         }
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
            method: 'POST',
            body: JSON.stringify({ action, version: 6, params })
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        return json.result;
    }

    public async addToAnki(word: string, meaning: string, sentence: string) {
        const { deck, model, wordField, meaningField, sentenceField, audioField, tagsField } = this.ankiSettings;
        
        // 1. 验证：至少需要配置并选中一个字段
        if (!deck || !model) throw new Error(this.t('ankiFieldsConfigError'));
        if (!wordField && !meaningField && !sentenceField && !audioField) {
            throw new Error(this.t('ankiFieldsConfigError'));
        }
        
        const fields: Record<string, string> = {};
        if (wordField) fields[wordField] = word;
        if (meaningField) fields[meaningField] = meaning;
        
        if (sentenceField && sentence) {
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const boldedSentence = sentence.replace(new RegExp(`(${escapedWord})`, 'gi'), '<b>$1</b>');
            fields[sentenceField] = boldedSentence;
        }

        const note: any = {
            deckName: deck,
            modelName: model,
            fields: fields,
            tags: tagsField.split(',').map(t => t.trim())
        };

        // 3. Audio Processing: Play and Record segment
        if (audioField && this.currentAudioFile) {
            let fragment = null;
            // 优先匹配当前高亮的ID
            if (this.state.selectedElementId) {
                fragment = this.mediaOverlayData.find(f => f.textSrc.endsWith('#' + this.state.selectedElementId));
            }
            
            // 如果没有 ID，尝试根据播放进度和当前文件匹配
            if (!fragment && this.state.isAudioPlaying) {
                 const frags = this.audioGroups.get(this.currentAudioFile);
                 const time = this.audioPlayer.currentTime;
                 if (frags) {
                     fragment = frags.find(f => {
                        const start = this.parseTime(f.clipBegin);
                        const end = this.parseTime(f.clipEnd);
                        return time >= start && time < end;
                    });
                 }
            }

            // 如果找到了片段信息，进行录制
            if (fragment && fragment.audioSrc === this.currentAudioFile) {
                 try {
                     const start = this.parseTime(fragment.clipBegin);
                     const end = this.parseTime(fragment.clipEnd);
                     const duration = end - start;

                     if (duration > 0) {
                         console.log(`Recording audio segment: ${start} -> ${end}`);
                         // 使用录制替代解码，避免卡顿
                         const { base64, extension } = await this.captureAudioSegment(start, end);
                         const filename = `anki_${new Date().getTime()}.${extension}`;
                         note.audio = [{
                            url: "",
                            data: base64,
                            filename: filename,
                            fields: [audioField]
                        }];
                     }
                 } catch (e) {
                     console.error("Audio recording failed", e);
                     // 即使录制失败，也继续添加卡片（不含音频）
                 }
            }
        }
        
        return await this.ankiRequest('addNote', { note });
    }
    
    public saveSettings() {
        localStorage.setItem('epubReaderSettings', JSON.stringify(this.settings));
    }
    
    public saveAnkiSettings() {
        localStorage.setItem('epubReaderAnkiSettings', JSON.stringify(this.ankiSettings));
    }
}