"""PDF text extraction and OCR fallback to be implemented.

Suggested flow:
1. Try PyMuPDF text extraction for digital PDFs.
2. If text is absent/insufficient, render pages and run Tesseract OCR.
3. Return text with page numbers and extraction method.
4. Surface errors as processing failures, never as approvals.
"""
