import fitz  # PyMuPDF
import chromadb
import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
from pydantic import BaseModel

app = FastAPI(title="Cipher Vault AI Microservice")

# Allow the React frontend to communicate with this local service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

chroma_client = chromadb.Client()
collection = chroma_client.get_or_create_collection(name="secure_documents")
embedder = SentenceTransformer('all-MiniLM-L6-v2')

class ChatRequest(BaseModel):
    question: str

@app.post("/api/index")
async def index_document(file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        
        chunks = []
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            text = page.get_text("text").strip()
            if text:
                chunks.append({
                    "id": f"page_{page_num}",
                    "text": text,
                    "metadata": {"page": page_num}
                })
        
        if not chunks:
            raise HTTPException(status_code=400, detail="No readable text found. If this is a scanned image, OCR is required.")

        texts = [c["text"] for c in chunks]
        ids = [c["id"] for c in chunks]
        metadatas = [c["metadata"] for c in chunks]
        embeddings = embedder.encode(texts).tolist()
        
        if collection.count() > 0:
            existing_ids = collection.get()["ids"]
            collection.delete(ids=existing_ids)
            
        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas
        )

        print(f"✅ Indexed {len(chunks)} pages into ChromaDB.")
        return {"status": "success", "chunks_indexed": len(chunks)}
    except Exception as e:
        print(f"❌ Indexing Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_document(request: ChatRequest):
    try:
        doc_count = collection.count()
        if doc_count == 0:
            raise HTTPException(status_code=400, detail="No document is currently indexed.")

        question = request.question.lower()
        context_texts = []

        # 1. Handle Summarization Intents (Bypass vector search)
        if "summarize" in question or "summary" in question:
            print("📝 Summarization requested. Fetching full document context...")
            all_docs = collection.get()
            context_texts = all_docs['documents'][:4] # Limit to first 4 pages to avoid Llama token limits
        
        # 2. Handle Specific Questions (Vector Search)
        else:
            print(f"🔍 Vector search for: {request.question}")
            question_embedding = embedder.encode([request.question]).tolist()
            
            # Prevent ChromaDB from crashing if we ask for 4 results but only have 1 page
            n_res = min(4, doc_count) 

            results = collection.query(
                query_embeddings=question_embedding,
                n_results=n_res
            )
            if results['documents'] and results['documents'][0]:
                context_texts = results['documents'][0]

        if not context_texts:
            return {"answer": "I could not extract any relevant text from the document to answer this."}

        context_block = "\n\n".join(context_texts)
        print(f"📄 Injected Context Length: {len(context_block)} characters")
        
        prompt = f"""You are a highly capable AI analyzing a secure document. 
Use ONLY the provided context to answer the question. Do not use outside knowledge. If the answer is not in the context, say "I cannot answer this based on the provided document."

Context:
{context_block}

Question: {request.question}
"""
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": "llama3",
                    "prompt": prompt,
                    "stream": False
                }
            )
            response.raise_for_status()
            llm_result = response.json()
            
        return {"answer": llm_result.get("response", "Error generating response.")}
    except Exception as e:
        print(f"❌ Chat Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
