import { LibraryBook, BookProgress, Bookmark } from '../types';

const DB_NAME = 'EpubReaderDB';
const DB_VERSION = 1;
const STORE_BOOKS = 'books';
const STORE_FILES = 'files';

// 简单的 IndexedDB 封装，用于存储书籍元数据和文件内容
export class BooksDB {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                // 存储元数据
                if (!db.objectStoreNames.contains(STORE_BOOKS)) {
                    db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
                }
                // 存储文件 Blob (单独存储以提高列表加载性能)
                if (!db.objectStoreNames.contains(STORE_FILES)) {
                    db.createObjectStore(STORE_FILES, { keyPath: 'id' });
                }
            };
        });
    }

    async addBook(book: LibraryBook, file: Blob): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_BOOKS, STORE_FILES], 'readwrite');
            
            transaction.objectStore(STORE_BOOKS).put(book);
            transaction.objectStore(STORE_FILES).put({ id: book.id, file });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getAllBooks(): Promise<LibraryBook[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_BOOKS, 'readonly');
            const request = transaction.objectStore(STORE_BOOKS).getAll();

            request.onsuccess = () => {
                // 按添加时间倒序排序
                const books = request.result as LibraryBook[];
                books.sort((a, b) => b.addedAt - a.addedAt);
                resolve(books);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getBookFile(id: string): Promise<Blob | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_FILES, 'readonly');
            const request = transaction.objectStore(STORE_FILES).get(id);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.file : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteBook(id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_BOOKS, STORE_FILES], 'readwrite');
            
            transaction.objectStore(STORE_BOOKS).delete(id);
            transaction.objectStore(STORE_FILES).delete(id);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async updateBookProgress(id: string, progress: BookProgress): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_BOOKS, 'readwrite');
            const store = transaction.objectStore(STORE_BOOKS);
            const request = store.get(id);

            request.onsuccess = () => {
                const data = request.result as LibraryBook;
                if (data) {
                    data.progress = progress;
                    store.put(data);
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updateBookBookmarks(id: string, bookmarks: Bookmark[]): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(STORE_BOOKS, 'readwrite');
            const store = transaction.objectStore(STORE_BOOKS);
            const request = store.get(id);

            request.onsuccess = () => {
                const data = request.result as LibraryBook;
                if (data) {
                    data.bookmarks = bookmarks;
                    store.put(data);
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

export const db = new BooksDB();