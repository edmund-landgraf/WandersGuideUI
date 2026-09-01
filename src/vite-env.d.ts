/// <reference types="vite/client" />

type WellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
type StartInDirectory = FileSystemDirectoryHandle | FileSystemFileHandle | WellKnownDirectory;

interface Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: StartInDirectory;
  }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    id?: string;
    multiple?: boolean;
    startIn?: StartInDirectory;
  }) => Promise<FileSystemFileHandle[]>;
}
