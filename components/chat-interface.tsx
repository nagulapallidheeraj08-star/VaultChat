"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Loader2, WifiOff, Wifi, MessageSquare, Database, Brain, Sparkles } from "lucide-react";
import { useRAGContext } from "@/lib/rag-context";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: { id: string; text: string; score: number; fileName: string }[];
}

export function ChatInterface() {
  const { search, documents, isReady: ragReady, isIndexing } = useRAGContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [isSearching, setIsSearching] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  useEffect(() => {
    const checkOllama = async () => {
      try {
        const response = await fetch("http://127.0.0.1:11434/api/tags", {
          method: "GET",
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          setOllamaStatus("connected");
        } else {
          setOllamaStatus("disconnected");
        }
      } catch {
        setOllamaStatus("disconnected");
      }
    };

    checkOllama();
    const interval = setInterval(checkOllama, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setIsSearching(true);

    abortControllerRef.current = new AbortController();

    let context = "";
    let sources: Message["sources"] = [];

    // Search for relevant document chunks
    if (ragReady && documents.some((d) => d.indexed)) {
      try {
        const results = await search(input.trim(), 3);
        if (results.length > 0) {
          context = results.map((r) => `[Source: ${r.fileName}]\n${r.text}`).join("\n\n---\n\n");
          sources = results;
        }
      } catch (error) {
        console.error("RAG search failed:", error);
      }
    }

    setIsSearching(false);

    try {
      const systemPrompt = context
        ? `You are a helpful AI assistant. Use the following context from the user's documents to answer their question. If the context doesn't contain relevant information, say so and answer from your general knowledge.\n\nContext from your documents:\n${context}\n\nUser question: ${input.trim()}\n\nAnswer:`
        : input.trim();

      const messagesForOllama = [
        ...messages,
        userMessage,
      ].map((m) => ({
        role: m.role,
        content: m.role === "user" && m === userMessage ? systemPrompt : m.content,
      }));

      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2:1b",
          messages: messagesForOllama,
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "", sources }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              assistantContent += data.message.content;
              setMessages((prev) => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                  ...newMessages[newMessages.length - 1],
                  content: assistantContent,
                };
                return newMessages;
              });
            }
            if (data.done) {
              setIsStreaming(false);
              break;
            }
          } catch {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: `Error: ${error.message}` },
        ]);
      }
      setIsStreaming(false);
      setIsSearching(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setIsSearching(false);
  };

  const indexedCount = documents.filter((d) => d.indexed).length;
  const totalChunks = documents.reduce((sum, d) => sum + d.chunks.length, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-3xl mx-auto p-4 gap-4">
      <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
        <h2 className="text-lg font-semibold">VaultChat</h2>
        <div className="flex items-center gap-3">
          {/* RAG Status */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted text-xs">
            {ragReady ? (
              <>
                <Brain className="w-3 h-3 text-green-500" />
                <span className="text-green-600 dark:text-green-400">RAG Ready</span>
                {indexedCount > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span>{indexedCount} doc{indexedCount !== 1 ? "s" : ""}</span>
                    <span className="text-muted-foreground">•</span>
                    <span>{totalChunks} chunks</span>
                  </>
                )}
              </>
            ) : (
              <>
                <Loader2 className="w-3 h-3 text-primary animate-spin" />
                <span className="text-primary">Loading model...</span>
              </>
            )}
          </div>
          {/* Indexing Status */}
          {isIndexing && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Indexing...</span>
            </div>
          )}
          {/* Ollama Status */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {ollamaStatus === "checking" && "Checking..."}
              {ollamaStatus === "connected" && "Ollama Connected"}
              {ollamaStatus === "disconnected" && "Ollama Offline"}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                ollamaStatus === "connected"
                  ? "bg-green-500"
                  : ollamaStatus === "disconnected"
                  ? "bg-red-500"
                  : "bg-yellow-500 animate-pulse"
              }`}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4" role="log" aria-live="polite">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-2xl ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-none"
                  : "bg-muted rounded-bl-none"
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.sources && message.sources.length > 0 && (
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Sources ({message.sources.length})
                  </summary>
                  <div className="mt-1 space-y-1 pl-4 border-l border-muted-foreground/20">
                    {message.sources.map((source, i) => (
                      <div key={i} className="text-xs">
                        <span className="font-medium">{source.fileName}</span>{" "}
                        <span className="text-muted-foreground">(score: {source.score.toFixed(3)})</span>
                        <p className="truncate max-w-xs mt-0.5">{source.text.slice(0, 150)}...</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
        {(isStreaming || isSearching) && (
          <div className="flex justify-start">
            <div className="bg-muted p-3 rounded-2xl rounded-bl-none max-w-[80%]">
              <div className="flex gap-1">
                {isSearching && (
                  <>
                    <Sparkles className="w-4 h-4 text-primary animate-pulse" style={{ animationDelay: "0ms" }} />
                    <span className="text-sm text-muted-foreground self-center">Searching documents...</span>
                  </>
                )}
                {isStreaming && !isSearching && (
                  <>
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ollamaStatus === "disconnected" ? "Ollama not reachable" : "Ask about your documents..."}
          disabled={isStreaming || ollamaStatus === "disconnected"}
          className="flex-1 px-4 py-2 border border-input bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          aria-label="Chat input"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={handleStop}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity"
            aria-label="Stop generating"
          >
            <Loader2 className="w-5 h-5 animate-spin" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() || ollamaStatus === "disconnected"}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </form>
    </div>
  );
}