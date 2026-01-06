
import React, { useState, useEffect, useRef } from 'react';
import { DictionaryResponse, LearningLanguage, UILanguage } from '../types';
import { Search, Plus, Loader2, BookOpen, X, ArrowRight, Volume2, ExternalLink, PenTool, Globe, Puzzle, Pin, Type } from 'lucide-react';
import { translations } from '../lib/locales';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  word: string;
  sentence: string;
  learningLanguage: LearningLanguage;
  onAddToAnki: (term: string, definition: string, sentence?: string, scriptHtmlDef?: string) => Promise<void>;
  onAppendNext: (newTerm: string) => void;
  canAppend: boolean;
  isAddingToAnki: boolean;
  variant?: 'bottom-sheet' | 'sidebar';
  lang: UILanguage;
  searchEngine: string;
  segmentationMode: 'browser' | 'auto';
}

const DictionaryPanel: React.FC<Props> = ({ 
  isOpen, onClose, word, sentence, learningLanguage, onAddToAnki, onAppendNext, canAppend, isAddingToAnki, variant = 'bottom-sheet', lang, searchEngine, segmentationMode
}) => {
  const t = translations[lang];
  const [searchTerm, setSearchTerm] = useState(word);
  const [data, setData] = useState<DictionaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'dict' | 'web' | 'script'>('dict');
  const [scriptHtml, setScriptHtml] = useState<string | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [segments, setSegments] = useState<{ segment: string; isWordLike: boolean }[]>([]);
  
  const scriptTimeoutRef = useRef<number | null>(null);
  const currentRequestId = useRef<string>('');
  const isMountedRef = useRef(false);
  const segmenterRef = useRef<any>(null);
  const prevIsOpen = useRef(isOpen);
  const prevWord = useRef(word);

  useEffect(() => {
      isMountedRef.current = true;
      try {
        if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
            segmenterRef.current = new (Intl as any).Segmenter(learningLanguage, { granularity: 'word' });
        }
      } catch (e) {
          console.warn("Intl.Segmenter not supported", e);
      }
      return () => { isMountedRef.current = false; };
  }, [learningLanguage]);

  // Recalculate segments when sentence changes
  useEffect(() => {
    if (!sentence) {
        setSegments([]);
        return;
    }
    
    let newSegments: { segment: string; isWordLike: boolean }[] = [];
    
    if (segmentationMode === 'browser' && segmenterRef.current) {
        // Use Intl.Segmenter
        const iter = segmenterRef.current.segment(sentence);
        newSegments = Array.from(iter).map((s: any) => ({ segment: s.segment, isWordLike: s.isWordLike }));
    } else {
        // Fallback / Auto: Simple split by whitespace but preserve delimiters
        // This effectively handles space-separated languages by keeping spaces as segments
        // For CJK without spaces, this might treat the whole block as one if no spaces exist, 
        // unless we add specific CJK logic. However, 'auto' usually implies simple behavior.
        // If the user wants better CJK segmentation, they should use 'Browser' mode.
        newSegments = sentence.split(/(\s+)/).map((s) => ({ segment: s, isWordLike: /\S/.test(s) }));
    }
    setSegments(newSegments);
  }, [sentence, learningLanguage, segmentationMode]);

  useEffect(() => {
      const handleScriptMessage = (event: MessageEvent) => {
          if (!isMountedRef.current) return;
          if (event.data && event.data.type === 'VAM_SEARCH_RESPONSE') {
              const { html, error, id } = event.data.payload;
              if (id && id !== currentRequestId.current) return;
              if (!id && !scriptTimeoutRef.current) return;
              if (scriptTimeoutRef.current) {
                  clearTimeout(scriptTimeoutRef.current);
                  scriptTimeoutRef.current = null;
              }
              setScriptLoading(false);
              if (error) {
                  setScriptHtml(`<div class="text-red-400 p-4 text-center text-sm bg-red-500/10 rounded-lg border border-red-500/20">${error}</div>`);
              } else {
                  setScriptHtml(html);
              }
          }
      };
      window.addEventListener('message', handleScriptMessage);
      return () => {
          window.removeEventListener('message', handleScriptMessage);
          if (scriptTimeoutRef.current) clearTimeout(scriptTimeoutRef.current);
      };
  }, []);

  useEffect(() => {
    const wordChanged = word !== prevWord.current;
    const justOpened = isOpen && !prevIsOpen.current;
    prevIsOpen.current = isOpen;
    prevWord.current = word;

    if (!isOpen) return;
    if ((wordChanged && word) || justOpened) {
        setSearchTerm(word);
        if (activeTab === 'script') fetchFromScript(word);
        else { setActiveTab('dict'); fetchDefinition(word, learningLanguage); }
        return;
    }
  }, [isOpen, word, learningLanguage]);

  const fetchFromScript = (term: string) => {
      if (!term) return;
      if (scriptTimeoutRef.current) {
          clearTimeout(scriptTimeoutRef.current);
          scriptTimeoutRef.current = null;
      }
      setScriptLoading(true);
      const requestId = Date.now().toString();
      currentRequestId.current = requestId;
      window.postMessage({ type: 'VAM_SEARCH_REQUEST', payload: { word: term, lang: learningLanguage, id: requestId } }, '*');
      const timeoutId = window.setTimeout(() => {
          if (isMountedRef.current && currentRequestId.current === requestId) {
              setScriptLoading(false);
              setScriptHtml(`<div class="text-slate-500 text-center p-4 text-xs"><p>${(t as any).noScriptResponse || 'No script response'}</p><p class="mt-2 opacity-75 text-[10px]">${(t as any).installScriptHelp || 'Please ensure the script is installed'}</p></div>`);
              scriptTimeoutRef.current = null;
          }
      }, 5000);
      scriptTimeoutRef.current = timeoutId;
  };

  const fetchDefinition = async (term: string, langCode: string) => {
    if (!term) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await fetch(`https://freedictionaryapi.com/api/v1/entries/${langCode}/${encodeURIComponent(term)}`);
      if (!res.ok) throw new Error('Not found');
      const json = await res.json();
      if (json && json.length > 0) {
        const entry = json[0];
         const mappedData: DictionaryResponse = {
            word: entry.word,
            entries: json.map((e: any) => {
                const ipaPronunciation = e.phonetics?.find((p: any) => p.text);
                return {
                    language: langCode,
                    partOfSpeech: e.meanings?.[0]?.partOfSpeech || 'unknown',
                    phonetic: ipaPronunciation ? ipaPronunciation.text : undefined,
                    pronunciations: e.phonetics?.map((p: any) => ({ text: p.text, audio: p.audio })),
                    senses: e.meanings?.flatMap((m: any) => m.definitions.map((def: any) => ({ 
                        definition: def.definition, 
                        examples: def.example ? [def.example] : [], 
                        synonyms: def.synonyms || [], 
                        antonyms: def.antonyms || [] 
                    })))
                };
            })
        };
        setData(mappedData);
      } else setError((t as any).noDefFound || "No definition found");
    } catch (e) { setError((t as any).noDefFound || "No definition found"); } finally { setLoading(false); }
  };

  const handleManualSearch = (e: React.FormEvent) => {
      e.preventDefault();
      if (searchTerm.trim()) {
          if (activeTab === 'dict') fetchDefinition(searchTerm.trim(), learningLanguage);
          else if (activeTab === 'script') fetchFromScript(searchTerm.trim());
      }
  };
  
  const handleAppendNextClick = () => {
      if (!sentence || segments.length === 0) return;
      
      const fullText = segments.map(s => s.segment).join('');
      const idx = fullText.indexOf(searchTerm);
      if (idx === -1) return;
      
      const endIdx = idx + searchTerm.length;
      let currentLen = 0;
      let targetSegmentIdx = -1;
      
      for(let i=0; i<segments.length; i++) {
          currentLen += segments[i].segment.length;
          if (currentLen > endIdx) {
              targetSegmentIdx = i; 
              if (currentLen === endIdx) targetSegmentIdx = i + 1;
              break;
          } else if (currentLen === endIdx) {
              targetSegmentIdx = i + 1;
              break;
          }
      }
      
      if (targetSegmentIdx !== -1 && targetSegmentIdx < segments.length) {
          let nextText = "";
          for(let i = targetSegmentIdx; i < segments.length; i++) {
              nextText += segments[i].segment;
              if (segments[i].isWordLike) break;
          }
          
          if (nextText) {
             const newTerm = searchTerm + nextText;
             setSearchTerm(newTerm);
             if (activeTab === 'dict') fetchDefinition(newTerm, learningLanguage);
             else if (activeTab === 'script') fetchFromScript(newTerm);
             if (onAppendNext) onAppendNext(newTerm);
          }
      }
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-x-0 bottom-0 z-[60] flex flex-col transition-transform duration-300 ease-out transform ${isOpen ? 'translate-y-0' : 'translate-y-full'} h-[50vh] md:h-[400px] bg-white dark:bg-slate-900 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] rounded-t-2xl border-t dark:border-slate-700`}>
      {/* Header / Search Bar */}
      <div className="flex items-center gap-2 p-3 border-b dark:border-slate-800 shrink-0">
         <form onSubmit={handleManualSearch} className="flex-1 flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 border border-transparent focus-within:border-blue-500 transition-colors">
            <Search size={16} className="text-slate-400 mr-2" />
            <input 
               className="flex-1 bg-transparent border-none outline-none text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               placeholder={t.search}
            />
            {/* Append Button */}
            <button 
                type="button" 
                onClick={handleAppendNextClick}
                className="ml-2 p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                title={t.appendNext}
            >
                <Type size={14} />
                <Plus size={10} className="-ml-1 -mt-2" />
            </button>
         </form>
         <button onClick={onClose} className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><X size={20}/></button>
      </div>

      {/* Sentence Context with Intelligent Spacing */}
      {sentence && (
         <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-b dark:border-slate-800 text-sm text-slate-600 dark:text-slate-300 overflow-x-auto whitespace-nowrap scrollbar-hide shrink-0 font-serif leading-relaxed">
             <span className="inline-block">
                {segments.map((s, i) => {
                    return <span key={i} className={s.segment.includes(searchTerm) ? "bg-yellow-200 dark:bg-yellow-900/50 text-slate-900 dark:text-slate-100" : ""}>{s.segment}</span>;
                })}
             </span>
         </div>
      )}

      {/* Tabs */}
      <div className="flex border-b dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <button 
             onClick={() => setActiveTab('dict')}
             className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'dict' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
             API
          </button>
          <button 
             onClick={() => setActiveTab('script')}
             className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'script' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
             {t.scriptTab}
          </button>
          <button 
             onClick={() => setActiveTab('web')}
             className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'web' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
             Web
          </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-slate-900 relative">
          {activeTab === 'dict' && (
              <>
                 {loading && <div className="flex justify-center py-8 text-slate-400"><Loader2 className="animate-spin" /></div>}
                 {error && <div className="text-center py-8 text-slate-400 text-sm">{error}</div>}
                 {data && !loading && (
                     <div className="space-y-4">
                         <div className="flex items-baseline gap-2">
                             <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{data.word}</h2>
                         </div>
                         {data.entries.map((entry, i) => (
                             <div key={i} className="group">
                                 <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 uppercase tracking-wide">{entry.partOfSpeech}</span>
                                    {entry.phonetic && <span className="text-slate-500 font-mono text-xs">[{entry.phonetic}]</span>}
                                 </div>
                                 <ul className="list-decimal list-inside space-y-2 text-sm text-slate-700 dark:text-slate-300 ml-1">
                                     {entry.senses.map((sense, j) => (
                                         <li key={j} className="leading-relaxed">
                                             <span>{sense.definition}</span>
                                             {sense.examples && sense.examples.length > 0 && (
                                                 <div className="pl-4 mt-0.5 text-xs text-slate-500 italic border-l-2 border-slate-200 dark:border-slate-700">
                                                     "{sense.examples[0]}"
                                                 </div>
                                             )}
                                         </li>
                                     ))}
                                 </ul>
                             </div>
                         ))}
                     </div>
                 )}
              </>
          )}

          {activeTab === 'script' && (
              <div className="h-full">
                  {scriptLoading && <div className="flex justify-center py-8 text-slate-400"><Loader2 className="animate-spin" /></div>}
                  {scriptHtml ? (
                      <div className="script-content-container text-sm" dangerouslySetInnerHTML={{ __html: scriptHtml }} />
                  ) : (
                      !scriptLoading && <div className="text-center py-8 text-slate-400 text-sm">{t.noContent}</div>
                  )}
              </div>
          )}

          {activeTab === 'web' && (
              <div className="w-full h-full flex flex-col">
                    <iframe 
                        src={`https://www.google.com/search?igu=1&q=${encodeURIComponent(searchTerm)}`} 
                        className="w-full flex-1 border-0 rounded bg-white" 
                        sandbox="allow-forms allow-scripts allow-same-origin" 
                    />
              </div>
          )}
      </div>

      {/* Action Bar */}
      {(activeTab !== 'web' && (data || scriptHtml)) && (
          <div className="p-3 border-t dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0 flex justify-end">
               <button 
                  onClick={() => onAddToAnki(searchTerm, '', sentence, scriptHtml || undefined)}
                  disabled={isAddingToAnki}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all shadow-sm ${isAddingToAnki ? 'bg-slate-400 cursor-wait' : 'bg-green-600 hover:bg-green-700 active:scale-95'}`}
               >
                   {isAddingToAnki ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                   {t.addToAnki}
               </button>
          </div>
      )}
    </div>
  );
};

export default DictionaryPanel;
