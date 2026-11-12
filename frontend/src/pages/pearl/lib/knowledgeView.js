/**
 * Display and validation helpers for the Pearl Knowledge base view.
 * Everything is derived from `GET /api/knowledge/overview` and the job events —
 * nothing here invents content.
 */

// ── Upload limits (mirror routers/knowledge.py + services/knowledge/document_parser.py) ──
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
export const KNOWLEDGE_UPLOAD_EXTENSIONS = Object.freeze(['pdf', 'docx', 'xlsx', 'csv', 'json', 'txt', 'md', 'markdown', 'html', 'htm']);
export const KNOWLEDGE_UPLOAD_ACCEPT = KNOWLEDGE_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(',');
export const KNOWLEDGE_UPLOAD_LABEL = 'PDF, DOCX, XLSX, CSV, JSON, TXT, MD, HTML';
const LEGACY_EXTENSIONS = { doc: 'docx', xls: 'xlsx' };

export function fileExtension(name) {
    const text = String(name || '');
    const dot = text.lastIndexOf('.');
    return dot > 0 ? text.slice(dot + 1).toLowerCase() : '';
}

export function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Client-side check before `POST /api/knowledge/upload` (the server stays the
 * source of truth and also checks file contents).
 * @param {Array<{name: string, size: number}>} files
 * @returns {{ ok: boolean, error: string|null }}
 */
export function validateKnowledgeFiles(files) {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) return { ok: false, error: 'Choose at least one document to upload.' };
    if (list.length > MAX_UPLOAD_FILES) {
        return { ok: false, error: `Too many files: upload at most ${MAX_UPLOAD_FILES} documents at a time.` };
    }
    let total = 0;
    for (const file of list) {
        const name = String(file?.name || 'file');
        const ext = fileExtension(name);
        if (LEGACY_EXTENSIONS[ext]) {
            return { ok: false, error: `Legacy .${ext} files are not supported (${name}). Save it as .${LEGACY_EXTENSIONS[ext]} and upload it again.` };
        }
        if (!KNOWLEDGE_UPLOAD_EXTENSIONS.includes(ext)) {
            return { ok: false, error: `Unsupported file ${name}. Allowed formats: ${KNOWLEDGE_UPLOAD_LABEL}.` };
        }
        const size = Number(file?.size) || 0;
        if (size <= 0) return { ok: false, error: `File ${name} is empty.` };
        if (size > MAX_UPLOAD_FILE_BYTES) return { ok: false, error: `File ${name} exceeds the 20 MB size limit.` };
        total += size;
    }
    if (total > MAX_UPLOAD_TOTAL_BYTES) {
        return { ok: false, error: 'The upload exceeds the 100 MB total size limit. Upload fewer files at a time.' };
    }
    return { ok: true, error: null };
}

/**
 * Website field → crawl URL. Adds https:// when no scheme is given.
 * @returns {{ url: string, domain: string, error: string|null }}
 */
