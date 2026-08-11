import {
  ChevronRight,
  ChevronDown,
  FileJson,
  FileType2,
  FileCode2,
  FileText,
  File,
  Globe
} from 'lucide-react'

export function getFileIcon(name: string, type: 'file' | 'directory', expanded: boolean) {
  if (type === 'directory') {
    return expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
  }

  if (name.endsWith('.json')) return <FileJson size={14} className="text-yellow-500" />
  if (name.endsWith('.md')) return <FileText size={14} className="text-blue-400" />
  if (name.endsWith('.py')) return <FileCode2 size={14} className="text-green-500" />
  if (name.endsWith('.ts') || name.endsWith('.tsx'))
    return <FileType2 size={14} className="text-blue-400" />
  if (name.endsWith('.js') || name.endsWith('.jsx'))
    return <FileType2 size={14} className="text-yellow-400" />
  // Same icon the HTTP Client extension uses, so the two read as one feature.
  if (name.endsWith('.http') || name.endsWith('.rest'))
    return <Globe size={14} className="text-emerald-400" />

  return <File size={14} className="text-gray-400" />
}
