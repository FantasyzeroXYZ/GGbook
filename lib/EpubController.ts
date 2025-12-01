import { AnkiSettings, AppSettings, Book, Chapter, DEFAULT_ANKI_SETTINGS, DEFAULT_SETTINGS, NavigationItem, ReaderState } from '../types';

type StateUpdater = (partialState: Partial<ReaderState>) => void;

export class EpubController {
    // Internal State
    private book: any = null;
    private state: ReaderState;
    private updateState: StateUpdater;
    
    // Settings
    public settings: AppSettings;
    public ankiSettings: AnkiSettings;
    
    // Audio
    private audioPlayer: HTMLAudioElement;
    private mediaOverlayData: any[] = [];
    private audioGroups: Map<string, any[]> = new Map();
    private currentAudioFile: string | null = null;
    private currentAudioIndex: number = -1;
    
    // Constants
    private HIGHLIGHT_CLASS = 'audio-highlight';

    // Refs (DOM elements needed for calculation)
    private containerRef: HTMLElement | null = null;

    constructor(initialState: ReaderState, updateState: StateUpdater) {
        this.state = initialState;
        this.updateState = updateState;
        
        // Load Settings
        const savedSettings = localStorage.getItem('epubReaderSettings');
        this.settings = savedSettings ? JSON.parse(savedSettings) : { ...DEFAULT_SETTINGS };
        
        const savedAnki = localStorage.getItem('epubReaderAnkiSettings');
        this.ankiSettings = savedAnki ? JSON.parse(savedAnki) : { ...DEFAULT_ANKI_SETTINGS };

        // Initialize Audio
        this.audioPlayer = new Audio();
        this.bindAudioEvents();
        
        // Apply initial settings
        this.setVolume(this.settings.audioVolume / 100);
        
        // Initial state sync
        this.updateState({
            isDarkMode: this.settings.darkMode,
            ankiConnected: false // Will test connection later
        });
    }

    public setContainerRef(ref: HTMLElement | null) {
        this.containerRef = ref;
    }

    public refreshLayout() {
        if (this.state.chapters.length > 0) {
            // Force re-calculation of pages
            const chapter = this.state.chapters[this.state.currentChapterIndex];
            if (chapter) {
                this.splitChapterIntoPages(chapter.content);
            }
        }
    }

    // ==========================================
    // Audio Logic
    // ==========================================
    private bindAudioEvents() {
        this.audioPlayer.addEventListener('loadedmetadata', () => {
            this.updateState({ audioDuration: this.audioPlayer.duration });
        });
        
        this.audioPlayer.addEventListener('timeupdate', () => {
            this.updateState({ audioCurrentTime: this.audioPlayer.currentTime });
            if (this.settings.syncTextHighlight) {
                this.updateAudioHighlight();
            }
        });
        
        this.audioPlayer.addEventListener('ended', () => {
            this.updateState({ isAudioPlaying: false });
        });
        
        this.audioPlayer.addEventListener('error', (e) => {
            console.error('Audio error', e);
            this.updateState({ isAudioPlaying: false });
        });
    }

    public toggleAudio() {
        if (this.state.isAudioPlaying) {
            this.audioPlayer.pause();
            this.updateState({ isAudioPlaying: false });
        } else {
            if (this.audioPlayer.src && this.audioPlayer.src !== window.location.href) {
                this.audioPlayer.play().catch(e => console.error("Play failed", e));
                this.updateState({ isAudioPlaying: true });
            } else if (this.currentAudioFile) {
                this.playAudioFile(this.currentAudioFile);
            } else if (this.audioGroups.size > 0) {
                const first = this.audioGroups.keys().next().value;
                this.playAudioFile(first);
            }
        }
    }

    public stopAudio() {
        this.audioPlayer.pause();
        this.audioPlayer.currentTime = 0;
        this.updateState({ isAudioPlaying: false, audioCurrentTime: 0 });
        this.clearAudioHighlight();
    }

