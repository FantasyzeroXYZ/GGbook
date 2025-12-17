import React from 'react';
import { LibraryBook, ReaderState, AppSettings } from '../types';
import { Icon } from './Icon';
import { translations } from '../lib/locales';

interface LibraryViewProps {
    state: ReaderState;
    libraryBooks: LibraryBook[];
    openBook: (book: LibraryBook) => void;
    deleteBook: (id: string, e: React.MouseEvent) => void;
    handleImportBook: (e: React.ChangeEvent<HTMLInputElement>) => void;
    updateSetting: (key: keyof AppSettings, val: any) => void;
    tempSettings: AppSettings;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
    state,
    libraryBooks,
    openBook,
    deleteBook,
    handleImportBook,
    updateSetting,
    tempSettings
}) => {
    const t = translations[tempSettings.language || 'zh'];

    const exportMarkdown = (e: React.MouseEvent, book: LibraryBook) => {
        e.stopPropagation();
        if (!book.bookmarks || book.bookmarks.length === 0) {
            alert(t.noBookmarks);
            return;
        }

        let mdContent = `# ${book.title}\n`;
        if (book.author) mdContent += `*${book.author}*\n\n`;
        mdContent += `---\n\n`;

        // Sort bookmarks by creation time
        const sortedBookmarks = [...book.bookmarks].sort((a, b) => a.createdAt - b.createdAt);

        sortedBookmarks.forEach(bm => {
            if (bm.type === 'highlight' && bm.text) {
                // Highlight Format
                mdContent += `> ${bm.text.replace(/\n/g, '\n> ')}\n\n`;
                mdContent += `<small>${t.highlight} | ${new Date(bm.createdAt).toLocaleString()} | ${bm.label}</small>\n\n`;
            } else {
                // Bookmark Format
                mdContent += `### ${bm.label}\n`;
                mdContent += `<small>${t.pageBookmark} | ${new Date(bm.createdAt).toLocaleString()}</small>\n\n`;
            }

            // Common Color & Note info
            if (bm.color && bm.color !== '#FFEB3B') {
                 mdContent += `**${t.bookmarkColor}:** ${bm.color}\n\n`;
            }

            if (bm.note) {
                mdContent += `**Note:**\n${bm.note}\n\n`;
            }

            mdContent += `---\n\n`;
        });

        const blob = new Blob([mdContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${book.title.replace(/\s+/g, '_')}_notes.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className={`min-h-[100dvh] flex flex-col ${state.isDarkMode ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-100 text-gray-800'}`}>
            <div className="flex justify-between items-center p-4 bg-white dark:bg-gray-800 shadow-md sticky top-0 z-30">
                <h1 className="text-xl font-bold flex items-center gap-2">
                    <Icon name="book-reader" /> React EPUB Reader
                </h1>
                <div className="flex gap-4">
                    <button onClick={() => updateSetting('darkMode', !state.isDarkMode)} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                        <Icon name={state.isDarkMode ? 'sun' : 'moon'}/>
                    </button>
                </div>
            </div>

            <div className="flex-1 container mx-auto p-2 md:p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg md:text-2xl font-bold">我的书架</h2>
                    <label className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base rounded cursor-pointer transition-colors flex items-center gap-2">
                        <Icon name="plus" /> 导入
                        <input type="file" className="hidden" accept=".epub" onChange={handleImportBook} />
                    </label>
                </div>

                {state.isLoading && (
                    <div className="text-center py-10">
                        <div className="loader inline-block border-4 border-gray-200 border-t-blue-500 rounded-full w-8 h-8 animate-spin-custom mb-2"></div>
                        <p>{state.loadingMessage}</p>
                    </div>
                )}

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 md:gap-6 pb-20">
                    {libraryBooks.map(book => (
                        <div key={book.id} onClick={() => openBook(book)} className="bg-white dark:bg-gray-800 rounded-md shadow hover:shadow-lg transition-shadow cursor-pointer overflow-hidden border dark:border-gray-700 flex flex-col group relative h-full">
                            <div className="w-full aspect-[3/4] bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-400 overflow-hidden relative">
                                {book.coverUrl ? (
                                    <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                                ) : (
                                    <Icon name="book" className="text-2xl md:text-4xl" />
                                )}
                                {/* Export Icon on hover */}
                                {book.bookmarks && book.bookmarks.length > 0 && (
                                     <button 
                                        onClick={(e) => exportMarkdown(e, book)}
                                        className="absolute bottom-1 right-1 p-1.5 bg-gray-800/70 text-white rounded-full opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-blue-600"
                                        title={t.exportNotes}
                                    >
                                        <Icon name="file-export" className="text-xs" />
                                    </button>
                                )}
                            </div>
                            <div className="p-2 flex-1 flex flex-col justify-start pb-6">
                                <h3 className="font-bold text-[11px] md:text-base leading-tight mb-1 line-clamp-2" title={book.title}>{book.title}</h3>
                                <p className="text-[10px] md:text-sm text-gray-500 dark:text-gray-400 truncate hidden sm:block">{book.author}</p>
                            </div>
                            {/* 进度条显示 - 放在底部 */}
                            {book.progress && (
                                <div className="w-full h-2 bg-gray-300 dark:bg-gray-600 mt-auto z-20 relative">
                                    <div 
                                        className="h-full bg-blue-500 transition-all duration-300" 
                                        style={{ width: `${Math.round((book.progress.percentage || 0) * 100)}%` }}
                                        title={`Progress: ${Math.round((book.progress.percentage || 0) * 100)}%`}
                                    ></div>
                                </div>
                            )}
                            <button 
                                onClick={(e) => deleteBook(book.id, e)}
                                className="absolute top-1 right-1 p-1.5 md:p-2 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-600 z-10"
                                title="删除"
                            >
                                <Icon name="trash" className="text-xs md:text-sm"/>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};