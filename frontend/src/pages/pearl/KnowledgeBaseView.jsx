import React, { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import {
  Globe, FileText, Plus, ArrowRight, Loader2, RefreshCw,
  Trash2, ExternalLink, UploadCloud, AlertCircle, AlertTriangle, Eye,
  CheckCircle2, XCircle, Circle, X
} from 'lucide-react';
import { ApiError, apiFetch, errorMessage } from './lib/pearlApi.js';
import { useBackdropDismiss, useDialogA11y } from './lib/a11y.js';
import { formatDuration, formatServerDate, parseServerDate } from './lib/dates.js';
import {
  createJobState, jobReducer, stageListForJob, stageState, summarizeCapsules, watchKnowledgeJob,
} from './lib/knowledgeJob.js';
import {
  KNOWLEDGE_UPLOAD_ACCEPT, KNOWLEDGE_UPLOAD_LABEL, approvalMeta, cancelImportOutcome, capsuleStatusMeta,
  capsulesFromSource, confirmPhraseForSource, describeImportRequest, documentName, domainHint, factOriginMeta,
  formatBytes, hasKnowledge, importTargetLabel, isHttpUrl, normalizeWebsiteInput, patchCapsule, patchFact,
  phraseMatches, sourceDisplayName, sourceFailure, sourceStatusMeta, validateKnowledgeFiles,
} from './lib/knowledgeView.js';
import './KnowledgeBaseView.css';

const OVERVIEW_PATH = '/api/knowledge/overview';
const enc = encodeURIComponent;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STAGE_STATE_LABEL = { done: 'Done', active: 'In progress', failed: 'Failed', pending: 'Not started' };
const MISSING_VALUE = 'Not found in your sources yet';

const renderFactValue = (value) => (
  value !== null && value !== undefined && String(value).trim()
    ? <span className="kb-fact-value">{value}</span>
    : <span className="kb-fact-value kb-muted-value">{MISSING_VALUE}</span>
);

// ── Accessible confirmation dialog (optionally asks the user to type a phrase) ──
function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancel', phrase, busy, error, tone = 'delete', onConfirm, onCancel }) {
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const inputId = useId();
  const { ref, dialogProps } = useDialogA11y(true, busy ? null : onCancel);
  const backdrop = useBackdropDismiss(busy ? null : onCancel);
  const canConfirm = !busy && (!phrase || phraseMatches(typed, phrase));
  const Icon = tone === 'stop' ? XCircle : Trash2;

  return (
    <div className="kb-modal-backdrop" {...backdrop}>
      <div className="kb-modal" ref={ref} {...dialogProps} aria-labelledby={titleId}>
        <div className="kb-modal-header">
          <h4 id={titleId} className="kb-modal-title">{title}</h4>
          <button type="button" className="kb-modal-close" onClick={onCancel} disabled={busy} aria-label="Close dialog">
            <X size={15} />
          </button>
        </div>
        <div className="kb-modal-body">{children}</div>
        {phrase && (
          <div className="kb-confirm-field">
            <label htmlFor={inputId}>Type <strong>{phrase}</strong> to confirm</label>
            <input
              id={inputId}
              type="text"
              className="kb-confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              data-autofocus
            />
          </div>
        )}
        {error && <p className="kb-modal-error" role="alert">{error}</p>}
        <div className="kb-modal-actions">
          <button type="button" className="kb-btn-mini" onClick={onCancel} disabled={busy} data-autofocus={phrase ? undefined : true}>
            {cancelLabel}
          </button>
          <button type="button" className="kb-btn-danger" onClick={onConfirm} disabled={!canConfirm}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
            <span>{busy ? 'Working…' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Evidence excerpt dialog ──
function EvidenceDialog({ fact, onClose }) {
  const titleId = useId();
  const { ref, dialogProps } = useDialogA11y(true, onClose);
  const backdrop = useBackdropDismiss(onClose);
  const fromDocument = documentName(fact.source_url);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(9,9,11,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}
      {...backdrop}
    >
      <div
        ref={ref}
        {...dialogProps}
        aria-labelledby={titleId}
        style={{ background: '#ffffff', borderRadius: 14, padding: '1.75rem', maxWidth: 500, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', outline: 'none' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: 12 }}>
          <h4 id={titleId} style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Source Evidence Excerpt</h4>
          <button type="button" className="kb-btn-mini" onClick={onClose} data-autofocus>Close</button>
        </div>
        <p style={{ fontSize: '0.88rem', color: '#52525b', lineHeight: 1.5, background: '#f4f4f5', padding: '12px', borderRadius: 8, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
          "{fact.source_excerpt}"
        </p>
        {isHttpUrl(fact.source_url) ? (
          <a
            href={fact.source_url}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#09090b', fontWeight: 600, textDecoration: 'none', marginTop: 10 }}
          >
            <span>View Source URL</span>
            <ExternalLink size={12} />
          </a>
        ) : fromDocument ? (
          <p style={{ fontSize: '0.8rem', color: '#52525b', margin: '10px 0 0 0' }}>
            From document: <strong>{fromDocument}</strong>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export const KnowledgeBaseView = () => {
  // 'loading' | 'error' | 'landing' | 'analyzing' | 'dashboard'
  const [viewMode, setViewMode] = useState('loading');
  const [activeTab, setActiveTab] = useState('company');

  // Overview (GET /api/knowledge/overview)
  const [overviewData, setOverviewData] = useState(null);
  const [overviewError, setOverviewError] = useState(null);

  // Landing form
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [showWebsiteForm, setShowWebsiteForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [landingNotice, setLandingNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Import job — driven only by the server's job events
  // { id, kind, mode, url, label, fileNames, startedAt, staleStamp, cancelling?, settled? }
  // cancelling: the cancel request is in flight; settled: cancelled here (no more events to follow).
  const [job, setJob] = useState(null);
  const [jobState, dispatchJob] = useReducer(jobReducer, undefined, () => createJobState());
  const [watchKey, setWatchKey] = useState(0);
  const [retryError, setRetryError] = useState(null);
  const [now, setNow] = useState(0);

  // Dashboard actions
  const [busyAction, setBusyAction] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);
  const [editingFactId, setEditingFactId] = useState(null);
  const [editFactValue, setEditFactValue] = useState('');
  const [factBusyId, setFactBusyId] = useState(null);
  const [factError, setFactError] = useState(null); // { id, message }
  const [evidenceFact, setEvidenceFact] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind, payload, busy, error }

  // ── Overview loading (never changes the view on its own failure paths) ─────
  const loadInitialOverview = useCallback(async () => {
    try {
      const data = await apiFetch(OVERVIEW_PATH);
      setOverviewData(data);
      setOverviewError(null);
      setViewMode(hasKnowledge(data) ? 'dashboard' : 'landing');
    } catch (err) {
      setOverviewError(errorMessage(err, "Couldn't load your knowledge base. Please try again."));
      setViewMode('error');
    }
  }, []);

  useEffect(() => {
    loadInitialOverview();
  }, [loadInitialOverview]);

  /** Re-read the overview after a change; a failure is shown, the current data is kept. */
  const refreshOverview = useCallback(async () => {
    try {
      const data = await apiFetch(OVERVIEW_PATH);
      setOverviewData(data);
      return data;
    } catch (err) {
      setActionError(`Couldn't refresh the knowledge base: ${errorMessage(err, 'please try again.')}`);
      return null;
    }
  }, []);

  /** Leave the import view for the dashboard (the import keeps running on the server if it is still going). */
  const openDashboard = useCallback(async () => {
    setDialog(null);
    setViewMode('loading');
    try {
      const data = await apiFetch(OVERVIEW_PATH);
      setOverviewData(data);
      setOverviewError(null);
      setViewMode('dashboard');
    } catch (err) {
      setOverviewError(errorMessage(err, "Couldn't load your knowledge base. Please try again."));
      setViewMode('error');
    }
  }, []);

  const handleRetryOverview = () => {
    setViewMode('loading');
    loadInitialOverview();
  };

  // ── Follow the active import: SSE stream (Authorization header) with polling fallback ──
  useEffect(() => {
    if (viewMode !== 'analyzing' || !job || job.cancelling || job.settled) return undefined;
    const watcher = watchKnowledgeJob({
      jobId: job.id,
      staleStamp: job.staleStamp || null,
      onEvent: (data) => dispatchJob({ type: 'event', data, receivedAt: Date.now() }),
      onLiveModeChange: (mode) => dispatchJob({ type: 'live-mode', mode }),
      onConnectionLost: (error) => dispatchJob({ type: 'connection-lost', error }),
    });
    return () => watcher.stop();
  }, [viewMode, job, watchKey]);

  // Elapsed-time ticker while the import runs (wall clock, not a progress estimate).
  const jobRunning = viewMode === 'analyzing' && Boolean(job) && jobState.status === 'running';
  useEffect(() => {
    if (!jobRunning) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobRunning]);

  const beginJob = useCallback((attempt) => {
    const startedAt = Number.isFinite(attempt.startedAt) ? attempt.startedAt : Date.now();
    dispatchJob({ type: 'start', stages: attempt.stages, staleStamp: attempt.staleStamp || null });
    setRetryError(null);
    setDialog(null);
    setNow(Date.now());
    setJob({ ...attempt, startedAt, cancelling: false });
    setViewMode('analyzing');
  }, []);

  const deleteSourceIfPresent = async (sourceId) => {
    try {
      await apiFetch(`/api/knowledge/sources/${enc(sourceId)}`, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  };

  const startUpload = async (files) => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    const data = await apiFetch('/api/knowledge/upload', { method: 'POST', body: formData });
    if (!data?.job_id) throw new ApiError('The server did not return an import id. Please try again.', { status: 200 });
    const fileNames = files.map((f) => f.name);
    beginJob({
      id: data.job_id, kind: 'document', mode: 'upload', fileNames,
      label: importTargetLabel({ kind: 'document', fileNames }), stages: data.stages,
    });
  };

  const startCrawl = async (url, label) => {
    const data = await apiFetch('/api/knowledge/crawl', { method: 'POST', body: { url } });
    if (!data?.job_id) throw new ApiError('The server did not return an import id. Please try again.', { status: 200 });
    const crawlUrl = data.url || url;
    beginJob({
      id: data.job_id, kind: 'website', mode: 'crawl', url: crawlUrl,
      label: label || importTargetLabel({ kind: 'website', url: crawlUrl }), stages: data.stages,
    });
  };

  /** Re-run a website source (same source id, no duplicate). Falls back to a new crawl if it is gone. */
  const resyncWebsite = async ({ id, url, label, staleStamp, stages }) => {
    try {
      const data = await apiFetch(`/api/knowledge/sources/${enc(id)}/resync`, { method: 'POST' });
      beginJob({ id: data?.job_id || id, kind: 'website', mode: 'resync', url, label, stages, staleStamp });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && url) {
        await startCrawl(url, label);
        return;
      }
      throw err;
    }
  };

  // ── Start imports ───────────────────────────────────────────────────────────
  const handleStartWebsiteCrawl = async (e) => {
    e?.preventDefault();
    if (submittingRef.current) return;
    const target = normalizeWebsiteInput(websiteUrl);
    if (target.error) {
      setUploadError(target.error);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setUploadError(null);
    setLandingNotice(null);
    try {
      await startCrawl(target.url, target.domain);
    } catch (err) {
      setUploadError(errorMessage(err, 'Could not start the website import. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleUploadDocuments = async () => {
    if (submittingRef.current) return;
    const check = validateKnowledgeFiles(selectedFiles);
    if (!check.ok) {
      setUploadError(check.error);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setUploadError(null);
    setLandingNotice(null);
    try {
      await startUpload(selectedFiles);
    } catch (err) {
      setUploadError(errorMessage(err, 'Could not upload the documents. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const chooseFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setSelectedFiles(files);
    setUploadError(null);
  };

  /** `timestamp` of the job event the server holds now (a re-sync must skip a replay of it), or null. */
  const currentJobStamp = async (jobId) => {
    try {
      const snapshot = await apiFetch(`/api/knowledge/jobs/${enc(jobId)}`);
      return typeof snapshot?.timestamp === 'string' ? snapshot.timestamp : null;
    } catch {
      return null; // no cached event to skip; the re-sync itself reports real errors
    }
  };

  // ── Recover a failed import ─────────────────────────────────────────────────
  const handleRetryIngestion = async () => {
    if (!job || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setRetryError(null);
    try {
      if (job.kind === 'document') {
        if (!selectedFiles.length) {
          setRetryError('Choose the files again to retry this upload.');
          return;
        }
        const check = validateKnowledgeFiles(selectedFiles);
        if (!check.ok) {
          setRetryError(check.error);
          return;
        }
        // Remove the failed attempt first so a retry never leaves a duplicate source behind.
        await deleteSourceIfPresent(job.id);
        await startUpload(selectedFiles);
      } else {
        // A cancellation made here was not received as a job event: read the stamp of the
        // terminal event the server cached for it, so its replay can't end the new attempt.
        const staleStamp = job.settled ? ((await currentJobStamp(job.id)) || jobState.lastStamp) : jobState.lastStamp;
        await resyncWebsite({ id: job.id, url: job.url, label: job.label, staleStamp, stages: jobState.stages });
      }
    } catch (err) {
      setRetryError(errorMessage(err, 'Could not restart the import. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleChangeSource = () => {
    setRetryError(null);
    setShowWebsiteForm(job?.kind !== 'document');
    setShowDocForm(job?.kind === 'document');
    setViewMode('landing');
  };

  const handleReconnect = () => {
    dispatchJob({ type: 'reconnect' });
    setWatchKey((k) => k + 1);
  };

  // ── Dashboard: running / failed sources ─────────────────────────────────────
  const handleWatchSource = (source) => {
    const kind = source.type === 'document' ? 'document' : 'website';
    beginJob({
      id: source.id,
      kind,
      mode: 'watch',
      url: source.url || '',
      label: sourceDisplayName(source),
      fileNames: kind === 'document' ? String(source.title || '').split(', ').filter(Boolean) : [],
      stages: [],
      startedAt: parseServerDate(source.created_at)?.getTime(),
    });
  };

  const handleRetrySource = async (source) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusyAction(`retry-${source.id}`);
    setActionError(null);
    setActionNotice(null);
    try {
      // A cached terminal event of the earlier attempt must not end the new one.
      const staleStamp = await currentJobStamp(source.id);
      await resyncWebsite({ id: source.id, url: source.url, label: sourceDisplayName(source), staleStamp, stages: [] });
    } catch (err) {
      setActionError(`Could not re-sync ${sourceDisplayName(source)}: ${errorMessage(err, 'please try again.')}`);
    } finally {
      submittingRef.current = false;
      setBusyAction(null);
    }
  };

  /**
   * Stop a running import WITHOUT deleting its source: the server keeps it as failed with
   * "Import cancelled." (pages already read stay, no capsules are created) and frees its
   * slot in the 2-running-imports limit.
   */
  const cancelImport = (sourceId) => apiFetch(`/api/knowledge/jobs/${enc(sourceId)}/cancel`, { method: 'POST' });

  // ── Facts ───────────────────────────────────────────────────────────────────
  const startFactEdit = (fact) => {
    setEditingFactId(fact.id);
    setEditFactValue(fact.value || '');
    setFactError(null);
  };

  const cancelFactEdit = () => {
    setEditingFactId(null);
    setFactError(null);
  };

  const handleSaveFactEdit = async (factId) => {
    const value = editFactValue.trim();
    if (!value) {
      setFactError({ id: factId, message: 'A fact cannot be empty. Cancel to keep the current value.' });
      return;
    }
    setFactBusyId(factId);
    setFactError(null);
    try {
      const res = await apiFetch(`/api/knowledge/facts/${enc(factId)}`, { method: 'PATCH', body: { value } });
      setOverviewData((prev) => patchFact(prev, factId, { value: res?.value ?? value, inference_type: 'user_confirmed' }));
      setEditingFactId(null);
      refreshOverview();
    } catch (err) {
      setFactError({ id: factId, message: errorMessage(err, 'Could not save this fact. Please try again.') });
    } finally {
      setFactBusyId(null);
    }
  };

  const handleToggleFactApproval = async (fact) => {
    const meta = approvalMeta(fact.approval_status);
    setFactBusyId(fact.id);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/knowledge/facts/${enc(fact.id)}`, { method: 'PATCH', body: { approval_status: meta.next } });
      setOverviewData((prev) => patchFact(prev, fact.id, { approval_status: res?.approval_status || meta.next }));
    } catch (err) {
      setActionError(`Could not update "${fact.field_name}": ${errorMessage(err, 'please try again.')}`);
    } finally {
      setFactBusyId(null);
    }
  };

  // ── Publish ─────────────────────────────────────────────────────────────────
  const handlePublishCapsule = async (capsule, name) => {
    if (busyAction) return;
    setBusyAction(`publish-${capsule.id}`);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await apiFetch(`/api/knowledge/capsules/${enc(capsule.id)}/publish`, { method: 'POST' });
      setOverviewData((prev) => patchCapsule(prev, capsule.id, { version: res?.version, status: res?.status }));
      setActionNotice(`Published ${name} as version ${res?.version ?? (capsule.version || 1) + 1}.`);
      refreshOverview();
    } catch (err) {
      setActionError(`Could not publish ${name}: ${errorMessage(err, 'please try again.')}`);
    } finally {
      setBusyAction(null);
    }
  };

  // ── Destructive actions (confirmed in a dialog) ─────────────────────────────
  const openDialog = (kind, payload = null) => {
    setActionError(null);
    setActionNotice(null);
    setDialog({ kind, payload, busy: false, error: null });
  };

  const closeDialog = () => {
    if (!dialog?.busy) setDialog(null);
  };

  const handleDialogConfirm = async () => {
    if (!dialog || dialog.busy) return;
    const current = dialog;
    setDialog({ ...current, busy: true, error: null });
    try {
      if (current.kind === 'cancel-import') {
        const target = job;
        if (!target) {
          setDialog(null);
          return;
        }
        setJob({ ...target, cancelling: true }); // stop following events while the server cancels
        try {
          await cancelImport(target.id);
        } catch (err) {
          setJob(target); // follow the import again
          if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
            // It finished (409) or is gone (404) meanwhile: the job events show how it ended.
            setDialog(null);
            return;
          }
          throw err;
        }
        setDialog(null);
        setJob({ ...target, cancelling: false, settled: true });
        dispatchJob({
          type: 'event',
          receivedAt: Date.now(),
          data: { status: 'failed', cancelled: true, error: `Import cancelled. ${cancelImportOutcome(target.kind)}` },
        });
        return;
      }

      if (current.kind === 'cancel-source') {
        const { source } = current.payload;
        const name = sourceDisplayName(source);
        try {
          await cancelImport(source.id);
          setActionNotice(`Cancelled the import of ${name}. What it had read so far is kept; the source stays listed as cancelled.`);
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            setActionNotice(errorMessage(err)); // it finished in the meantime: nothing to cancel
          } else if (err instanceof ApiError && err.status === 404) {
            setActionError(`Couldn't cancel the import of ${name}: ${errorMessage(err)}`);
          } else {
            throw err;
          }
        }
        setDialog(null);
        await refreshOverview();
        return;
      }

      if (current.kind === 'reset') {
        await apiFetch('/api/knowledge/reset', { method: 'POST' });
        setDialog(null);
        setOverviewData(null);
        setLandingNotice('All knowledge was deleted. Pearl agents no longer have a knowledge base.');
        setViewMode('landing');
        return;
      }

      let notice = '';
      if (current.kind === 'delete-source') {
        const { source, capsules } = current.payload;
        await deleteSourceIfPresent(source.id);
        notice = capsules.length
          ? `Deleted ${sourceDisplayName(source)} and ${plural(capsules.length, 'capsule')} created from it.`
          : `Deleted ${sourceDisplayName(source)}.`;
      } else if (current.kind === 'delete-capsule') {
        const { id, name } = current.payload;
        try {
          await apiFetch(`/api/knowledge/capsules/${enc(id)}`, { method: 'DELETE' });
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        notice = `Deleted the capsule ${name}.`;
      }
      setDialog(null);
      setActionNotice(notice);
      const data = await refreshOverview();
      if (data && !hasKnowledge(data)) {
        setLandingNotice(notice);
        setViewMode('landing');
      }
    } catch (err) {
      setDialog({ ...current, busy: false, error: errorMessage(err, 'Something went wrong. Please try again.') });
    }
  };

  const renderDialog = () => {
    if (!dialog) return null;
    const common = { busy: dialog.busy, error: dialog.error, onConfirm: handleDialogConfirm, onCancel: closeDialog };
    const stats = overviewData?.stats || {};

    if (dialog.kind === 'cancel-import') {
      // Only meaningful while the import is still running (it may finish while the dialog is open).
      if (!job || (jobState.status !== 'running' && !dialog.busy)) return null;
      return (
        <ConfirmDialog {...common} tone="stop" title="Cancel this import?" confirmLabel="Cancel import" cancelLabel="Keep importing">
          <p>Cancel the import of <strong>{job.label}</strong>?</p>
          <p>{cancelImportOutcome(job.kind)}</p>
          <p>To keep it, choose <strong>Keep importing</strong> — or use &ldquo;Continue in background&rdquo; to leave this page while it finishes.</p>
        </ConfirmDialog>
      );
    }

    if (dialog.kind === 'cancel-source') {
      const { source } = dialog.payload;
      return (
        <ConfirmDialog {...common} tone="stop" title="Cancel this import?" confirmLabel="Cancel import" cancelLabel="Keep importing">
          <p>Cancel the import of <strong>{source.title || sourceDisplayName(source)}</strong>?</p>
          <p>{cancelImportOutcome(source.type === 'document' ? 'document' : 'website')}</p>
        </ConfirmDialog>
      );
    }

    if (dialog.kind === 'delete-source') {
      const { source, capsules } = dialog.payload;
      const status = sourceStatusMeta(source.status);
      const isDoc = source.type === 'document';
      const items = Number(source.pages_processed) || 0;
      return (
        <ConfirmDialog {...common} title="Delete this source?" confirmLabel="Delete source" phrase={confirmPhraseForSource(source)}>
          <p>Delete <strong>{source.title || sourceDisplayName(source)}</strong>? This permanently removes:</p>
          <ul className="kb-modal-list">
            <li>{isDoc ? plural(items, 'indexed file') : plural(items, 'indexed page')}</li>
            <li>
              {capsules.length
                ? <>{plural(capsules.length, 'capsule')} created from it: {capsules.map((c) => c.name).join(', ')}</>
                : 'No capsules listed here were created from it.'}
            </li>
            <li>The facts in those capsules, including any edits you made</li>
          </ul>
          <p>
            Pearl agents that use one of these capsules lose their knowledge base.
            {status.running ? ' The import that is still running is stopped.' : ''} Other sources and manually created capsules are kept.
            This can&rsquo;t be undone.
          </p>
        </ConfirmDialog>
      );
    }

    if (dialog.kind === 'delete-capsule') {
      const { name } = dialog.payload;
      return (
        <ConfirmDialog {...common} title="Delete this capsule?" confirmLabel="Delete capsule">
          <p>Delete the capsule <strong>{name}</strong>?</p>
          <p>
            Pearl agents that use it will no longer have it as their knowledge base, and its version history is removed.
            Its facts stay in your knowledge base but are no longer attached to a capsule. This can&rsquo;t be undone.
          </p>
        </ConfirmDialog>
      );
    }

    if (dialog.kind === 'reset') {
      const companyName = overviewData?.company_capsule?.company_name?.trim();
      return (
        <ConfirmDialog {...common} title="Delete all knowledge?" confirmLabel="Delete everything" phrase={companyName || 'delete all'}>
          <p>This permanently deletes everything in your knowledge base:</p>
          <ul className="kb-modal-list">
            <li>{plural(Number(stats.total_sources) || 0, 'source')} and {plural(Number(stats.total_pages) || 0, 'indexed page')}</li>
            <li>{plural(Number(stats.total_capsules) || 0, 'capsule')}, including manually created ones</li>
            <li>{plural(Number(stats.total_facts) || 0, 'fact')}, including your edits</li>
          </ul>
          <p>Every Pearl agent loses its knowledge base and imports in progress are stopped. This can&rsquo;t be undone.</p>
        </ConfirmDialog>
      );
    }
    return null;
  };

  // ── RENDER: LOADING STATE ──────────────────────────────────────────────────
  if (viewMode === 'loading' || (viewMode === 'analyzing' && !job)) {
    return (
      <div className="kb-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={24} className="animate-spin" color="#09090b" aria-label="Loading knowledge base" />
      </div>
    );
  }

  // ── RENDER: OVERVIEW COULD NOT BE LOADED (distinct from an empty knowledge base) ──
  if (viewMode === 'error') {
    return (
      <div className="kb-root animate-fade-in">
        <div className="kb-top-bar">
          <div className="kb-breadcrumb">
            <span>Pearl</span>
            <span>/</span>
            <span className="kb-breadcrumb-title">Knowledge base</span>
          </div>
        </div>
        <div className="kb-state-card" role="alert">
          <div className="kb-state-icon"><AlertCircle size={22} /></div>
          <h2 className="kb-state-title">Couldn&rsquo;t load your knowledge base</h2>
          <p className="kb-state-text">{overviewError}</p>
          <button type="button" className="kb-card-btn primary kb-state-btn" onClick={handleRetryOverview}>
            <RefreshCw size={15} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // ── RENDER: IMPORT PROGRESS (real job events only) ─────────────────────────
  if (viewMode === 'analyzing') {
    const isDone = jobState.status === 'completed';
    const isFailed = jobState.status === 'failed';
    const isRunning = jobState.status === 'running';
    const stageList = stageListForJob(jobState.stages, job.kind);
    const progress = Math.round(jobState.progress);
    const endTime = jobState.endedAt || now;
    const elapsedSeconds = endTime > job.startedAt ? Math.floor((endTime - job.startedAt) / 1000) : 0;
    const activeStage = stageList.find((s) => s.stage === jobState.stage);
    const failureTitle = jobState.cancelled ? 'Import cancelled' : 'Import failed';
    const headline = isDone ? 'Import complete' : isFailed ? failureTitle : (jobState.title || activeStage?.title || 'Starting import');
    const capsuleSummary = summarizeCapsules(jobState.capsules);
    const superseded = jobState.merge?.superseded || 0;
    const completionSubtitle = !jobState.capsulesKnown
      ? `The import of ${job.label} finished. Review the knowledge base to see what was created.`
      : capsuleSummary.total
        ? `Pearl created ${plural(capsuleSummary.total, 'capsule')} from ${job.label}.`
        : `The import of ${job.label} finished, but no capsules were created from it.`;

    return (
      <div className="kb-root animate-fade-in flex flex-col min-h-screen bg-white" style={{ backgroundColor: '#ffffff', color: '#09090b' }}>
        {/* Top Breadcrumb Bar */}
        <div className="kb-top-bar" style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #f0f0f2' }}>
          <div className="kb-breadcrumb">
            <span>Pearl</span>
            <span>/</span>
            <span className="kb-breadcrumb-title">
              {isDone ? 'Import complete' : isFailed ? 'Import stopped' : 'Importing knowledge'}
            </span>
          </div>
          <div className="kb-top-actions flex items-center gap-2">
            {isRunning && (
              <>
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer disabled:opacity-50"
                  onClick={() => openDialog('cancel-import')}
                  disabled={Boolean(job.cancelling)}
                  title="Stop the import; the source and what it has read so far are kept"
                >
                  Cancel import
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-900 bg-zinc-100 border border-zinc-200 rounded-lg hover:bg-zinc-200 shadow-2xs transition-colors cursor-pointer"
                  onClick={openDashboard}
                  title="The import keeps running on the server; its progress stays available under Connected Sources."
                >
                  <span>Continue in background</span>
                  <ArrowRight size={12} />
                </button>
              </>
            )}
            {isDone && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 shadow-2xs transition-colors cursor-pointer"
                onClick={openDashboard}
              >
                <span>Review Knowledge Base</span>
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Center-Oriented & Fully Responsive Container */}
        <div className="flex-1 w-full bg-white flex flex-col items-center justify-start px-4 pt-8 pb-20 sm:px-6" style={{ backgroundColor: '#ffffff' }}>
          <div className="w-full max-w-2xl flex flex-col gap-6">

            {/* Target Status Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 font-mono border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${isFailed ? 'bg-rose-500' : 'bg-emerald-500'} ${isRunning ? 'animate-pulse' : ''}`} />
                <span className="font-semibold text-zinc-700 tracking-wider uppercase text-[10px]">
                  {isDone ? 'Import finished' : isFailed ? 'Import stopped' : 'Import in progress'}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate">Source: <strong className="text-zinc-800">{job.label}</strong></span>
                <span>•</span>
                <span>{formatDuration(elapsedSeconds)}</span>
              </div>
            </div>

            {/* What was requested */}
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-zinc-100 text-zinc-800 px-4 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-2xs border border-zinc-200/60 font-sans break-words">
                {describeImportRequest(job)}
              </div>
            </div>

            {/* Live progress from the server */}
            <div className="flex flex-col gap-4 bg-white rounded-xl border border-zinc-200/80 p-4 sm:p-5 shadow-2xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-zinc-900">{headline}</p>
                  <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed break-words" aria-live="polite">
                    {jobState.message || 'Waiting for the first progress update from the server…'}
                  </p>
                </div>
                <span className="text-xs font-mono font-semibold text-zinc-800 shrink-0">{progress}%</span>
              </div>

              <div
                className="kb-progress-track"
                role="progressbar"
                aria-label="Import progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div className={`kb-progress-fill ${isDone ? 'done' : ''} ${isFailed ? 'failed' : ''}`} style={{ width: `${progress}%` }} />
              </div>

              {job.kind === 'website' && jobState.pagesDiscovered !== null && (
                <p className="text-[11px] text-zinc-500 font-mono break-all">
                  Pages read: {jobState.pagesProcessed ?? 0} of {jobState.pagesDiscovered} found
                  {jobState.currentUrl ? ` · ${jobState.currentUrl}` : ''}
                </p>
              )}

              {isRunning && jobState.liveMode === 'polling' && !jobState.connectionError && (
                <p className="text-[11px] text-zinc-500">
                  Live updates are unavailable, so Pearl is checking the import every few seconds.
                </p>
              )}

              {stageList.length > 0 && (
                <ol className="kb-pipeline-checklist kb-stage-list" aria-label="Import stages">
                  {stageList.map((s) => {
                    const state = stageState(s.stage, jobState);
                    const Icon = state === 'done' ? CheckCircle2 : state === 'failed' ? XCircle : state === 'active' ? Loader2 : Circle;
                    return (
                      <li key={s.key} className={`kb-stage-item ${state}`}>
                        <Icon size={14} className={`kb-stage-icon ${state === 'active' ? 'animate-spin' : ''}`} aria-hidden="true" />
                        <span className="kb-stage-text">
                          <span>{s.title}</span>
                          {s.detail && <span className="kb-stage-detail">{s.detail}</span>}
                        </span>
                        <span className="sr-only">{STAGE_STATE_LABEL[state]}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            {/* Failure (or lost connection) with real recovery actions */}
            {(isFailed || jobState.connectionError) && (
              <div className="w-full rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 text-left shadow-2xs" role="alert">
                <div className="flex items-start gap-3">
                  <AlertCircle className="size-4 shrink-0 text-rose-600 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-rose-800">
                      {isFailed ? failureTitle : 'Live progress unavailable'}
                    </p>
                    <p className="mt-1 leading-relaxed text-rose-700/90 break-words">
                      {isFailed
                        ? jobState.error
                        : `${jobState.connectionError} The import may still be running on the server — you can check it later under Connected Sources.`}
                    </p>
                    {retryError && <p className="mt-2 font-medium text-rose-800 break-words">{retryError}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {isFailed ? (
                        <>
                          <button
                            type="button"
                            onClick={handleRetryIngestion}
                            disabled={submitting}
                            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-rose-700 transition-colors shadow-2xs cursor-pointer disabled:opacity-60"
                          >
                            {submitting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            <span>{submitting ? 'Restarting…' : 'Retry Import'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleChangeSource}
                            disabled={submitting}
                            className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                          >
                            <span>Change Source</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={handleReconnect}
                          className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-rose-700 transition-colors shadow-2xs cursor-pointer"
                        >
                          <RefreshCw size={12} />
                          <span>Reconnect</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={openDashboard}
                        disabled={submitting}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] text-rose-600 hover:text-rose-800 hover:underline transition-colors cursor-pointer"
                      >
                        <span>{isFailed ? 'Skip to Dashboard' : 'Open Dashboard'}</span>
                        <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Completed: what the server reported */}
            {isDone && (
              <div className="w-full bg-white border border-emerald-200 rounded-xl p-5 shadow-2xs text-left animate-fade-in flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200">
                    <CheckCircle2 size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-900">Knowledge import complete</h3>
                    <p className="text-xs text-zinc-600 mt-0.5 break-words">{completionSubtitle}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-[11px] font-semibold text-zinc-900">
                      {jobState.capsulesKnown ? plural(capsuleSummary.total, 'capsule') : 'Capsules'}
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">
                      {jobState.capsulesKnown
                        ? `${capsuleSummary.company} company · ${capsuleSummary.products} product`
                        : 'See the knowledge base'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    {job.kind === 'document' ? (
                      <>
                        <div className="text-[11px] font-semibold text-zinc-900">
                          {jobState.skippedFiles.length ? plural(jobState.skippedFiles.length, 'file') + ' skipped' : 'All files read'}
                        </div>
                        <div className="text-[10px] text-zinc-600 mt-0.5">{plural(job.fileNames?.length || 0, 'file')} uploaded</div>
                      </>
                    ) : (
                      <>
                        <div className="text-[11px] font-semibold text-zinc-900">
                          {jobState.pagesProcessed !== null ? plural(jobState.pagesProcessed, 'page') + ' read' : 'Pages read'}
                        </div>
                        <div className="text-[10px] text-zinc-600 mt-0.5">
                          {jobState.pagesDiscovered !== null ? `${jobState.pagesDiscovered} found on the site` : 'See Connected Sources'}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-[11px] font-semibold text-zinc-900">Ready for review</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">
                      {superseded ? `Replaced ${plural(superseded, 'unreviewed draft')} from this source` : 'New capsules start as drafts'}
                    </div>
                  </div>
                </div>

                {capsuleSummary.names.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {capsuleSummary.names.map((name, i) => (
                      <span key={`${name}-${i}`} className="kb-chip">{name}</span>
                    ))}
                  </div>
                )}

                {jobState.skippedFiles.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle size={12} />
                      <span>Some files could not be read and were skipped</span>
                    </p>
                    <ul className="mt-1.5 list-disc pl-4 space-y-0.5">
                      {jobState.skippedFiles.map((reason, i) => (
                        <li key={i} className="break-words">{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-zinc-200">
                  <div className="text-[11px] text-zinc-600">
                    Check the extracted facts, then publish the capsules you want Pearl to rely on.
                  </div>
                  <button
                    type="button"
                    onClick={openDashboard}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg shadow-2xs transition-colors cursor-pointer"
                  >
                    <span>Review Knowledge Base</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
        {renderDialog()}
      </div>
    );
  }

  // ── RENDER: LANDING / TEACH PEARL ──────────────────────────────────────────
  if (viewMode === 'landing') {
    const domain = domainHint(websiteUrl);
    const fileCheck = selectedFiles.length ? validateKnowledgeFiles(selectedFiles) : null;
    const existingCapsules = Number(overviewData?.stats?.total_capsules) || 0;

    return (
      <div className="kb-root animate-fade-in">
        <div className="kb-top-bar">
          <div className="kb-breadcrumb">
            <span>Pearl</span>
            <span>/</span>
            <span className="kb-breadcrumb-title">Knowledge base</span>
          </div>
          {hasKnowledge(overviewData) && (
            <button
              type="button"
              className="kb-btn-mini"
              onClick={openDashboard}
            >
              &larr; {existingCapsules > 0 ? `View Existing Capsules (${existingCapsules})` : 'View Knowledge Base'}
            </button>
          )}
        </div>

        <div className="kb-hero-header">
          <h1 className="kb-hero-title">Teach Pearl about your business.</h1>
          <p className="kb-hero-subtitle">
            Connect your website or upload your business documents. Pearl will learn your products, understand your audience and prepare its sales knowledge.
          </p>
        </div>

        {landingNotice && (
          <div className="kb-banner kb-banner-notice kb-landing-banner" role="status">
            <CheckCircle2 size={15} />
            <span>{landingNotice}</span>
            <button type="button" className="kb-banner-close" onClick={() => setLandingNotice(null)} aria-label="Dismiss message">
              <X size={13} />
            </button>
          </div>
        )}

        {uploadError && (
          <div className="kb-landing-error" role="alert">
            <AlertCircle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            {uploadError}
          </div>
        )}

        <div className="kb-entry-grid">
          {/* OPTION A: IMPORT FROM WEBSITE (RECOMMENDED) */}
          <div className="kb-entry-card recommended">
            <span className="kb-card-badge">Recommended</span>
            <div>
              <div className="kb-card-icon-box">
                <Globe size={24} />
              </div>
              <h3 className="kb-card-title">Import from website</h3>
              <p className="kb-card-desc">
                Let Pearl explore your website and understand your business automatically.
              </p>
            </div>

            {!showWebsiteForm ? (
              <button
                type="button"
                className="kb-card-btn primary"
                onClick={() => setShowWebsiteForm(true)}
              >
                <span>Add website</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <form className="kb-card-form" onSubmit={handleStartWebsiteCrawl}>
                <div className="kb-url-input-wrap">
                  <span className="kb-url-prefix">{/^http:\/\//i.test(websiteUrl.trim()) ? 'http://' : 'https://'}</span>
                  <input
                    type="text"
                    className="kb-url-input"
                    placeholder="example.com"
                    aria-label="Website address"
                    value={websiteUrl.replace(/^https?:\/\//, '')}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    disabled={submitting}
                    autoFocus
                  />
                </div>

                {domain && (
                  <div className="kb-domain-badge">
                    <Globe size={12} />
                    <span>Domain: <strong>{domain}</strong></span>
                  </div>
                )}

                <button
                  type="submit"
                  className="kb-card-btn primary"
                  disabled={!websiteUrl.trim() || submitting}
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span>{submitting ? 'Starting…' : 'Start Analysis'}</span>
                  {!submitting && <ArrowRight size={16} />}
                </button>
              </form>
            )}
          </div>

          {/* OPTION B: UPLOAD DOCUMENTS */}
          <div className="kb-entry-card">
            <div>
              <div className="kb-card-icon-box">
                <FileText size={24} />
              </div>
              <h3 className="kb-card-title">Upload documents</h3>
              <p className="kb-card-desc">
                Give Pearl your existing product documents, brochures and business information.
              </p>
            </div>

            {!showDocForm ? (
              <button
                type="button"
                className="kb-card-btn secondary"
                onClick={() => setShowDocForm(true)}
              >
                <span>Upload files</span>
                <UploadCloud size={16} />
              </button>
            ) : (
              <div className="kb-card-form">
                <label
                  className={`kb-dropzone ${isDragging ? 'dragging' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    chooseFiles(e.dataTransfer?.files);
                  }}
                >
                  <input
                    type="file"
                    multiple
                    accept={KNOWLEDGE_UPLOAD_ACCEPT}
                    className="sr-only"
                    disabled={submitting}
                    onChange={(e) => {
                      chooseFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <UploadCloud size={24} color="#71717a" style={{ margin: '0 auto 6px auto' }} />
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#09090b' }}>Click or drag files here</div>
                  <div style={{ fontSize: '0.74rem', color: '#71717a', marginTop: 2 }}>
                    {KNOWLEDGE_UPLOAD_LABEL} · up to 10 files, 20 MB each
                  </div>
                </label>

                {selectedFiles.length > 0 && (
                  <div className="kb-files-list">
                    {selectedFiles.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="kb-file-item">
                        <span className="kb-file-name">{file.name}</span>
                        <span style={{ color: '#71717a' }}>{formatBytes(file.size)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {fileCheck && !fileCheck.ok && (
                  <p className="kb-inline-error" role="alert">{fileCheck.error}</p>
                )}

                <button
                  type="button"
                  className="kb-card-btn primary"
                  disabled={selectedFiles.length === 0 || submitting || (fileCheck && !fileCheck.ok)}
                  onClick={handleUploadDocuments}
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span>{submitting ? 'Uploading…' : `Start Document Processing (${selectedFiles.length})`}</span>
                  {!submitting && <ArrowRight size={16} />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: DASHBOARD VIEW ─────────────────────────────────────────────────
  const stats = overviewData?.stats || {};
  const company = overviewData?.company_capsule || null;
  const products = overviewData?.product_capsules || [];
  const sources = overviewData?.sources || [];
  const facts = overviewData?.facts || [];
  const companyStatus = company ? capsuleStatusMeta(company.status) : null;
  const companyName = company?.company_name || company?.name || 'Company capsule';
  const buyerFacts = facts.filter((f) => f.category === 'business' || f.category === 'customer');
  const salesFacts = facts.filter((f) => f.category === 'sales');
  const totalFacts = Number(stats.total_facts) || facts.length;
  const factsTruncated = totalFacts > facts.length;
  const latestImport = formatServerDate(stats.last_synced_at);
  const latestSource = sources[0] || null;
  const runningSources = sources.filter((s) => sourceStatusMeta(s.status).running);
  const anyBusy = Boolean(busyAction);
  const sourceLine = latestSource
    ? (sources.length > 1
      ? `${sources.length} connected sources · latest: ${sourceDisplayName(latestSource)}`
      : `Connected to ${latestSource.url || sourceDisplayName(latestSource)}`)
    : 'No sources connected';
  const factsNote = factsTruncated ? `Showing the latest ${facts.length} of ${totalFacts} facts.` : null;
  const tabs = [
    { id: 'company', label: 'Company Capsule' },
    { id: 'products', label: `Product Capsules (${products.length})` },
    { id: 'customer', label: 'Buyer Intelligence' },
    { id: 'sales', label: 'Sales Objections' },
    { id: 'sources', label: `Connected Sources (${sources.length})` },
  ];

  return (
    <div className="kb-root animate-fade-in">
      <div className="kb-top-bar">
        <div className="kb-breadcrumb">
          <span>Pearl</span>
          <span>/</span>
          <span className="kb-breadcrumb-title">Knowledge Base</span>
        </div>
        <div className="kb-top-actions">
          <button
            type="button"
            className="kb-btn-mini"
            onClick={() => {
              setLandingNotice(null);
              setUploadError(null);
              setViewMode('landing');
            }}
          >
            <Plus size={13} style={{ display: 'inline', verticalAlign: -2 }} />
            <span>Add Source</span>
          </button>
          {company && (
            <button
              type="button"
              className="kb-card-btn primary"
              style={{ padding: '5px 12px', fontSize: '0.78rem', borderRadius: 6, width: 'auto' }}
              onClick={() => handlePublishCapsule(company, companyName)}
              disabled={anyBusy}
              title={`Publish the company capsule as version ${(company.version || 1) + 1}`}
            >
              {busyAction === `publish-${company.id}` ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              <span>Publish v{(company.version || 1) + 1}</span>
            </button>
          )}
          <button
            type="button"
            className="kb-btn-danger"
            onClick={() => openDialog('reset')}
            disabled={anyBusy}
            title="Permanently delete all sources, capsules and facts"
          >
            <Trash2 size={13} />
            <span>Delete All Knowledge</span>
          </button>
        </div>
      </div>

      <div className="kb-dashboard-wrap">
        {actionError && (
          <div className="kb-banner kb-banner-error" role="alert">
            <AlertCircle size={15} />
            <span>{actionError}</span>
            <button type="button" className="kb-banner-close" onClick={() => setActionError(null)} aria-label="Dismiss message">
              <X size={13} />
            </button>
          </div>
        )}
        {actionNotice && (
          <div className="kb-banner kb-banner-notice" role="status">
            <CheckCircle2 size={15} />
            <span>{actionNotice}</span>
            <button type="button" className="kb-banner-close" onClick={() => setActionNotice(null)} aria-label="Dismiss message">
              <X size={13} />
            </button>
          </div>
        )}
        {runningSources.length > 0 && (
          <div className="kb-banner kb-banner-running" role="status">
            <Loader2 size={15} className="animate-spin" />
            <span>
              Importing {runningSources.map((s) => sourceDisplayName(s)).join(', ')}. New capsules appear here when the import finishes.
            </span>
            <button type="button" className="kb-btn-mini" onClick={() => handleWatchSource(runningSources[0])}>
              View progress
            </button>
          </div>
        )}

        {/* Top Banner with Key Metrics */}
        <div className="kb-dash-banner">
          <div className="kb-dash-banner-text">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                {company?.company_name || 'Business Knowledge Base'}
              </h2>
              {companyStatus && (
                <span className={`kb-pill-badge ${companyStatus.className}`}>{companyStatus.label}</span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#71717a', overflowWrap: 'anywhere' }}>
              {sourceLine} • {latestImport ? `Latest import: ${latestImport}` : 'No imports yet'}
            </p>
          </div>

          <div className="kb-dash-metrics">
            <div className="kb-metric-item">
              <span className="kb-metric-val">{Number(stats.total_capsules) || 0}</span>
              <span className="kb-metric-label">Capsules</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{Number(stats.total_products ?? products.length) || 0}</span>
              <span className="kb-metric-label">Products</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{Number(stats.total_pages) || 0}</span>
              <span className="kb-metric-label">Pages Indexed</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{totalFacts}</span>
              <span className="kb-metric-label">Extracted Facts</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="kb-dash-tabs" role="tablist" aria-label="Knowledge base sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`kb-dash-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: COMPANY CAPSULE */}
        {activeTab === 'company' && (
          company ? (
            <div className="kb-section-card" role="tabpanel">
              <div className="kb-section-title-row">
                <div>
                  <h3 className="kb-section-title">Company-Wide Shared Context</h3>
                  <span style={{ fontSize: '0.78rem', color: '#71717a' }}>
                    Version {company.version || 1} • {companyStatus.label} • Shared with agents that use your product capsules
                  </span>
                </div>
                <button
                  type="button"
                  className="kb-btn-mini kb-btn-mini-danger"
                  onClick={() => openDialog('delete-capsule', { id: company.id, name: companyName })}
                  disabled={anyBusy}
                  title="Delete this company capsule"
                >
                  <Trash2 size={12} />
                  <span>Delete Company Capsule</span>
                </button>
              </div>

              <div className="kb-fact-row">
                <span className="kb-fact-field">Company Name</span>
                {renderFactValue(company.company_name)}
              </div>
              <div className="kb-fact-row">
                <span className="kb-fact-field">Brand Voice Tone</span>
                {renderFactValue(company.brand_tone)}
              </div>
              <div className="kb-fact-row">
                <span className="kb-fact-field">Business Overview</span>
                {renderFactValue(company.overview)}
              </div>
              <div className="kb-fact-row">
                <span className="kb-fact-field">Target Audience</span>
                {renderFactValue(company.target_audience)}
              </div>
              <div className="kb-fact-row">
                <span className="kb-fact-field">Key Differentiators</span>
                {renderFactValue(company.key_differentiators)}
              </div>
              <div className="kb-fact-row">
                <span className="kb-fact-field">Pain Points Solved</span>
                {renderFactValue(company.pain_points)}
              </div>
            </div>
          ) : (
            <div className="kb-section-card kb-empty-state" role="tabpanel">
              <p className="kb-empty-title">No company capsule yet</p>
              <p className="kb-empty-text">
                {runningSources.length
                  ? 'An import is still running — the company capsule appears here when it finishes.'
                  : 'Pearl creates it when it imports your website or documents.'}
              </p>
            </div>
          )
        )}

        {/* TAB 2: PRODUCT CAPSULES */}
        {activeTab === 'products' && (
          products.length ? (
            <div className="kb-prods-grid" role="tabpanel">
              {products.map((p) => {
                const name = p.product_name || p.name || 'Untitled product';
                const status = capsuleStatusMeta(p.status);
                return (
                  <div key={p.id} className="kb-prod-card">
                    <div>
                      <div className="kb-prod-header">
                        <h4 className="kb-prod-title">{name}</h4>
                        {p.price
                          ? <span className="kb-prod-price">{p.price}</span>
                          : <span className="kb-prod-price kb-muted-value">No price found</span>}
                      </div>
                      <div className={`kb-prod-specs ${p.specs ? '' : 'kb-muted-value'}`}>
                        {p.specs || 'No specifications extracted yet.'}
                      </div>
                    </div>

                    <div className="kb-prod-footer">
                      <span style={{ fontSize: '0.72rem', color: '#71717a', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        v{p.version || 1}
                        <span className={`kb-pill-badge ${status.className}`}>{status.label}</span>
                      </span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="kb-btn-mini"
                          onClick={() => handlePublishCapsule(p, name)}
                          disabled={anyBusy}
                          title={`Publish ${name} as version ${(p.version || 1) + 1}`}
                        >
                          {busyAction === `publish-${p.id}` ? 'Publishing…' : `Publish v${(p.version || 1) + 1}`}
                        </button>
                        <button
                          type="button"
                          className="kb-btn-mini kb-btn-mini-danger"
                          onClick={() => openDialog('delete-capsule', { id: p.id, name })}
                          disabled={anyBusy}
                          title="Delete this product capsule"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="kb-section-card kb-empty-state" role="tabpanel">
              <p className="kb-empty-title">No product capsules yet</p>
              <p className="kb-empty-text">Product capsules are created from the products and services Pearl finds in your sources.</p>
            </div>
          )
        )}

        {/* TAB 3: BUYER INTELLIGENCE */}
        {activeTab === 'customer' && (
          <div className="kb-section-card" role="tabpanel">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Customer & Buyer Intelligence</h3>
              <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Edit a fact to correct it — edits are marked “User confirmed”.</span>
            </div>
            {factsNote && <p className="kb-facts-note">{factsNote}</p>}

            {buyerFacts.length === 0 ? (
              <div className="kb-empty-state kb-empty-inline">
                <p className="kb-empty-title">No buyer facts yet</p>
                <p className="kb-empty-text">Facts about your business and customers appear here after an import.</p>
              </div>
            ) : buyerFacts.map((fact) => {
              const origin = factOriginMeta(fact.inference_type);
              const editing = editingFactId === fact.id;
              const busy = factBusyId === fact.id;
              return (
                <div key={fact.id} className="kb-fact-row">
                  <span className="kb-fact-field">{fact.field_name}</span>

                  {editing ? (
                    <div className="kb-fact-edit">
                      <textarea
                        className="kb-fact-textarea"
                        value={editFactValue}
                        onChange={(e) => setEditFactValue(e.target.value)}
                        rows={Math.min(8, Math.max(3, editFactValue.split('\n').length + 1))}
                        maxLength={3000}
                        aria-label={`Edit ${fact.field_name}`}
                        disabled={busy}
                        autoFocus
                      />
                      <div className="kb-fact-edit-actions">
                        <button type="button" className="kb-btn-mini" onClick={() => handleSaveFactEdit(fact.id)} disabled={busy}>
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="kb-btn-mini" onClick={cancelFactEdit} disabled={busy}>Cancel</button>
                      </div>
                      {factError?.id === fact.id && <p className="kb-inline-error" role="alert">{factError.message}</p>}
                    </div>
                  ) : (
                    <span className="kb-fact-value">{fact.value}</span>
                  )}

                  <div className="kb-fact-badges">
                    <span className={`kb-pill-badge ${origin.className}`}>{origin.label}</span>

                    {!editing && (
                      <button
                        type="button"
                        className="kb-btn-mini"
                        onClick={() => startFactEdit(fact)}
                        disabled={Boolean(factBusyId)}
                      >
                        Edit
                      </button>
                    )}

                    {fact.source_excerpt && (
                      <button
                        type="button"
                        className="kb-btn-mini"
                        onClick={() => setEvidenceFact(fact)}
                        title="Inspect evidence"
                        aria-label={`Inspect evidence for ${fact.field_name}`}
                      >
                        <Eye size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 4: SALES OBJECTIONS */}
        {activeTab === 'sales' && (
          <div className="kb-section-card" role="tabpanel">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Objection Handlers & Pivots</h3>
              <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Reject a handler to keep it out of your capsules.</span>
            </div>
            {factsNote && <p className="kb-facts-note">{factsNote}</p>}

            {salesFacts.length === 0 ? (
              <div className="kb-empty-state kb-empty-inline">
                <p className="kb-empty-title">No objection handlers yet</p>
                <p className="kb-empty-text">Objections Pearl finds in your sources are listed here after an import.</p>
              </div>
            ) : salesFacts.map((fact) => {
              const approval = approvalMeta(fact.approval_status);
              const busy = factBusyId === fact.id;
              return (
                <div key={fact.id} className="kb-fact-row">
                  <span className="kb-fact-field">{fact.field_name}</span>
                  <span className="kb-fact-value">{fact.value}</span>
                  <div className="kb-fact-badges">
                    <span className={`kb-pill-badge ${approval.className}`}>{approval.label}</span>
                    <button
                      type="button"
                      className="kb-btn-mini"
                      onClick={() => handleToggleFactApproval(fact)}
                      disabled={busy || Boolean(factBusyId)}
                    >
                      {busy ? 'Saving…' : approval.action}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 5: CONNECTED SOURCES */}
        {activeTab === 'sources' && (
          <div className="kb-section-card" role="tabpanel">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Connected Ingestion Sources</h3>
              <button
                type="button"
                className="kb-btn-mini"
                onClick={() => {
                  setLandingNotice(null);
                  setUploadError(null);
                  setViewMode('landing');
                }}
              >
                + Connect Another Source
              </button>
            </div>

            {sources.length === 0 ? (
              <div className="kb-empty-state kb-empty-inline">
                <p className="kb-empty-title">No sources connected</p>
                <p className="kb-empty-text">Import your website or upload documents to build your knowledge base.</p>
              </div>
            ) : sources.map((s) => {
              const status = sourceStatusMeta(s.status);
              const failure = sourceFailure(s);
              const isDoc = s.type === 'document';
              const processed = Number(s.pages_processed) || 0;
              const discovered = Number(s.pages_discovered) || 0;
              const counts = isDoc
                ? `${processed} of ${plural(discovered, 'file')} read`
                : `${processed} of ${plural(discovered, 'page')} indexed`;
              const added = formatServerDate(s.created_at);
              return (
                <div key={s.id} className="kb-fact-row kb-source-row">
                  <span className="kb-fact-field" style={{ textTransform: 'uppercase' }}>{s.type}</span>
                  <div className="kb-source-main">
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{s.title || sourceDisplayName(s)}</div>
                    <div className="kb-source-meta">
                      {isHttpUrl(s.url) ? (
                        <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                      ) : (
                        <span>Uploaded documents</span>
                      )}
                      <span> • {counts}</span>
                      {added && <span> • Added {added}</span>}
                    </div>
                    {failure && (
                      <div className="kb-source-hint failed">{failure.hint}</div>
                    )}
                    {failure?.detail && (
                      <div className="kb-source-error">{failure.detail}</div>
                    )}
                    {status.running && (
                      <div className="kb-source-hint running">Import in progress.</div>
                    )}
                  </div>
                  <div className="kb-fact-badges">
                    <span className={`kb-pill-badge ${status.className}`}>{failure?.label || status.label}</span>
                    {status.running && (
                      <button type="button" className="kb-btn-mini" onClick={() => handleWatchSource(s)}>
                        View progress
                      </button>
                    )}
                    {status.running && (
                      <button
                        type="button"
                        className="kb-btn-mini"
                        onClick={() => openDialog('cancel-source', { source: s })}
                        disabled={anyBusy}
                        title="Cancel this import; the source and what it has read so far are kept"
                      >
                        Cancel import
                      </button>
                    )}
                    {status.failed && !isDoc && s.url && (
                      <button
                        type="button"
                        className="kb-btn-mini"
                        onClick={() => handleRetrySource(s)}
                        disabled={anyBusy}
                      >
                        {busyAction === `retry-${s.id}` ? 'Starting…' : 'Re-sync'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="kb-btn-mini kb-btn-mini-danger"
                      onClick={() => openDialog('delete-source', { source: s, capsules: capsulesFromSource(overviewData, s) })}
                      disabled={anyBusy}
                      title="Delete this source and the capsules created from it"
                    >
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* EVIDENCE INSPECTION DIALOG */}
      {evidenceFact && <EvidenceDialog fact={evidenceFact} onClose={() => setEvidenceFact(null)} />}
      {renderDialog()}
    </div>
  );
};

export default KnowledgeBaseView;
