import { AnkiSettings, AppSettings, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState, BookProgress } from '../types';
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
        if (!this.settings.language) this.settings.language = 'zh';

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
        
        this.setState({
            isAudioPlaying: false,
            audioCurrentTime: 0,
            audioDuration: 0,
            audioTitle: '',
            audioList: [],
            showAudioList: false,
            currentAudioFile: null,
            selectionToolbarVisible: false
        });
    }

    public async loadFile(file: File | Blob, initialProgress?: BookProgress) {
        try {
            this.destroy();
            this.setState({ isLoading: true, loadingMessage: this.t('opening') });
            
            this.book = ePub(file);
            await this.book.ready;

            const metadata = await this.book.loaded.metadata;
            const navigation = await this.book.loaded.navigation;
            
            this.setState({
                currentBook: { title: metadata.title, author: metadata.creator },
                navigationMap: navigation.toc || [],
                loadingMessage: this.t('rendering')
            });

            this.setState({ loadingMessage: this.t('parsingAudio') });
            try {
                await this.loadAudioFromEPUB();
            } catch (e) {
                console.warn('Audio parse warning:', e);
            }

            if (this.containerRef) {
                this.renderBook();
                
                if (initialProgress) {
                    if (initialProgress.cfi) this.display(initialProgress.cfi);
                    if (initialProgress.audioSrc) {
                        await this.playAudioFile(initialProgress.audioSrc, false);
                        if (initialProgress.audioTime) {
                            this.audioPlayer.currentTime = initialProgress.audioTime;
                            this.setState({ audioCurrentTime: initialProgress.audioTime });
                        }
                    }
                } else {
                    // 第一次打开，默认加载第一个音频但不播放
                    if (this.state.audioList.length > 0) {
                        await this.playAudioFile(this.state.audioList[0], false);
                    }
                }
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

        this.rendition = this.book.renderTo(this.containerRef, {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            manager: 'default',
            allowScriptedContent: true
        });

        this.rendition.themes.register('light', { body: { color: '#333', background: '#fff' } });
        this.rendition.themes.register('dark', { body: { color: '#ddd', background: '#111' } });
        this.rendition.themes.register('sepia', { body: { color: '#5f4b32', background: '#f6f1d1' } });
        // 添加高亮样式
        this.rendition.themes.register('highlight', { 
            '.highlight': { 'background-color': 'rgba(255, 235, 59, 0.5)' } 
        });
        this.rendition.themes.register('audio-highlight', { 
            '.audio-highlight': { 'background-color': 'rgba(255, 255, 0, 0.4)', 'border-radius': '2px' } 
        });

        this.rendition.on('relocated', (location: any) => {
            this.setState({ currentCfi: location.start.cfi });
        });

        this.rendition.on('selected', (cfiRange: string, contents: any) => {
            const range = contents.range(cfiRange);
            const text = range.toString();
            
            // 尝试获取包含该文本的元素ID，用于音频跳转
            let elementId = null;
            let node = range.commonAncestorContainer;
            if (node.nodeType !== 1) node = node.parentNode;
            // 向上查找最近的带ID的元素
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
                    selectedElementId: elementId
                });
            }
        });

        this.rendition.display();
        this.applySettings();
    }

    public highlightSelection() {
        // Epub.js annotations API (requires selection CFI)
        // 这里的实现依赖于 rendition 能够访问当前的 selection
        // 由于 selected 事件只给了 range 字符串，我们需要更高级的 API
        // 简化实现：对当前选区执行 CSS wrap
        if(!this.rendition) return;
        // 注意：epub.js annotations 需要 CFI。我们在 selected 事件里其实拿到了 cfiRange，但没有存。
        // 在实际应用中，你可能需要将 cfiRange 存入 state。
        // 这里我们用一个简化的方式：用户点击高亮后，我们假设当前的 window.getSelection (如果是在iframe里) 还有效
        // 或者，我们修改 selected 监听器去存储 cfiRange。
        
        // 为了简单起见，我们假设用户还在选区上。但因为 toolbar 在外面，点击 toolbar 可能会让 iframe 失去焦点。
        // 更好的做法是在 selected 事件里存储 cfiRange。
        // 鉴于 types.ts 尚未添加 selectedCfiRange，我们暂时不做持久化高亮，仅提示。
        alert("Highlight function requires CFI persistence update."); 
    }

    // 根据选中的元素ID跳转音频
    public seekToElementId(elementId: string) {
        if (!elementId) {
            alert(this.t('audioError')); // 复用错误提示，表示无法定位
            return;
        }

        // 在 mediaOverlayData 中查找匹配的 ID
        // textSrc 格式通常是 "filename.xhtml#id"
        const fragment = this.mediaOverlayData.find(f => f.textSrc.endsWith('#' + elementId));
        
        if (fragment) {
            // 如果音频文件不同，先切换
            if (this.currentAudioFile !== fragment.audioSrc) {
                this.playAudioFile(fragment.audioSrc, false).then(() => {
                    this.seekAudio(this.parseTime(fragment.clipBegin));
                    // 自动播放
                    this.toggleAudio();
                });
            } else {
                this.seekAudio(this.parseTime(fragment.clipBegin));
                if (!this.state.isAudioPlaying) {
                    this.toggleAudio();
                }
            }
        } else {
            console.warn("No audio fragment found for ID:", elementId);
        }
    }

    public applySettings() {
        if (!this.rendition) return;
        this.rendition.themes.fontSize(this.getFontSizeValue(this.settings.fontSize));
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
            this.rendition.themes.select(enabled ? 'dark' : this.settings.theme);
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

        const audioList = Array.from(this.audioGroups.keys());
        this.setState({ audioList });
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