export function normalizeWebsiteInput(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return { url: '', domain: '', error: 'Enter your website address.' };
    if (/\s/.test(text)) return { url: '', domain: '', error: 'A website address cannot contain spaces.' };
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    let parsed;
    try {
        parsed = new URL(withScheme);
    } catch {
        return { url: '', domain: '', error: 'Enter a valid website address, for example example.com.' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { url: '', domain: '', error: 'Only http:// and https:// websites can be imported.' };
    }
    if (!parsed.hostname) return { url: '', domain: '', error: 'Enter a valid website address, for example example.com.' };
    return { url: withScheme, domain: parsed.hostname, error: null };
}

/** Host part of what the user typed, for the "Domain:" hint ('' when not parseable yet). */
export function domainHint(raw) {
    const result = normalizeWebsiteInput(raw);
    return result.error ? '' : result.domain;
}

export function isHttpUrl(url) {
    return /^https?:\/\//i.test(String(url || '').trim());
}

/** "document://Pricing.pdf" → "Pricing.pdf"; '' for anything else. */
export function documentName(url) {
    const m = /^document:\/\/(.+)$/i.exec(String(url || '').trim());
    return m ? m[1] : '';
}

// ── Status labels ────────────────────────────────────────────────────────────

const humanize = (value) => {
    const text = String(value ?? '').trim().replace(/[_-]+/g, ' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

/** Capsule.status: draft | approved | published. */
export function capsuleStatusMeta(status) {
    const key = String(status || '').trim().toLowerCase();
    if (key === 'published') return { key, label: 'Published', className: 'published' };
    if (key === 'approved') return { key, label: 'Approved', className: 'approved' };
    if (key === 'draft' || !key) return { key: 'draft', label: 'Draft', className: 'draft' };
    return { key, label: humanize(key), className: 'draft' };
}

/** KnowledgeSource.status: idle | connecting | crawling | extracting | completed | failed. */
export function sourceStatusMeta(status) {
    const key = String(status || '').trim().toLowerCase();
    if (key === 'completed') return { key, label: 'Ready', className: 'status-ok', running: false, failed: false };
    if (key === 'failed') return { key, label: 'Failed', className: 'status-failed', running: false, failed: true };
    if (key === 'connecting' || key === 'crawling' || key === 'extracting') {
        return { key, label: 'Importing', className: 'status-running', running: true, failed: false };
    }
    return { key: key || 'idle', label: 'Pending', className: 'status-pending', running: true, failed: false };
}

/**
 * Why a failed source's import ended, from `sources[].error_message` (cancelled and
 * interrupted imports are stored as failed with a readable message); null unless failed.
 * `detail` is the server's reason ('' when it adds nothing, e.g. for a cancellation).
 * @returns {{ cancelled: boolean, label: string, hint: string, detail: string } | null}
 */
export function sourceFailure(source) {
    if (!source || !sourceStatusMeta(source.status).failed) return null;
    const reason = typeof source.error_message === 'string' ? source.error_message.trim() : '';
    const cancelled = /^import cancelled\b/i.test(reason) || /\bwas cancelled\b/i.test(reason);
    const next = source.type === 'document'
        ? 'Upload the files again, or delete it.'
        : 'Re-sync to try again, or delete it.';
    return {
        cancelled,
        label: cancelled ? 'Cancelled' : 'Failed',
        hint: `${cancelled ? 'This import was cancelled.' : 'This import failed.'} ${next}`,
        detail: cancelled ? '' : reason,
    };
}

/** KnowledgeFact.inference_type: observed_fact | ai_inference | user_confirmed. */
export function factOriginMeta(inferenceType) {
    const key = String(inferenceType || '').trim().toLowerCase();
    if (key === 'observed_fact') return { label: 'Observed Fact', className: 'observed' };
    if (key === 'user_confirmed') return { label: 'User confirmed', className: 'user' };
    return { label: 'AI Inference', className: 'inference' };
}

/** KnowledgeFact.approval_status: approved | rejected | draft. */
export function approvalMeta(status) {
    const key = String(status || '').trim().toLowerCase();
    if (key === 'approved') return { label: 'Approved', className: 'confirmed', next: 'rejected', action: 'Reject' };
    if (key === 'rejected') return { label: 'Rejected', className: 'rejected', next: 'approved', action: 'Approve' };
    return { label: 'Draft', className: 'inference', next: 'approved', action: 'Approve' };
}

// ── Overview helpers ─────────────────────────────────────────────────────────

/** True when the overview has any capsule or source (the dashboard has something to show). */
export function hasKnowledge(overview) {
    const stats = overview?.stats || {};
    return (Number(stats.total_capsules) || 0) > 0 || (Number(stats.total_sources) || 0) > 0;
}

export function sourceDisplayName(source) {
    if (!source) return 'Source';
    if (source.type === 'website' && source.url) {
        try {
            return new URL(source.url).hostname || source.title || source.url;
        } catch {
            return source.title || source.url;
        }
    }
    return source.title || (source.type === 'document' ? 'Uploaded documents' : 'Source');
}

/** What the user types to confirm deleting a source: the website host, or the first file name. */
export function confirmPhraseForSource(source) {
    if (!source) return 'delete';
    if (source.type === 'website') return sourceDisplayName(source);
    const first = String(source.title || '').split(', ')[0].trim();
    return first || 'delete';
}

export function phraseMatches(input, phrase) {
    const a = String(input ?? '').trim().toLowerCase();
    const b = String(phrase ?? '').trim().toLowerCase();
    return Boolean(b) && a === b;
}

/** Capsules in the overview that were created from `source` (what DELETE /sources/{id} removes). */
export function capsulesFromSource(overview, source) {
    if (!overview || !source) return [];
    const all = [
        ...(overview.company_capsule ? [{ ...overview.company_capsule, type: 'company' }] : []),
        ...(Array.isArray(overview.product_capsules) ? overview.product_capsules.map((c) => ({ ...c, type: 'product' })) : []),
    ];
    const legacyUrl = source.url || (source.type === 'document' && source.title
        ? `document://${String(source.title).split(', ')[0]}`
        : null);
    return all.filter((c) => {
        const intel = c.intelligence_data && typeof c.intelligence_data === 'object' ? c.intelligence_data : {};
        if (intel.source_id) return intel.source_id === source.id;
        return Boolean(legacyUrl) && intel.source_url === legacyUrl;
    }).map((c) => ({ id: c.id, name: c.company_name || c.product_name || c.name || 'Untitled capsule', type: c.type }));
}

/** Immutable update of one fact in the overview. */
export function patchFact(overview, factId, patch) {
    if (!overview || !Array.isArray(overview.facts)) return overview;
    return { ...overview, facts: overview.facts.map((f) => (f.id === factId ? { ...f, ...patch } : f)) };
}

/** Immutable update of one capsule (company or product) in the overview. */
export function patchCapsule(overview, capsuleId, patch) {
    if (!overview) return overview;
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([, v]) => v !== undefined && v !== null));
    const next = { ...overview };
    if (next.company_capsule && next.company_capsule.id === capsuleId) {
        next.company_capsule = { ...next.company_capsule, ...clean };
    }
    if (Array.isArray(next.product_capsules)) {
        next.product_capsules = next.product_capsules.map((c) => (c.id === capsuleId ? { ...c, ...clean } : c));
    }
    return next;
}

/**
 * What stopping an import (POST /api/knowledge/jobs/{id}/cancel) does to its source — it is
 * kept, never deleted — for the confirmation and the cancelled state.
 */
export function cancelImportOutcome(kind) {
    const retry = kind === 'document' ? 'upload the files again to retry' : 're-sync it to try again';
    return `What Pearl has read so far is kept, but no capsules are created from this import. The source stays under Connected Sources as cancelled — ${retry}, or delete it.`;
}

/** "Read 2 uploaded documents (a.pdf, b.docx) …" / "Import https://x …" for the request bubble. */
export function describeImportRequest(job) {
    if (!job) return '';
    if (job.kind === 'document') {
        const names = Array.isArray(job.fileNames) ? job.fileNames.filter(Boolean) : [];
        const count = names.length;
        if (!count) return 'Read the uploaded documents and build knowledge capsules for review.';
        const shown = names.slice(0, 3).join(', ') + (count > 3 ? ` and ${count - 3} more` : '');
        return `Read ${count} uploaded document${count === 1 ? '' : 's'} (${shown}) and build knowledge capsules for review.`;
    }
    const target = job.url || job.label || 'your website';
    return `Read ${target} and build knowledge capsules — company, products, pricing, buyers and objections — for review.`;
}

/** Short label for the import target ("example.com" or "2 documents"). */
export function importTargetLabel({ kind, url, fileNames } = {}) {
    if (kind === 'document') {
        const count = Array.isArray(fileNames) ? fileNames.length : 0;
        if (count === 1) return fileNames[0];
        return count ? `${count} documents` : 'Uploaded documents';
    }
    const result = normalizeWebsiteInput(url);
    return result.error ? String(url || 'Website') : result.domain;
}
