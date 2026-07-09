import React, { useState, useEffect, useRef } from 'react';
import { File as FileIcon, X, Search } from 'lucide-react';

interface FileResult {
  name: string;
  path: string;
}

interface FileSearchProps {
  onClose: () => void;
  onSelect: (path: string) => void;
}

export const FileSearch: React.FC<FileSearchProps> = ({ onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileResult[]>([]);
  const [allFiles, setAllFiles] = useState<FileResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    
    // Load all file paths once when search opens
    window.api.getWorkspaces().then(trees => {
      const flat: FileResult[] = [];
      const flatten = (nodes: any[]) => {
        for (const node of nodes) {
          if (node.type === 'file') {
            flat.push({ name: node.name, path: node.path });
          } else if (node.children) {
            flatten(node.children);
          }
        }
      };
      flatten(trees);
      setAllFiles(flat);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      }
      if (e.key === 'Enter' && results[selectedIndex]) {
        onSelect(results[selectedIndex].path);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, results, selectedIndex, onSelect]);

  useEffect(() => {
    if (query.trim() === '') {
      setResults([]);
      return;
    }
    const q = query.toLowerCase();
    const filtered = allFiles
      .filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .slice(0, 20); // Show top 20 matches
    setResults(filtered);
    setSelectedIndex(0);
  }, [query, allFiles]);

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm">
      <div className="w-[500px] bg-fleet-sidebar border border-fleet-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center p-3 border-b border-fleet-border gap-2">
          <Search size={18} className="text-gray-500" />
          <input 
            ref={inputRef}
            type="text" 
            placeholder="Search files everywhere..."
            className="flex-1 bg-transparent border-none outline-none text-fleet-text text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto">
          {results.map((res, i) => (
            <div 
              key={res.path}
              className={`px-4 py-2 flex flex-col cursor-pointer ${selectedIndex === i ? 'bg-fleet-active' : 'hover:bg-fleet-active/50'}`}
              onClick={() => onSelect(res.path)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="flex items-center gap-2 text-sm text-gray-200">
                <FileIcon size={14} className="text-blue-400" />
                <span className="font-medium">{res.name}</span>
              </div>
              <div className="text-[10px] text-gray-500 truncate pl-6">
                {res.path}
              </div>
            </div>
          ))}
          {query && results.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No files matching "{query}"</div>
          )}
          {!query && (
            <div className="p-8 text-center text-gray-600 text-sm italic">Start typing a filename...</div>
          )}
        </div>
        
        <div className="px-3 py-1.5 bg-fleet-header border-t border-fleet-border text-[9px] text-gray-600 flex justify-between uppercase tracking-wider">
          <span>{results.length} files found</span>
          <span>Double-Shift to Close</span>
        </div>
      </div>
    </div>
  );
};
