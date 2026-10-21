from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from . import models
from .routers.requests import router as requests_router
from .routers.documents import router as documents_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    yield
    engine.dispose()


app = FastAPI(
    title=settings.app_name,
    description=(
        "Evidence-first document verification and approval system. "
        "Human decisions remain mandatory."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(requests_router)
app.include_router(documents_router)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": settings.app_name}
