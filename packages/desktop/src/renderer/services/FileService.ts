/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getBaseUrl } from '@/common/adapter/httpBridge';
import { trackUpload, type UploadSource } from '@/renderer/hooks/file/useUploadState';
import { AIONUI_TIMESTAMP_REGEX } from '@/common/config/constants';
import { formatByteSize } from '@/renderer/services/i18n/format';

/** Sentinel error message used when an upload is cancelled by the caller. */
export const UPLOAD_ABORTED_ERROR = 'Upload aborted';

export interface UploadFileOptions {
  /** Cancel the upload from the outside. Closing the XHR also frees the backend connection. */
  signal?: AbortSignal;
}

/**
 * Upload a file to the backend via HTTP multipart.
 *
 * Works in both Electron (via `http://127.0.0.1:<backendPort>`) and WebUI
 * (same-origin reverse-proxied). Conversation-bound uploads go to the
 * workspace uploads directory; pre-conversation uploads go to temp storage.
 *
 * Field names match the backend contract exactly (snake_case): `file`,
 * `file_name` (optional), `conversation_id` (optional). The response is
 * `ApiResponse<String>` where `data` is the absolute file path on disk.
 *
 * @param onProgress Optional callback receiving upload percentage (0-100).
 * @param options    Optional bag — currently supports an `AbortSignal` so callers can cancel.
 */
export async function uploadFileViaHttp(
  file: File,
  conversation_id?: string,
  onProgress?: (percent: number) => void,
  file_name?: string,
  options?: UploadFileOptions
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  if (file_name) {
    formData.append('file_name', file_name);
  }
  if (conversation_id) {
    formData.append('conversation_id', conversation_id);
  }

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getBaseUrl()}/api/fs/upload`);

    // Wire AbortSignal → xhr.abort. Closing the XHR tears down the underlying
    // socket; the backend (axum/multer) treats the truncated multipart body as
    // a client disconnect and stops reading. No explicit cancel IPC needed.
    const signal = options?.signal;
    let onSignalAbort: (() => void) | null = null;
    if (signal) {
      if (signal.aborted) {
        // Caller asked to abort before send — bail out without opening a socket.
        reject(new Error(UPLOAD_ABORTED_ERROR));
        return;
      }
      onSignalAbort = () => {
        try {
          xhr.abort();
        } catch {
          /* ignore */
        }
      };
      signal.addEventListener('abort', onSignalAbort);
    }

    const detachSignal = (): void => {
      if (signal && onSignalAbort) {
        signal.removeEventListener('abort', onSignalAbort);
        onSignalAbort = null;
      }
    };

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      detachSignal();
      if (xhr.status === 413) {
        reject(new Error('FILE_TOO_LARGE'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        return;
      }
      try {
        const result = JSON.parse(xhr.responseText) as { success: boolean; data?: string };
        if (!result.success || typeof result.data !== 'string' || !result.data) {
          reject(new Error('Upload failed: server returned unsuccessful response'));
        } else {
          resolve(result.data);
        }
      } catch {
        reject(new Error('Upload failed: invalid server response'));
      }
    });

    xhr.addEventListener('error', () => {
      detachSignal();
      reject(new Error('Upload failed: network error'));
    });

    xhr.addEventListener('abort', () => {
      detachSignal();
      reject(new Error(UPLOAD_ABORTED_ERROR));
    });

    xhr.send(formData);
  });
}

/** All supported file extensions. */
export const allSupportedExts = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.flac',
  '.pdf',
  '.doc',
  '.docx',
  '.pptx',
  '.xlsx',
  '.odt',
  '.odp',
  '.ods',
  '.txt',
  '.md',
  '.json',
  '.xml',
  '.csv',
  '.log',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.html',
  '.css',
  '.scss',
  '.py',
  '.java',
  '.cpp',
  '.c',
  '.h',
  '.go',
  '.rs',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.conf',
  '.config',
];

export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
}

/**
 * @deprecated placeholder — all file types are accepted; callers can drop the
 * supportedExts.length check once file-type filtering is removed upstream.
 */
export function isSupportedFile(_file_name: string, _supportedExts: string[]): boolean {
  return true;
}

export function getFileExtension(file_name: string): string {
  const lastDotIndex = file_name.lastIndexOf('.');
  return lastDotIndex > -1 ? file_name.substring(lastDotIndex).toLowerCase() : '';
}

export function cleanAionUITimestamp(file_name: string): string {
  return file_name.replace(AIONUI_TIMESTAMP_REGEX, '$1');
}

export function getCleanFileNames(file_paths: string[]): string[] {
  return file_paths.map((p) => cleanAionUITimestamp(p.split(/[\\/]/).pop() || ''));
}

export function formatFileSize(bytes: number, decimals = 2, language?: string): string {
  return formatByteSize(bytes, language, decimals);
}

/**
 * Extract files from a drag/drop event.
 * Electron 32+: `File.path` is removed; the absolute path comes from the
 * preload bridge via `window.electronAPI.getPathForFile`. Falls back to the
 * legacy `file.path` property on older Electron / test environments.
 */
export function getFilesFromDropEvent(event: DragEvent): FileMetadata[] {
  const files: FileMetadata[] = [];

  if (!event.dataTransfer?.files) {
    return files;
  }

  for (let i = 0; i < event.dataTransfer.files.length; i++) {
    const file = event.dataTransfer.files[i];
    const electronFile = file as File & { path?: string };

    files.push({
      name: file.name,
      path: window.electronAPI?.getPathForFile?.(file) || electronFile.path || '',
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
  }

  return files;
}

/** Extract plain text from a drag/drop event. */
export function getTextFromDropEvent(event: DragEvent): string {
  return event.dataTransfer?.getData('text/plain') || '';
}

class FileServiceClass {
  /**
   * Process files from drag/drop, paste, or the attach button, uploading each
   * via HTTP multipart and returning the backend's managed stored path.
   *
   * Every file is uploaded — even Electron OS drags that expose an absolute
   * `path`. The chat send contract sends attachments as `upload` refs, and the
   * backend rejects any upload path that is not under its managed upload
   * directory (`temp_dir/aionui/...`). Passing the raw device path (the old
   * behaviour) now fails with "uploaded file path is outside the managed upload
   * directory", so we always route through the upload endpoint to obtain a
   * managed path.
   */
  async processDroppedFiles(
    files: FileList,
    conversation_id?: string,
    source: UploadSource = 'sendbox'
  ): Promise<FileMetadata[]> {
    const processedFiles: FileMetadata[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Each upload owns its own AbortController; the tracker exposes an `abort()`
      // that triggers the signal so user-driven cancel and conversation-switch
      // bulk-abort go through the same path.
      const controller = new AbortController();
      const tracker = trackUpload(file.size, {
        source,
        name: file.name,
        conversationId: conversation_id || undefined,
        onAbort: () => controller.abort(),
      });
      let file_path = '';
      try {
        file_path = await uploadFileViaHttp(file, conversation_id || '', tracker.onProgress, undefined, {
          signal: controller.signal,
        });
      } catch (error) {
        // Re-throw size errors so caller can show user-facing toast
        if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
          throw error;
        }
        if (error instanceof Error && error.message === UPLOAD_ABORTED_ERROR) {
          // User-initiated abort: drop this file silently (the UI already reflects it).
          continue;
        }
        console.error('Failed to upload file:', error);
        continue;
      } finally {
        tracker.finish();
      }

      processedFiles.push({
        name: file.name,
        path: file_path,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      });
    }

    return processedFiles;
  }
}

export const FileService = new FileServiceClass();