    public seekAudio(time: number) {
        if (this.audioPlayer.src) {
            this.audioPlayer.currentTime = time;
        }
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
    // Book Loading & Parsing
    // ==========================================
    public async loadFile(file: File) {
        try {
            this.updateState({ isLoading: true, loadingMessage: 'Parsing EPUB file...' });
            
            if (typeof ePub === 'undefined') {
                throw new Error('ePub library not loaded');
            }

            this.book = ePub(file);
            await this.book.ready;
            
            const metadata = await this.book.loaded.metadata;
            const navigation = await this.book.loaded.navigation;
            
            // Process content
            const chapters: Chapter[] = [];
            const toc = navigation.toc || [];
            
            const spine = this.book.spine;
            this.updateState({ loadingMessage: `Loading ${spine.length} chapters...` });

            for (let i = 0; i < spine.length; i++) {
                const item = spine.get(i);
                if (item && item.linear !== false) {
                    try {
                        const section = await this.book.load(item.href);
                        let content = '';
                        if (section.render) {
                            content = await section.render();
                        } else if (section.document) {
                            content = section.document.body.innerHTML;
                        } else if (typeof section === 'string') {
                             const parser = new DOMParser();
                             const doc = parser.parseFromString(section, 'application/xhtml+xml');
                             content = doc.body.innerHTML;
                        }
                        
                        if (!content || typeof content !== 'string') {
                             content = await this.book.archive.getText(item.href);
                             const parser = new DOMParser();
                             const doc = parser.parseFromString(content, 'application/xhtml+xml');
                             content = doc.body ? doc.body.innerHTML : content;
                        }

                        content = await this.processContentImages(content, item.href);
                        
                        let title = `Chapter ${i + 1}`;
                        const navItem = this.findNavItemByHref(toc, item.href);
                        if (navItem) title = navItem.label;

                        chapters.push({
                            id: item.id,
                            title,
                            content,
                            href: item.href
                        });
                    } catch (e) {
                        console.warn('Failed to load chapter', i, e);
                    }
                }
            }

            if (chapters.length === 0) throw new Error("No readable content found");

            this.updateState({ loadingMessage: 'Loading Audio Data...' });
            
            // Don't let audio failure block book loading
            try {
                await this.loadAudioFromEPUB();
            } catch (err) {
                console.error('Audio loading failed', err);
            }

            this.updateState({
                currentBook: { title: metadata.title, author: metadata.creator },
                chapters,
                navigationMap: toc,
                isLoading: false,
                currentChapterIndex: 0
            });

            this.loadChapter(0);

        } catch (e: any) {
            console.error(e);
            this.updateState({ isLoading: false, loadingMessage: '' });
            alert('Error loading book: ' + e.message);
        }
    }

    private findNavItemByHref(items: NavigationItem[], href: string): NavigationItem | null {
        for (const item of items) {
            if (item.href === href || item.href.endsWith(href) || href.endsWith(item.href)) return item;
            if (item.subitems) {
                const found = this.findNavItemByHref(item.subitems, href);
                if (found) return found;
            }
        }
        return null;
    }

    private async processContentImages(content: string, baseHref: string): Promise<string> {
        if (!content) return content;
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        
        const images = doc.querySelectorAll('img');
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const src = img.getAttribute('src');
            if (src && !src.startsWith('data:') && !src.startsWith('http')) {
                try {
                    const url = this.book.path.resolve(src, baseHref);
                    const blob = await this.book.load(url);
                    if (blob) {
                        img.src = URL.createObjectURL(blob);
                    }
                } catch (e) {
                    console.warn('Failed to load image', src);
                }
            }
        }
        return doc.body.innerHTML;
    }

    // ==========================================
    // Pagination & Navigation Logic
    // ==========================================
    public loadChapter(index: number) {
        if (index < 0 || index >= this.state.chapters.length) return;
        
        this.updateState({ currentChapterIndex: index });
        const chapter = this.state.chapters[index];
        this.splitChapterIntoPages(chapter.content);
    }

    public prevPage() {
        const { currentSectionIndex, currentChapterIndex } = this.state;
        if (currentSectionIndex > 0) {
            this.updateState({ currentSectionIndex: currentSectionIndex - 1 });
        } else if (currentChapterIndex > 0) {
            this.loadChapter(currentChapterIndex - 1);
        }
    }

    public nextPage() {
        const { currentSectionIndex, currentChapterIndex, sections, chapters } = this.state;
        if (currentSectionIndex < sections.length - 1) {
            this.updateState({ currentSectionIndex: currentSectionIndex + 1 });
        } else if (currentChapterIndex < chapters.length - 1) {
            this.loadChapter(currentChapterIndex + 1);
        }
    }

