from fastapi import APIRouter

router = APIRouter()

@router.get("/health")
def health():
    return {"ok": True, "custom": True}

@router.get("/info")
def info():
    return {"name": "ce-0324-goodgood", "version": "0.1.0"}
