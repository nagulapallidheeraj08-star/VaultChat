import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

let embedder: any = null;

async function initEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      quantized: true,
    });
  }
  return embedder;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "init": {
      try {
        await initEmbedder();
        self.postMessage({ type: "worker_ready" });
      } catch (error) {
        self.postMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Failed to init" } });
      }
      break;
    }

    case "embed": {
      try {
        const { texts } = payload;
        const embedder = await initEmbedder();
        
        const embeddings: Float32Array[] = [];
        for (let i = 0; i < texts.length; i++) {
          const output = await embedder(texts[i], { pooling: "mean", normalize: true });
          const embedding = output.data as Float32Array;
          embeddings.push(new Float32Array(embedding));
          
          self.postMessage({
            type: "embedding_progress",
            payload: { current: i + 1, total: texts.length },
          });
        }
        
        self.postMessage({
          type: "embed_result",
          payload: { embeddings },
        });
      } catch (error) {
        self.postMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Embedding failed" } });
      }
      break;
    }

    case "search": {
      try {
        const { query, documents, topK, searchId } = payload;
        const embedder = await initEmbedder();
        
        const queryOutput = await embedder(query, { pooling: "mean", normalize: true });
        const queryEmbedding = queryOutput.data as Float32Array;
        
        const scored = documents.map((doc: any) => ({
          id: doc.id,
          text: doc.text,
          score: cosineSimilarity(queryEmbedding, doc.embedding),
        }));
        
        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, topK);
        
        self.postMessage({
          type: "search_result",
          payload: { searchId, results },
        });
      } catch (error) {
        self.postMessage({ type: "error", payload: { message: error instanceof Error ? error.message : "Search failed" } });
      }
      break;
    }
  }
};