    private splitChapterIntoPages(content: string) {
        const winW = typeof window !== 'undefined' ? window.innerWidth : 600;
        const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
        
        const containerW = this.containerRef?.clientWidth || 0;
        const containerH = this.containerRef?.clientHeight || 0;
        
        let width = containerW > 100 ? containerW - 80 : Math.min(600, winW - 40);
        let height = containerH > 100 ? containerH - 80 : winH - 140;
        
        if (width < 300) width = 300;
        if (height < 400) height = 500;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.width = `${width}px`;
        tempDiv.style.fontSize = this.getFontSizeValue(this.settings.fontSize);
        tempDiv.style.lineHeight = '1.8';
        tempDiv.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif'; 
        document.body.appendChild(tempDiv);

        const sections: string[] = [];
        const elements = this.getPageElements(tempDiv);

        if (elements.length === 0) {
            sections.push(content);
        } else {
            let currentPageElements: Element[] = [];
            let currentHeight = 0;

            for (let element of elements) {
                 const elInfo = this.getElementInfo(element, width);
                 
                 if (elInfo.totalHeight > height) {
                     if (currentPageElements.length > 0) {
                         sections.push(currentPageElements.map(e => e.outerHTML).join(''));
                         currentPageElements = [];
                         currentHeight = 0;
                     }
                     const splitEls = this.splitLargeElement(element, height, width);
                     currentPageElements.push(...splitEls);
                     currentHeight = this.calculateElementsHeight(currentPageElements, width);
                 } else {
                     if (currentHeight + elInfo.totalHeight > height) {
                         sections.push(currentPageElements.map(e => e.outerHTML).join(''));
                         currentPageElements = [];
                         currentHeight = 0;
                     }
                     currentPageElements.push(element);
                     currentHeight += elInfo.totalHeight;
                 }
            }
            if (currentPageElements.length > 0) {
                sections.push(currentPageElements.map(e => e.outerHTML).join(''));
            }
        }
        
        document.body.removeChild(tempDiv);
        
        // Final fallback: if pagination logic produced nothing, verify original content
        if (sections.length === 0 && content.length > 0) {
            sections.push(content);
        }

        this.updateState({ sections, currentSectionIndex: 0 });
    }

