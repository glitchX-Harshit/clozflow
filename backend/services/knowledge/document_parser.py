import os
import io
import json
import csv
import unicodedata
import zipfile
from typing import Dict, Any, List, Optional

# Formats we can actually parse (legacy binary .doc/.xls are NOT parseable by
# python-docx/openpyxl and are rejected up front).
SUPPORTED_EXTENSIONS = {"pdf", "docx", "xlsx", "csv", "json", "txt", "md", "markdown", "html", "htm"}
LEGACY_EXTENSIONS = {"doc": "docx", "xls": "xlsx"}
TEXT_EXTENSIONS = {"csv", "json", "txt", "md", "markdown", "html", "htm"}

MAX_PDF_PAGES = 500
MAX_EXTRACTED_CHARS = 2_000_000
MAX_ZIP_ENTRIES = 5000
MAX_ZIP_UNCOMPRESSED_BYTES = 250 * 1024 * 1024  # zip-bomb guard for docx/xlsx

_BINARY_MAGIC = (
    b"%PDF-", b"PK\x03\x04", b"\xd0\xcf\x11\xe0", b"MZ", b"\x7fELF", b"\x89PNG", b"GIF8",
    b"\xff\xd8\xff", b"Rar!", b"7z\xbc\xaf", b"\x1f\x8b", b"BZh", b"\x00\x00\x01\x00",
)


def sanitize_upload_filename(raw: Optional[str], default: str = "document") -> str:
    """Basename only (no client directories / traversal), printable, bounded length."""
    name = (raw or "").replace("\\", "/").split("/")[-1]
    name = unicodedata.normalize("NFC", name)
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"|?*')
    name = name.strip().strip(".").strip()
    if not name:
        name = default
    if len(name) > 150:
        stem, ext = os.path.splitext(name)
        name = stem[: 150 - len(ext)] + ext
    return name


def file_extension(filename: str) -> str:
    return os.path.splitext(filename)[1].lower().lstrip(".")


def decode_text_bytes(file_bytes: bytes) -> str:
    """UTF-8 (with/without BOM) or BOM-marked UTF-16; invalid bytes replaced."""
    if file_bytes.startswith((b"\xff\xfe", b"\xfe\xff")):
        return file_bytes.decode("utf-16", errors="replace")
    return file_bytes.decode("utf-8-sig", errors="replace")


def sniff_document_problem(file_bytes: bytes, ext: str) -> Optional[str]:
    """Content check matching the extension. Returns a reason when the bytes do
    not look like a valid file of that type, else None."""
    head = file_bytes[:8192]
    if ext == "pdf":
        return None if b"%PDF-" in file_bytes[:1024] else "does not look like a valid PDF file"
    if ext in ("docx", "xlsx"):
        if not file_bytes.startswith(b"PK\x03\x04"):
            return f"does not look like a valid .{ext} file"
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                infos = zf.infolist()
                if len(infos) > MAX_ZIP_ENTRIES or sum(i.file_size for i in infos) > MAX_ZIP_UNCOMPRESSED_BYTES:
                    return "is too large once decompressed"
                names = {i.filename for i in infos}
        except (zipfile.BadZipFile, ValueError, OSError):
            return f"does not look like a valid .{ext} file"
        required = "word/document.xml" if ext == "docx" else "xl/workbook.xml"
        return None if required in names else f"does not look like a valid .{ext} file"
    if ext in TEXT_EXTENSIONS:
        if head.startswith((b"\xff\xfe", b"\xfe\xff")):
            return None  # UTF-16 text with BOM
        if head.startswith(_BINARY_MAGIC) or b"\x00" in head:
            return "looks like a binary file, not text"
        if ext == "json":
            try:
                json.loads(decode_text_bytes(file_bytes))
            except ValueError:
                return "is not valid JSON"
        return None
    return "has an unsupported type"


def parse_uploaded_file(file_bytes: bytes, filename: str) -> Dict[str, Any]:
    """
    Parses an uploaded document into structured text and metadata.
    Supports PDF, DOCX, XLSX, CSV, JSON, TXT, MD, HTML.
    """
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    text = ""
    sections: List[Dict[str, str]] = []

    try:
        if ext in LEGACY_EXTENSIONS:
            raise ValueError(f"Legacy .{ext} files are not supported; save it as .{LEGACY_EXTENSIONS[ext]} and upload again.")

        if ext == "pdf":
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            pages_text = []
            for idx, page in enumerate(reader.pages):
                if idx >= MAX_PDF_PAGES:
                    break
                p_text = page.extract_text() or ""
                if p_text.strip():
                    pages_text.append(f"--- Page {idx + 1} ---\n{p_text.strip()}")
                    sections.append({"title": f"Page {idx + 1}", "content": p_text.strip()})
            text = "\n\n".join(pages_text)

        elif ext == "docx":
            import docx
            doc = docx.Document(io.BytesIO(file_bytes))
            paras = []
            for p in doc.paragraphs:
                p_str = p.text.strip()
                if p_str:
                    paras.append(p_str)
            for table in doc.tables:
                for row in table.rows:
                    row_data = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if row_data:
                        paras.append(" | ".join(row_data))
            text = "\n\n".join(paras)
            sections.append({"title": filename, "content": text})

        elif ext == "xlsx":
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
            sheet_texts = []
            for sheetname in wb.sheetnames:
                sheet = wb[sheetname]
                rows_text = []
                for row in sheet.iter_rows(values_only=True):
                    row_vals = [str(val).strip() for val in row if val is not None and str(val).strip()]
                    if row_vals:
                        rows_text.append(" | ".join(row_vals))
                if rows_text:
                    s_block = f"### Sheet: {sheetname}\n" + "\n".join(rows_text)
                    sheet_texts.append(s_block)
                    sections.append({"title": sheetname, "content": "\n".join(rows_text)})
            text = "\n\n".join(sheet_texts)

        elif ext == "csv":
            content_str = decode_text_bytes(file_bytes)
            reader = csv.reader(io.StringIO(content_str))
            rows = []
            for r in reader:
                clean_r = [val.strip() for val in r if val.strip()]
                if clean_r:
                    rows.append(" | ".join(clean_r))
            text = "\n".join(rows)
            sections.append({"title": filename, "content": text})

        elif ext == "json":
            content_str = decode_text_bytes(file_bytes)
            parsed_json = json.loads(content_str)
            text = json.dumps(parsed_json, indent=2)
            sections.append({"title": filename, "content": text})

        elif ext in ("html", "htm"):
            from bs4 import BeautifulSoup
            content_str = decode_text_bytes(file_bytes)
            soup = BeautifulSoup(content_str, "html.parser")
            for s in soup(["script", "style", "nav", "footer"]):
                s.decompose()
            text = soup.get_text(separator="\n", strip=True)
            sections.append({"title": filename, "content": text})

        elif ext in ("txt", "md", "markdown"):
            text = decode_text_bytes(file_bytes)
            sections.append({"title": filename, "content": text})

        else:
            raise ValueError(f"Unsupported file format: .{ext}. Supported formats: PDF, DOCX, XLSX, CSV, JSON, TXT, MD, HTML.")

    except Exception as e:
        raise ValueError(f"Failed to parse {filename}: {str(e)}")

    if not text.strip():
        raise ValueError(f"File {filename} contains no extractable text.")

    return {
        "filename": filename,
        "extension": ext,
        "size_bytes": len(file_bytes),
        "clean_text": text.strip()[:MAX_EXTRACTED_CHARS],
        "sections": sections
    }
