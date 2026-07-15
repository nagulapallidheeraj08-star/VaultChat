"use client";

import { RAGProvider } from "@/lib/rag-context";
import { FileUploadZone } from "@/components/file-upload-zone";
import { ChatInterface } from "@/components/chat-interface";
import { LayoutDashboard, FileText, Database } from "lucide-react";
import { useState } from "react";

function AppContent() {
  const [showUpload, setShowUpload] = useState(true);

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className={`${showUpload ? "w-80" : "w-16"} flex-shrink-0 border-r bg-background/50 transition-all duration-300 overflow-y-auto`}>
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Documents</h2>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="p-1 rounded hover:bg-muted transition-colors"
              aria-label={showUpload ? "Collapse sidebar" : "Expand sidebar"}
            >
              {showUpload ? <LayoutDashboard className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4 rotate-180" />}
            </button>
          </div>
        </div>
        <div className={showUpload ? "p-4" : "p-2"}>
          <FileUploadZone
            onFilesChange={() => {}}
            maxFiles={20}
            maxSizeMB={100}
          />
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <ChatInterface />
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <RAGProvider>
      <main className="flex min-h-screen flex-col">
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
          <div className="container mx-auto flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <Database className="w-6 h-6 text-primary" />
              <h1 className="text-xl font-bold">VaultChat</h1>
            </div>
            <span className="text-sm text-muted-foreground">100% Local AI & Private RAG</span>
          </div>
        </header>
        <AppContent />
      </main>
    </RAGProvider>
  );
}