    private getPageElements(container: Element): Element[] {
        const elements: Element[] = [];
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                const tags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'TABLE', 'FIGURE', 'IMG', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'SPAN', 'HR'];
                if (tags.includes(node.nodeName)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        });
        let node;
        while (node = walker.nextNode() as Element) {
            elements.push(node.cloneNode(true) as Element);
        }
        return elements;
    }

    private getElementInfo(element: Element, width: number) {
        const temp = document.createElement('div');
        temp.appendChild(element.cloneNode(true));
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.width = `${width}px`;
        temp.style.fontSize = this.getFontSizeValue(this.settings.fontSize);
        temp.style.lineHeight = '1.8';
        
        document.body.appendChild(temp);
        const height = temp.offsetHeight;
        const style = window.getComputedStyle(element);
        const marginTop = parseFloat(style.marginTop) || 0;
        const marginBottom = parseFloat(style.marginBottom) || 0;
        document.body.removeChild(temp);
        
        return { height, totalHeight: height + marginTop + marginBottom };
    }

    private calculateElementsHeight(elements: Element[], width: number) {
        if (elements.length === 0) return 0;
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.width = `${width}px`;
        elements.forEach(e => temp.appendChild(e.cloneNode(true)));
        document.body.appendChild(temp);
        const h = temp.offsetHeight;
        document.body.removeChild(temp);
        return h;
    }

    private splitLargeElement(element: Element, maxHeight: number, width: number): Element[] {
         if (['P', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'SECTION', 'ARTICLE'].includes(element.tagName)) {
             return this.splitTextElement(element, maxHeight, width);
         }
         return [element];
    }

    private splitTextElement(element: Element, maxHeight: number, width: number): Element[] {
        const text = element.textContent || '';
        const sentences = text.split(/([.!?])\s+/);
        const parts: Element[] = [];
        let currentChunk: string[] = [];
        
        const createEl = (str: string) => {
             const el = element.cloneNode() as HTMLElement;
             el.textContent = str;
             return el;
        };

        const checkHeight = (str: string) => {
             const t = createEl(str);
             const info = this.getElementInfo(t, width);
             return info.totalHeight;
        }

        for (let i = 0; i < sentences.length; i+=2) {
            const sentence = sentences[i] + (sentences[i+1] || '');
            const testChunk = [...currentChunk, sentence];
            const testStr = testChunk.join(' ');
            
            if (checkHeight(testStr) > maxHeight && currentChunk.length > 0) {
                 parts.push(createEl(currentChunk.join(' ')));
                 currentChunk = [sentence];
            } else {
                 currentChunk.push(sentence);
            }
        }
        
        if (currentChunk.length > 0) {
            parts.push(createEl(currentChunk.join(' ')));
        }
        return parts;
    }

    public getFontSizeValue(size: string) {
        switch(size) {
            case 'small': return '0.9rem';
            case 'large': return '1.3rem';
            case 'xlarge': return '1.5rem';
            default: return '1.1rem';
        }
    }

    // ==========================================
    // SMIL & Audio Parsing
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
            if (res.length) {
                this.mediaOverlayData.push(...res);
            }
        }
        
        this.audioGroups.clear();
        this.mediaOverlayData.forEach((frag, idx) => {
            const file = frag.audioSrc;
            if (!this.audioGroups.has(file)) this.audioGroups.set(file, []);
            this.audioGroups.get(file)!.push({ ...frag, originalIndex: idx });
        });

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
                if (doc instanceof Blob) {
                    text = await doc.text();
                } else if (typeof doc === 'string') {
                    text = doc;
                } else if (doc && doc.documentElement) {
                    const serializer = new XMLSerializer();
                    text = serializer.serializeToString(doc);
                }
            } catch(e) {
                text = await this.book.archive.getText(item.href);
            }

            if (!text) return [];

            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'application/xml');
            
            if (xml.querySelector('parsererror')) {
                return [];
            }

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
                    
                    if (textSrc && audioSrc) {
                        fragments.push({ textSrc, audioSrc, clipBegin, clipEnd });
                    }
                }
            }
            return fragments;
        } catch (e) {
            console.error('Failed to parse SMIL', item.href, e);
            return [];
        }
    }

    private resolvePath(rel: string | null, base: string) {
        if (!rel) return '';
        if (rel.startsWith('/')) return rel;
        
        const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
        const stack = baseDir.split('/').filter(x => x && x !== '.');
        const parts = rel.split('/').filter(x => x && x !== '.');
        
        for (const p of parts) {
            if (p === '..') {
                if (stack.length > 0) stack.pop();
            } else {
                stack.push(p);
            }
        }
        return stack.join('/');
    }

    private async findAudioBlob(path: string): Promise<string | null> {
        console.log(`[Audio] Resolving: ${path}`);
        
        // Strategy 0: Direct ePub.js resolution (often fails for relative paths without package context)
        try {
             let blob = await this.book.archive.getBlob(path);
             if (blob) return URL.createObjectURL(blob);
        } catch(e) {}

        // Strategy 1: Package Path Resolution (Requested Fix)
        // If the path is relative, we must resolve it relative to the OPF package file
        if (this.book.container && this.book.container.packagePath) {
             const pkgPath = this.book.container.packagePath; // e.g. "OEBPS/content.opf"
             const pkgDir = pkgPath.substring(0, pkgPath.lastIndexOf('/')); // "OEBPS"
             
             if (pkgDir) {
                 const cleanPath = path.startsWith('/') ? path.slice(1) : path;
                 // Ensure path looks like /OEBPS/Audio/file.mp3
                 // archive.getBlob expects absolute path with leading slash if inside a folder
                 
                 // Try exact path appended to package dir
                 const absPath = `/${pkgDir}/${cleanPath}`;
                 
                 console.log(`[Audio] Strategy 1 (Package Path): Trying ${absPath}`);
                 try {
                     const blob = await this.book.archive.getBlob(absPath);
                     if (blob) {
                         console.log(`[Audio] Found via Package Path`);
                         return URL.createObjectURL(blob);
                     }
                 } catch(e) {
                     console.warn(`[Audio] Strategy 1 failed for ${absPath}`);
                 }
             }
        }

        // Strategy 2: Standard Absolute Path
        // Sometimes the path is already correct for the root
        try {
            const p = path.startsWith('/') ? path : '/' + path;
            const blob = await this.book.archive.getBlob(p);
            if (blob) {
                console.log(`[Audio] Found via Standard Path: ${p}`);
                return URL.createObjectURL(blob);
            }
        } catch(e) {}

        // Strategy 3: Direct Zip Access (Fuzzy Search)
        // This iterates the actual files in the zip to find a match by filename suffix.
        if (this.book.archive && this.book.archive.zip && this.book.archive.zip.files) {
             const targetName = path.split('/').pop()?.toLowerCase(); // "chapter_001.mp3"
             if (!targetName) return null;

             const entries = Object.keys(this.book.archive.zip.files);
             // Find entry ending with /targetName or equaling targetName
             // Use explicit loop for clarity or .find
             const match = entries.find(e => e.toLowerCase().endsWith('/' + targetName) || e.toLowerCase() === targetName);
             
             if (match) {
                 console.log(`[Audio] Found via Fuzzy Zip: ${match}`);
                 // Access the file object directly using the key from entries
                 // Avoid zip.file(path) normalization issues by using array access
                 const fileObj = this.book.archive.zip.files[match];
                 if (fileObj) {
                     try {
                         // Use async('blob') directly from the ZipObject
                         const blob = await fileObj.async('blob');
                         
                         // Fix MIME type because zip extraction often defaults to octet-stream
                         const ext = targetName.split('.').pop();
                         let mime = 'application/octet-stream';
                         if (ext === 'mp3') mime = 'audio/mpeg';
                         if (ext === 'm4a' || ext === 'mp4') mime = 'audio/mp4';
                         if (ext === 'ogg') mime = 'audio/ogg';
                         if (ext === 'wav') mime = 'audio/wav';
                         
                         const newBlob = new Blob([blob], { type: mime });
                         const url = URL.createObjectURL(newBlob);
                         console.log(`[Audio] Blob created successfully: ${url}`);
                         return url;
                     } catch(e) {
                         console.error('[Audio] Zip read failed', e);
                     }
                 }
             }
        }
        
        console.error(`[Audio] Failed to find audio file: ${path}`);
        return null;
    }

    public async playAudioFile(audioPath: string) {
        try {
            this.currentAudioFile = audioPath;
            
            const url = await this.findAudioBlob(audioPath);
            
            if (url) {
                this.audioPlayer.src = url;
                this.audioPlayer.play().catch(e => console.error('Play failed', e));
                this.updateState({ 
                    isAudioPlaying: true, 
                    audioTitle: audioPath.split('/').pop() || 'Audio'
                });
            } else {
                console.error("Could not find audio file:", audioPath);
                this.updateState({ audioTitle: 'Audio Not Found' });
            }

        } catch (e) {
            console.error("Play error", e);
        }
    }

    private updateAudioHighlight() {
        if (!this.state.isAudioPlaying || !this.currentAudioFile) return;
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
                this.highlightElement(id);
                // Check if element is in current view
                const el = document.getElementById(id);
                if (!el) {
                    // Try to find which page contains this ID
                    // This is an expensive operation, so we do it only when needed
                    const pageIndex = this.state.sections.findIndex(s => s.indexOf(`id="${id}"`) !== -1 || s.indexOf(`id='${id}'`) !== -1);
                    
                    if (pageIndex !== -1 && pageIndex !== this.state.currentSectionIndex) {
                        this.updateState({ currentSectionIndex: pageIndex });
                        // Re-apply highlight after DOM updates
                        setTimeout(() => {
                            this.highlightElement(id);
                            const newEl = document.getElementById(id);
                            if (newEl) newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 200);
                    }
                } else {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
    }

    private highlightElement(id: string) {
        document.querySelectorAll('.' + this.HIGHLIGHT_CLASS).forEach(e => e.classList.remove(this.HIGHLIGHT_CLASS));
        const el = document.getElementById(id);
        if (el) el.classList.add(this.HIGHLIGHT_CLASS);
    }
    
    private clearAudioHighlight() {
         document.querySelectorAll('.' + this.HIGHLIGHT_CLASS).forEach(e => e.classList.remove(this.HIGHLIGHT_CLASS));
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
    // Dictionary & Anki
    // ==========================================
    public async lookupWord(word: string) {
        if (!word) return;
        this.updateState({ 
            dictionaryModalVisible: true, 
            dictionaryLoading: true, 
            dictionaryError: null,
            selectedText: word
        });
        
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
            if (!res.ok) throw new Error('Word not found');
            const data = await res.json();
            this.updateState({ dictionaryData: data[0], dictionaryLoading: false });
        } catch (e: any) {
            this.updateState({ dictionaryError: e.message, dictionaryLoading: false });
        }
    }
    
    public async testAnki() {
         try {
             const res = await this.ankiRequest('version');
             if (res) {
                 this.updateState({ ankiConnected: true });
                 const decks = await this.ankiRequest('deckNames');
                 const models = await this.ankiRequest('modelNames');
                 this.updateState({ ankiDecks: decks || [], ankiModels: models || [] });
                 return true;
             }
         } catch(e) {
             this.updateState({ ankiConnected: false });
             return false;
         }
         return false;
    }

    public async loadAnkiFields(modelName: string) {
        if (!modelName) return;
        const fields = await this.ankiRequest('modelFieldNames', { modelName });
        this.updateState({ ankiFields: fields || [] });
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