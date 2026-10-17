"""
Clozflow Canonical Lead Ingestion Service
──────────────────────────────────────────
Provides a single shared ingestion pipeline for:
  - Clozflow Lead Finder discovery results
  - CSV / Excel (.xlsx) file uploads
  - Manual single-lead direct entry

Features:
  - Robust phone normalization (E.164 with Indian +91 support)
  - Column auto-mapping for flexible CSV/Excel structures
  - Excel (.xlsx) parsing using standard library zipfile + XML (zero-dependency, failsafe)
  - Strict deduplication within batch and against existing DB records
  - Comprehensive validation reporting (valid, invalid, duplicate, errors)
"""

import io
import re
import csv
import zipfile
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Tuple, Optional, Set

try:
    import phonenumbers
    HAS_PHONENUMBERS = True
except ImportError:
    HAS_PHONENUMBERS = False

from utils.telephony import normalize_indian_phone_number, is_valid_e164


def validate_and_normalize_phone(raw_phone: str) -> Tuple[bool, str, Optional[str]]:
    """
    Validates and normalizes phone number to E.164.
    Attempts Indian normalization first, then international parsing via phonenumbers.
    Returns: (is_valid, normalized_number, error_message)
    """
    if not raw_phone:
        return False, "", "Phone number is missing or empty"

    cleaned = re.sub(r'[\s\-\(\)\.]', '', str(raw_phone).strip())
    if not cleaned:
        return False, "", "Phone number contains no digits"

    # Attempt standard Indian normalization
    try:
        indian_norm = normalize_indian_phone_number(cleaned)
        return True, indian_norm, None
    except ValueError:
        pass

    # Attempt international E.164 validation via phonenumbers if available
    if HAS_PHONENUMBERS:
        try:
            # If not starting with +, test with default 'IN' or parse as is
            parsed = phonenumbers.parse(cleaned if cleaned.startswith('+') else f"+{cleaned}", None)
            if phonenumbers.is_valid_number(parsed):
                e164 = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
                return True, e164, None
        except Exception:
            pass

    # Direct E.164 regex check
    if is_valid_e164(cleaned):
        return True, cleaned, None

    return False, cleaned, "Invalid phone number format (expected E.164 or 10-digit Indian mobile)"


