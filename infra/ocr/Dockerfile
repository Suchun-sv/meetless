# Server-side OCR for the 「需求」 inbox (apps/server/src/inbox/ocr.ts): PaddleOCR's Chinese and English
# models through RapidOCR (ONNX Runtime; the models ship in the wheel), plus poppler to render scanned
# PDF pages. Chosen over tesseract chi_sim+eng, which misread Chinese screenshots. Runs with no network.
#   docker build -t meetless-ocr infra/ocr     (then MEETLESS_OCR_IMAGE=meetless-ocr)
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 poppler-utils && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir rapidocr-onnxruntime==1.3.24
COPY ocr.py /app/ocr.py
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"
ENTRYPOINT ["python", "/app/ocr.py"]
