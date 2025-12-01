
import { AnkiSettings, AppSettings, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState } from '../types';
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
    
    // 引用
    private containerRef: HTMLElement | null = null;

    constructor(initialState: ReaderState, updateState: StateUpdater) {
        this.state = initialState;
        this.updateReactState = updateState;
        
        const savedSettings = localStorage.getItem('epubReaderSettings');
        this.settings = savedSettings ? JSON.parse(savedSettings) : { ...DEFAULT_SETTINGS };
        
        // 确保语言设置存在 (迁移处理)
        if (!this.settings.language) {
            this.settings.language = 'zh';
        }

        const savedAnki = localStorage.getItem('epubReaderAnkiSettings');
        this.ankiSettings = savedAnki ? JSON.parse(savedAnki) : { ...DEFAULT_ANKI_SETTINGS };

        this.audioPlayer = new Audio();
        this.bindAudioEvents();
        this.setVolume(this.settings.audioVolume / 100);
        
        this.setState({
            isDarkMode: this.settings.darkMode,
            ankiConnected: false
        });
    }

    // 辅助方法：同步本地状态和 React 状态
    private setState(partial: Partial<ReaderState>) {
        this.state = { ...this.state, ...partial };
        this.updateReactState(partial);
    }

    private t(key: keyof typeof translations['en']) {
        const lang = this.settings.language || 'zh';
        return translations[lang][key];
    }

    // ==========================================
    // 核心渲染 (基于原生 Epub.js)
    // ==========================================
    public mount(element: HTMLElement) {
        this.containerRef = element;
        // 如果书籍已加载但未渲染（例如 StrictMode 重新挂载），则进行渲染
        if (this.book && !this.rendition) {
            this.renderBook();
        }
    }

    // 销毁当前书籍实例并重置所有状态
    public destroy() {
        if (this.rendition) {
            this.rendition.destroy();
            this.rendition = null;
        }
        if (this.book) {
            this.book.destroy();
            this.book = null;
        }
        
        // 彻底重置音频状态
        this.audioPlayer.pause();
        this.audioPlayer.src = ''; // 清除音频源
        this.mediaOverlayData = [];
        this.audioGroups.clear();
        this.currentAudioFile = null;
        this.currentAudioIndex = -1;
        
        // 重置相关 UI 状态
        this.setState({
            isAudioPlaying: false,
            audioCurrentTime: 0,
            audioDuration: 0,
            audioTitle: '',
            audioList: [],
            showAudioList: false
        });
    }

    public async loadFile(file: File | Blob) {
        try {
            // 先清理旧状态
            this.destroy();

            this.setState({ isLoading: true, loadingMessage: this.t('opening') });
            
            // 初始化书籍对象
            this.book = ePub(file);
            await this.book.ready;

            // 加载元数据
            const metadata = await this.book.loaded.metadata;
            const navigation = await this.book.loaded.navigation;
            
            this.setState({
                currentBook: { title: metadata.title, author: metadata.creator },
                navigationMap: navigation.toc || [],
                loadingMessage: this.t('rendering')
            });

            // 解析音频数据
            this.setState({ loadingMessage: this.t('parsingAudio') });
            try {
                await this.loadAudioFromEPUB();
            } catch (e) {
                console.warn('Audio parse warning:', e);
            }

            // 渲染
            if (this.containerRef) {
                this.renderBook();
            }

            this.setState({ isLoading: false });

        } catch (e: any) {
            console.error(e);
            this.setState({ isLoading: false });
            alert(this.t('failed') + ': ' + e.message);
        }
    }

    private renderBook() {
        if (!this.book || !this.containerRef) return;

        // 创建渲染实例
        this.rendition = this.book.renderTo(this.containerRef, {
            width: '100%',
            height: '100%',
            flow: 'paginated', // 或 'scrolled'
            manager: 'default',
            allowScriptedContent: true
        });

        // 注册主题
        this.rendition.themes.register('light', { body: { color: '#333', background: '#fff' } });
        this.rendition.themes.register('dark', { body: { color: '#ddd', background: '#111' } });
        this.rendition.themes.register('sepia', { body: { color: '#5f4b32', background: '#f6f1d1' } });
        this.rendition.themes.register('audio-highlight', { 
            '.audio-highlight': { 'background-color': 'rgba(255, 255, 0, 0.4)', 'border-radius': '2px' } 
        });

        // 事件监听
        this.rendition.on('relocated', (location: any) => {
            this.setState({ currentCfi: location.start.cfi });
        });

        this.rendition.on('selected', (cfiRange: string, contents: any) => {
            const range = contents.range(cfiRange);
            const text = range.toString();
            
            const rect = range.getBoundingClientRect();
            const iframe = this.containerRef?.querySelector('iframe');
            const iframeRect = iframe?.getBoundingClientRect();
            
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
                    selectedText: text
                });
            }
        });

        // 初始显示
        this.rendition.display();
        this.applySettings();
    }

    public applySettings() {
        if (!this.rendition) return;
        
        this.rendition.themes.fontSize(this.getFontSizeValue(this.settings.fontSize));
        // 如果开启了深色模式，强制使用 dark 主题
        const theme = this.settings.darkMode ? 'dark' : this.settings.theme;
        this.rendition.themes.select(theme);
    }

    public setFontSize(size: string) {
        this.settings.fontSize = size as any;
        this.saveSettings();
        if (this.rendition) {
            this.rendition.themes.fontSize(this.getFontSizeValue(size));
        }
    }

    public setTheme(theme: string) {
        // 下拉菜单选择主题时调用
        this.settings.theme = theme as any;
        this.saveSettings();
        if (this.rendition) {
            this.rendition.themes.select(theme);
        }
    }

    public toggleDarkMode(enabled: boolean) {
        this.settings.darkMode = enabled;
        this.saveSettings();
        
        if (this.rendition) {
            if (enabled) {
                this.rendition.themes.select('dark');
            } else {
                // 恢复到之前选择的主题 (如 sepia 或 light)
                this.rendition.themes.select(this.settings.theme);
            }
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

    // ==========================================
    // 导航
    // ==========================================
    public prevPage() {
        this.rendition?.prev();
    }

    public nextPage() {
        this.rendition?.next();
    }

    public display(target: string) {
        this.rendition?.display(target);
    }

    // ==========================================
    // 音频逻辑
    // ==========================================
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
            // 自动播放下一首
            this.playNextAudio();
        });
        
        this.audioPlayer.addEventListener('error', (e) => {
            console.error('Audio error', e);
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

    public setVolume(val: number) {
        this.audioPlayer.volume = Math.max(0, Math.min(1, val));
        this.settings.audioVolume = val * 100;
        this.saveSettings();
    }

    // ==========================================
    // SMIL & 音频解析
    // ==========================================
    private async loadAudioFromEPUB() {
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

        // 填充音频列表
        const audioList = Array.from(this.audioGroups.keys());
        this.setState({ audioList });

        if (this.audioGroups.size > 0 && this.settings.autoPlayAudio) {
            const firstKey = this.audioGroups.keys().next().value;
            setTimeout(() => this.playAudioFile(firstKey), 1000);
        }
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

    public async playAudioFile(audioPath: string) {
        try {
            this.currentAudioFile = audioPath;
            const url = await this.findAudioBlob(audioPath);
            if (url) {
                this.audioPlayer.src = url;
                this.audioPlayer.play().catch(e => console.error('Play failed', e));
                this.setState({ isAudioPlaying: true, audioTitle: audioPath.split('/').pop() || 'Audio' });
            } else {
                console.error("Audio not found:", audioPath);
                this.setState({ audioTitle: this.t('audioError') });
            }
        } catch (e) { console.error("Play error", e); }
    }

    private updateAudioHighlight() {
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
                this.rendition.display(current.textSrc);

                const apply = () => {
                    const contents = this.rendition.getContents();
                    for(const c of contents) {
                        const el = c.document.getElementById(id);
                        if (el) {
                            el.classList.add('audio-highlight');
                            el.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
                        }
                    }
                };
                
                apply();
                setTimeout(apply, 200);
            }
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

    // ==========================================
    // 词典 & Anki
    // ==========================================
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
        const { deck, model, wordField, meaningField, sentenceField, tagsField } = this.ankiSettings;
        if (!deck || !model || !wordField) throw new Error("Anki settings incomplete");
        
        const note = {
            deckName: deck,
            modelName: model,
            fields: {
                [wordField]: word,
                [meaningField]: meaning,
                [sentenceField]: sentence
            },
            tags: tagsField.split(',').map(t => t.trim())
        };
        await this.ankiRequest('addNote', { note });
    }
    
    public saveSettings() {
        localStorage.setItem('epubReaderSettings', JSON.stringify(this.settings));
    }
    
    public saveAnkiSettings() {
        localStorage.setItem('epubReaderAnkiSettings', JSON.stringify(this.ankiSettings));
    }
}