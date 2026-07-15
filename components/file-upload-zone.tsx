"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, FileText, AlertCircle, CheckCircle, Loader2, X, FileQuestion, Database } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { cn } from "@/lib/utils";
import { useRAGContext } from "@/lib/rag-context";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export interface ExtractedFile {
  id: string;
  file: File;
  text: string;
  pageCount: number;
  currentPage: number;
  error?: string;
  status: "pending" | "extracting" | "indexing" | "complete" | "error";
  indexed?: boolean;
  indexingProgress?: number;
}

interface FileUploadZoneProps {
  onFilesChange: (files: ExtractedFile[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
}

export function FileUploadZone({ onFilesChange, maxFiles = 10, maxSizeMB = 50 }: FileUploadZoneProps) {
  const { addDocument, isReady: ragReady } = useRAGContext();
  const [files, setFiles] = useState<ExtractedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const updateFile = useCallback((id: string, updates: Partial<ExtractedFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  }, []);

  const notifyParent = useCallback((updatedFiles: ExtractedFile[]) => {
    onFilesChange(updatedFiles);
  }, [onFilesChange]);

  const extractTextFromPDF = async (file: File, id: string) => {
    const abortController = new AbortController();
    abortControllersRef.current.set(id, abortController);

    updateFile(id, { status: "extracting", text: "", pageCount: 0, currentPage: 0 });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const totalPages = pdf.numPages;
      updateFile(id, { pageCount: totalPages });

      let fullText = "";

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (abortController.signal.aborted) {
          throw new Error("Extraction cancelled");
        }

        updateFile(id, { text: `Extracting page ${pageNum} of ${totalPages}...`, currentPage: pageNum });

        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item): item is TextItem => "str" in item)
          .map((item) => item.str)
          .join(" ");

        fullText += pageText + "\n\n";
      }

      if (abortController.signal.aborted) {
        throw new Error("Extraction cancelled");
      }

      updateFile(id, { status: "complete", text: fullText.trim(), currentPage: totalPages });
      setFiles((prev: ExtractedFile[]) => {
        const next: ExtractedFile[] = prev.map((f) =>
          f.id === id ? { ...f, status: "complete", text: fullText.trim(), currentPage: totalPages } : f
        );
        notifyParent(next);
        return next;
      });

      // Index in RAG after extraction
      if (ragReady && fullText.trim().length > 0) {
        updateFile(id, { status: "indexing", indexingProgress: 0, indexed: false });
        try {
          await addDocument(id, file.name, fullText.trim());
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id ? { ...f, indexed: true, indexingProgress: 100, status: "complete" } : f
            )
          );
        } catch (error) {
          console.error("RAG indexing failed:", error);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id ? { ...f, error: "Indexing failed", indexingProgress: 0, status: "error" } : f
            )
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError" && error.message !== "Extraction cancelled") {
        let errorMessage = "Failed to extract text";
        if (error instanceof Error) {
          if (error.message.includes("Password")) {
            errorMessage = "Password-protected PDFs are not supported";
          } else if (error.message.includes("Invalid PDF") || error.message.includes("corrupt")) {
            errorMessage = "Corrupted or invalid PDF file";
          } else {
            errorMessage = error.message;
          }
        }
        updateFile(id, { status: "error", error: errorMessage });
        setFiles((prev: ExtractedFile[]) => {
          const next: ExtractedFile[] = prev.map((f) =>
            f.id === id ? { ...f, status: "error", error: errorMessage } : f
          );
          notifyParent(next);
          return next;
        });
      }
    } finally {
      abortControllersRef.current.delete(id);
    }
  };

  const handleFiles = useCallback(
    async (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles);
      const validFiles = fileArray.filter((file) => {
        if (file.type !== "application/pdf") {
          return false;
        }
        if (file.size > maxSizeMB * 1024 * 1024) {
          return false;
        }
        return true;
      });

      if (files.length + validFiles.length > maxFiles) {
        return;
      }

      const newExtractedFiles: ExtractedFile[] = validFiles.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        text: "",
        pageCount: 0,
        currentPage: 0,
        status: "pending" as const,
      }));

      setFiles((prev) => {
        const combined = [...prev, ...newExtractedFiles];
        notifyParent(combined);
        return combined;
      });

      for (const extractedFile of newExtractedFiles) {
        await extractTextFromPDF(extractedFile.file, extractedFile.id);
      }
    },
    [files, maxFiles, maxSizeMB, notifyParent]
  );

  const removeFile = useCallback(
    (id: string) => {
      abortControllersRef.current.get(id)?.abort();
      setFiles((prev) => {
        const next = prev.filter((f) => f.id !== id);
        notifyParent(next);
        return next;
      });
    },
    [notifyParent]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        handleFiles(e.target.files);
      }
      e.target.value = "";
    },
    [handleFiles]
  );

  const getStatusIcon = (status: ExtractedFile["status"]) => {
    switch (status) {
      case "pending":
        return <FileText className="w-5 h-5 text-muted-foreground" />;
      case "extracting":
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
      case "indexing":
        return <Database className="w-5 h-5 text-primary animate-spin" />;
      case "complete":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center transition-colors",
          dragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={openFilePicker}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Upload PDF files"
        />
        <Upload className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-lg font-medium">Drop PDF files here or click to browse</p>
        <p className="text-sm text-muted-foreground mt-1">
          Max {maxFiles} files, {maxSizeMB}MB each
        </p>
      </div>

      {files.length > 0 && (
        <div className="space-y-3" role="list" aria-label="Uploaded files">
          {files.map((file) => (
            <div
              key={file.id}
              className={cn(
                "flex items-center gap-4 p-4 rounded-lg border",
                file.status === "error" && "border-red-500/50 bg-red-500/5",
                file.status === "complete" && "border-green-500/50 bg-green-500/5",
                file.status === "extracting" && "border-primary/50 bg-primary/5"
              )}
              role="listitem"
            >
              <div className="flex-shrink-0">{getStatusIcon(file.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{file.file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {file.status === "pending"
                    ? "Waiting..."
                    : file.status === "extracting"
                    ? file.text
                    : file.status === "indexing"
                    ? `Indexing... ${file.indexingProgress ?? 0}%`
                    : file.status === "complete"
                    ? `${file.pageCount} page${file.pageCount !== 1 ? "s" : ""} • ${file.text.length} chars${file.indexed ? " • Indexed" : ""}`
                    : file.error}
                </p>
                {file.status === "extracting" && file.pageCount > 0 && (
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${(file.currentPage / file.pageCount) * 100}%`,
                      }}
                    />
                  </div>
                )}
                {file.status === "indexing" && (file.indexingProgress ?? 0) > 0 && (
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${file.indexingProgress}%` }}
                    />
                  </div>
                )}
              </div>
              <button
                onClick={() => removeFile(file.id)}
                className="flex-shrink-0 p-2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`Remove ${file.file.name}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {files.some((f) => f.status === "error") && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 inline-block mr-1" /> Some PDFs could not be processed. Password-protected or corrupted files are not supported.
        </div>
      )}
    </div>
  );
}