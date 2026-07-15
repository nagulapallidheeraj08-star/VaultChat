"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRAG, RAGDocument } from "./rag";

interface RAGContextType {
  documents: RAGDocument[];
  isIndexing: boolean;
  isReady: boolean;
  addDocument: (fileId: string, fileName: string, fullText: string) => Promise<void>;
  removeDocument: (fileId: string) => void;
  search: (query: string, topK?: number) => Promise<{ id: string; text: string; score: number; fileName: string }[]>;
  clearAll: () => void;
}

const RAGContext = createContext<RAGContextType | null>(null);

export function RAGProvider({ children }: { children: ReactNode }) {
  const rag = useRAG();
  const [documents, setDocuments] = useState<RAGDocument[]>(rag.documents);
  const [isIndexing, setIsIndexing] = useState(rag.isIndexing);
  const [isReady, setIsReady] = useState(rag.isReady);

  const addDocument = async (fileId: string, fileName: string, fullText: string) => {
    setIsIndexing(true);
    await rag.addDocument(fileId, fileName, fullText);
    setDocuments(rag.documents);
    setIsIndexing(false);
  };

  const removeDocument = (fileId: string) => {
    rag.removeDocument(fileId);
    setDocuments(rag.documents);
  };

  const search = async (query: string, topK = 5) => {
    return rag.search(query, topK);
  };

  const clearAll = () => {
    rag.clearAll();
    setDocuments([]);
  };

  // Sync documents from rag hook
  useEffect(() => {
    setDocuments(rag.documents);
    setIsReady(rag.isReady);
    setIsIndexing(rag.isIndexing);
  }, [rag.documents, rag.isReady, rag.isIndexing]);

  return (
    <RAGContext.Provider
      value={{
        documents,
        isIndexing,
        isReady,
        addDocument,
        removeDocument,
        search,
        clearAll,
      }}
    >
      {children}
    </RAGContext.Provider>
  );
}

export function useRAGContext() {
  const context = useContext(RAGContext);
  if (!context) {
    throw new Error("useRAGContext must be used within RAGProvider");
  }
  return context;
}