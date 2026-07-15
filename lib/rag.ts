"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface DocumentChunk {
  id: string;
  fileId: string;
  fileName: string;
  text: string;
  embedding?: Float32Array;
  index: number;
}

export interface RAGDocument {
  id: string;
  fileName: string;
  fullText: string;
  chunks: DocumentChunk[];
  indexed: boolean;
  indexingProgress?: number;
  error?: string;
}

interface RAGState {
  documents: RAGDocument[];
  isIndexing: boolean;
  worker: Worker | null;
  workerReady: boolean;
}

export function useRAG() {
  const [state, setState] = useState<RAGState>({
    documents: [],
    isIndexing: false,
    worker: null,
    workerReady: false,
  });
  const pendingCallbacks = useRef<Map<string, unknown>>(new Map());
  const searchIdCounter = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const worker = new Worker("/embedding-worker.js", { type: "module" });
    
    worker.onmessage = (event) => {
      const { type, payload } = event.data;
      
      switch (type) {
        case "worker_ready":
        case "ready":
          setState((s) => ({ ...s, workerReady: true }));
          break;
          
        case "progress":
          setState((s) => ({
            ...s,
            documents: s.documents.map((d) =>
              d.indexingProgress !== undefined
                ? { ...d, indexingProgress: payload.progress * 100 }
                : d
            ),
          }));
          break;
          
        case "embedding_progress":
          setState((s) => ({
            ...s,
            documents: s.documents.map((d) =>
              !d.indexed && d.indexingProgress !== undefined
                ? {
                    ...d,
                    indexingProgress: Math.round(
                      (payload.current / payload.total) * 100
                    ),
                  }
                : d
            ),
          }));
          break;
          
        case "embed_result":
          const docId = pendingCallbacks.current.get("embed") as string | undefined;
          if (docId) {
            const embeddings = payload.embeddings;
            setState((s) => ({
              ...s,
              documents: s.documents.map((d) => {
                if (d.id === docId) {
                  const chunksWithEmbeddings = d.chunks.map((chunk, i) => ({
                    ...chunk,
                    embedding: embeddings[i],
                  }));
                  return { ...d, chunks: chunksWithEmbeddings, indexed: true, indexingProgress: 100 };
                }
                return d;
              }),
            }));
            pendingCallbacks.current.delete("embed");
          }
          break;
          
        case "search_result":
          const searchId = payload.searchId;
          const resolver = pendingCallbacks.current.get(searchId) as ((results: any[]) => void) | undefined;
          if (resolver) {
            resolver(payload.results);
            pendingCallbacks.current.delete(searchId);
          }
          break;
          
        case "error":
          setState((s) => ({
            ...s,
            documents: s.documents.map((d) =>
              !d.indexed ? { ...d, error: payload.message, indexingProgress: 0 } : d
            ),
            isIndexing: false,
          }));
          break;
      }
    };
    
    worker.onerror = (error) => {
      console.error("Worker error:", error);
      setState((s) => ({ ...s, isIndexing: false }));
    };
    
    setState((s) => ({ ...s, worker }));
    
    worker.postMessage({ type: "init" });
    
    return () => {
      worker.terminate();
    };
  }, []);

  const chunkText = useCallback((text: string, chunkSize = 500, overlap = 50): string[] => {
    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunk = "";
    
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(-Math.floor(overlap / 5));
        currentChunk = overlapWords.join(" ") + " " + sentence;
      } else {
        currentChunk += (currentChunk ? " " : "") + sentence;
      }
    }
    
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
  }, []);

  const addDocument = useCallback(
    async (fileId: string, fileName: string, fullText: string) => {
      const chunks = chunkText(fullText);
      const documentChunks: DocumentChunk[] = chunks.map((text, index) => ({
        id: `${fileId}-chunk-${index}`,
        fileId,
        fileName,
        text,
        index,
      }));

      const newDoc: RAGDocument = {
        id: fileId,
        fileName,
        fullText,
        chunks: documentChunks,
        indexed: false,
        indexingProgress: 0,
      };

      setState((s) => ({ ...s, documents: [...s.documents, newDoc] }));

      const worker = state.worker;
      if (!worker || !state.workerReady) return;

      setState((s) => ({ ...s, isIndexing: true }));

      pendingCallbacks.current.set("embed", fileId);
      
      worker.postMessage({
        type: "embed",
        payload: { texts: chunks },
      });
    },
    [chunkText, state.worker, state.workerReady]
  );

  const removeDocument = useCallback((fileId: string) => {
    setState((s) => ({
      ...s,
      documents: s.documents.filter((d) => d.id !== fileId),
    }));
  }, []);

  const search = useCallback(
    async (query: string, topK = 5): Promise<{ id: string; text: string; score: number; fileName: string }[]> => {
      const worker = state.worker;
      if (!worker || !state.workerReady) return [];

      const indexedDocs = state.documents.filter((d) => d.indexed);
      if (indexedDocs.length === 0) return [];

      const allChunks: { id: string; text: string; embedding: Float32Array; fileName: string }[] = [];
      for (const doc of indexedDocs) {
        for (const chunk of doc.chunks) {
          if (chunk.embedding) {
            allChunks.push({
              id: chunk.id,
              text: chunk.text,
              embedding: chunk.embedding,
              fileName: doc.fileName,
            });
          }
        }
      }

      if (allChunks.length === 0) return [];

      const searchId = `search-${++searchIdCounter.current}`;
      
      return new Promise((resolve) => {
        pendingCallbacks.current.set(searchId, (results: any[]) => {
          resolve(
            results.map((r: any) => ({
              id: r.id,
              text: r.text,
              score: r.score,
              fileName: allChunks.find((c) => c.id === r.id)?.fileName || "Unknown",
            }))
          );
        });
        
        worker.postMessage({
          type: "search",
          payload: { query, documents: allChunks, topK, searchId },
        });
      });
    },
    [state.worker, state.workerReady, state.documents]
  );

  const clearAll = useCallback(() => {
    setState((s) => ({ ...s, documents: [], isIndexing: false }));
  }, []);

  return {
    documents: state.documents,
    isIndexing: state.isIndexing,
    isReady: state.workerReady,
    addDocument,
    removeDocument,
    search,
    clearAll,
  };
}