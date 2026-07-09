import React, { useState, useEffect, useRef } from 'react';
import { Search as SearchIcon, X, FileText } from 'lucide-react';

interface SearchResult {
  file: string;
  path: string;
  line: number;
  content: string;
}

interface GlobalSearchProps {
  onClose: () => void;
  onSelect: (path: string, line?: number) => void;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length >= 2) {
        setIsSearching(true);
        const searchResults = await window.api.searchProjects(query);
        setResults(searchResults);
        setIsSearching(false);
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[600px] max-h-[60vh] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Search Input Area */}
        <div className="flex items-center p-4 border-b border-fleet-border gap-3">
          <SearchIcon size={20} className="text-gray-500" />
          <input 
            ref={inputRef}
            type="text" 
            placeholder="Search in all projects..."
            className="flex-1 bg-transparent border-none outline-none text-fleet-text text-lg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button onClick={onClose} className="p-1 hover:bg-fleet-active rounded text-gray-500">
            <X size={18} />
          </button>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto min-h-[100px]">
          {isSearching && (
            <div className="p-8 text-center text-gray-500 text-sm animate-pulse">Searching...</div>
          )}
          
          {!isSearching && results.length > 0 && (
            <div className="py-2">
              {results.map((res, i) => (
                <div 
                  key={`${res.path}-${res.line}-${i}`}
                  className="px-4 py-2 hover:bg-fleet-active cursor-pointer group"
                  onClick={() => onSelect(res.path, res.line)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 text-blue-400 text-sm font-medium">
                      <FileText size={14} />
                      <span>{res.file}</span>
                      <span className="text-gray-600 font-normal">:{res.line}</span>
                    </div>
                    <div className="text-[10px] text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity truncate ml-4 max-w-[250px]">
                      {res.path}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 font-mono truncate pl-6">
                    {res.content}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isSearching && query.length >= 2 && results.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No results found for "{query}"</div>
          )}

          {query.length < 2 && (
            <div className="p-8 text-center text-gray-600 text-sm italic">Type at least 2 characters to search...</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-fleet-header border-t border-fleet-border text-[10px] text-gray-600 flex justify-between">
          <span>{results.length} matches found</span>
          <span>ESC to close • ENTER to open</span>
        </div>
      </div>
    </div>
  );
};