def parse_xlsx_sheets(file_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Parses .xlsx workbook using pure Python zipfile + XML parser.
    Works anywhere without requiring openpyxl or heavy binaries.
    """
    rows_data: List[List[str]] = []
    
    with zipfile.ZipFile(io.BytesIO(file_bytes), 'r') as z:
        # 1. Read shared strings if present
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_xml = z.read('xl/sharedStrings.xml')
            tree = ET.fromstring(ss_xml)
            # Namespace handling
            ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in tree.findall('.//ns:si', ns):
                text_elems = si.findall('.//ns:t', ns)
                shared_strings.append("".join(t.text or "" for t in text_elems))
        
        # 2. Read first worksheet
        sheet_path = 'xl/worksheets/sheet1.xml'
        if sheet_path not in z.namelist():
            for name in z.namelist():
                if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                    sheet_path = name
                    break
        
        if sheet_path in z.namelist():
            sheet_xml = z.read(sheet_path)
            tree = ET.fromstring(sheet_xml)
            ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            
            for row_elem in tree.findall('.//ns:row', ns):
                row_vals = []
                for cell in row_elem.findall('ns:c', ns):
                    cell_type = cell.attrib.get('t')
                    val_elem = cell.find('ns:v', ns)
                    val = val_elem.text if val_elem is not None else ""
                    
                    if cell_type == 's' and val.isdigit() and int(val) < len(shared_strings):
                        row_vals.append(shared_strings[int(val)].strip())
                    elif cell_type == 'inlineStr':
                        is_elem = cell.find('.//ns:t', ns)
                        row_vals.append((is_elem.text if is_elem is not None else "").strip())
                    else:
                        row_vals.append(val.strip())
                if any(row_vals):
                    rows_data.append(row_vals)

    if not rows_data:
        return []

    headers = [str(h).strip().lower() for h in rows_data[0]]
    result = []
    for row in rows_data[1:]:
        row_dict = {}
        for idx, h in enumerate(headers):
            row_dict[h] = row[idx] if idx < len(row) else ""
        if any(row_dict.values()):
            result.append(row_dict)
            
    return result


def parse_csv_file(file_content: str) -> List[Dict[str, Any]]:
    """
    Parses CSV text handling multiple dialects and encodings.
    """
    lines = [line for line in file_content.splitlines() if line.strip()]
    if not lines:
        return []

    # Detect delimiter
    first_line = lines[0]
    delimiter = ','
    if '\t' in first_line:
        delimiter = '\t'
    elif ';' in first_line and first_line.count(';') > first_line.count(','):
        delimiter = ';'

    reader = csv.DictReader(lines, delimiter=delimiter)
    result = []
    for row in reader:
        # Clean keys
        clean_row = {str(k).strip().lower(): str(v).strip() for k, v in row.items() if k is not None}
        if any(clean_row.values()):
            result.append(clean_row)
    return result


# ── Canonical Field Matching ──────────────────────────────────────────────────

_NAME_ALIASES = ["name", "contact_name", "full_name", "first_name", "prospect", "person", "lead_name"]
_BUSINESS_ALIASES = ["business_name", "company", "business", "company_name", "organization", "account", "store", "shop"]
_PHONE_ALIASES = ["phone", "phone_number", "mobile", "contact_number", "cell", "telephone", "phone_no", "ph_no", "tel"]
_EMAIL_ALIASES = ["email", "email_address", "mail", "contact_email"]
_WEBSITE_ALIASES = ["website", "site", "web", "url", "domain"]
_CITY_ALIASES = ["city", "location", "address", "state", "region"]


def extract_field(row: Dict[str, Any], aliases: List[str]) -> str:
    """Finds first matching alias in row keys."""
    for alias in aliases:
        if alias in row and row[alias]:
            return str(row[alias]).strip()
    # Partial matching
    for k, v in row.items():
        k_lower = str(k).lower()
        if any(alias in k_lower for alias in aliases) and v:
            return str(v).strip()
    return ""


def canonicalize_lead_row(raw_row: Dict[str, Any], source: str = "csv_upload") -> Dict[str, Any]:
    """
    Normalizes a raw dictionary row into canonical Lead record schema.
    """
    name = extract_field(raw_row, _NAME_ALIASES)
    business = extract_field(raw_row, _BUSINESS_ALIASES)
    phone_raw = extract_field(raw_row, _PHONE_ALIASES)
    email = extract_field(raw_row, _EMAIL_ALIASES)
    website = extract_field(raw_row, _WEBSITE_ALIASES)
    city = extract_field(raw_row, _CITY_ALIASES)

    # If only business is present, use for name or vice versa
    display_name = name or business or "Prospect"
    display_business = business or name or "Prospect Business"

    is_valid, normalized_phone, error_msg = validate_and_normalize_phone(phone_raw)

    return {
        "name": display_name,
        "business_name": display_business,
        "company": display_business,
        "phone_number": phone_raw,
        "normalized_phone": normalized_phone if is_valid else "",
        "email": email,
        "website": website,
        "city": city,
        "source": source,
        "status": "valid" if is_valid else "invalid",
        "validation_error": error_msg,
        "raw_data": raw_row
    }


def process_lead_batch(
    raw_rows: List[Dict[str, Any]], 
    source: str = "csv_upload",
    existing_phone_set: Optional[Set[str]] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Processes a list of raw rows, normalizes each, performs deduplication,
    and returns canonical records with full validation metrics.
    """
    if existing_phone_set is None:
        existing_phone_set = set()

    seen_in_batch: Set[str] = set()
    processed_records: List[Dict[str, Any]] = []

    valid_count = 0
    invalid_count = 0
    duplicate_count = 0

    for row in raw_rows:
        lead = canonicalize_lead_row(row, source=source)
        norm_phone = lead.get("normalized_phone")

        if lead["status"] == "invalid":
            invalid_count += 1
            processed_records.append(lead)
            continue

        # Check duplicate against this batch or existing DB records
        if norm_phone in seen_in_batch or norm_phone in existing_phone_set:
            lead["status"] = "excluded"
            lead["validation_error"] = f"Duplicate phone number detected ({norm_phone})"
            duplicate_count += 1
        else:
            seen_in_batch.add(norm_phone)
            valid_count += 1

        processed_records.append(lead)

    stats = {
        "total_rows": len(raw_rows),
        "valid_count": valid_count,
        "invalid_count": invalid_count,
        "duplicate_count": duplicate_count,
        "eligible_count": valid_count
    }

    return processed_records, stats
