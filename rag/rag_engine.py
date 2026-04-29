import os
import json
import faiss
import numpy as np
import pickle
from sentence_transformers import SentenceTransformer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class RAGEngine:
    def __init__(self):
        self.model = SentenceTransformer("all-MiniLM-L6-v2")
        self.index = None
        self.data = None

    def build_index(self, data_path=None):
        if data_path is None:
            data_path = os.path.join(BASE_DIR, "rag_data.json")
        with open(data_path, "r") as f:
            self.data = json.load(f)

        texts = [item["text"] for item in self.data]
        embeddings = self.model.encode(texts)

        dim = embeddings.shape[1]
        self.index = faiss.IndexFlatL2(dim)
        self.index.add(np.array(embeddings))

        faiss.write_index(self.index, os.path.join(BASE_DIR, "faiss_index.bin"))

        with open(os.path.join(BASE_DIR, "metadata.pkl"), "wb") as f:
            pickle.dump(self.data, f)

    def load_index(self):
        self.index = faiss.read_index(os.path.join(BASE_DIR, "faiss_index.bin"))

        with open(os.path.join(BASE_DIR, "metadata.pkl"), "rb") as f:
            self.data = pickle.load(f)

    def retrieve(self, query, k=2):
        query_vec = self.model.encode([query])
        D, I = self.index.search(np.array(query_vec), k)

        results = []
        for idx in I[0]:
            if idx < len(self.data):
                results.append(self.data[idx])

        return results

if __name__ == "__main__":
    print("Building RAG Index...")
    engine = RAGEngine()
    engine.build_index()
    print("RAG Index built successfully.")
