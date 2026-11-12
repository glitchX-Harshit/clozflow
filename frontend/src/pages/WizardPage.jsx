import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    BookOpen,
    CalendarDays,
    ChevronRight,
    Clock,
    Mic,
    Phone,
    Plus,
    Radio,
    Settings,
    Sparkles,
    Video,
} from 'lucide-react';
import useCopilotStore from '../store/copilotStore';
import { openCopilotWindow } from '../utils/copilotWindow';
import { dayAndMonth, formatServerTime } from '../lib/dates';
import { errorMessage } from '../lib/apiFetch';
import {
    createMeeting,
    getHome,
    getPreflight,
    isWizardUnavailable,
    listRecentCalls,
    relativeStart,
    startsAround,
} from '../lib/wizardApi';
import { useAsyncData, useVisiblePolling } from './wizard/useAsyncData';
import { EmptyState, ErrorState, OutcomePill, Pill, SectionCard, Spinner, StatRow, StatusPill } from './wizard/wizardUi';
import WizardShell from './wizard/WizardShell';
import './WizardPage.css';

const PLATFORM_ICON = { meet: Video, zoom: Video, teams: Video, phone: Phone, in_person: Mic };

/** Truthful pre-flight line: what the server can actually do right now. */
function PreflightChips({ preflight }) {
    if (!preflight) return null;
    const { stt, coach, bridge } = preflight;
    return (
        <div className="wz-preflight-chips" aria-label="Server status">
            <Pill tone={stt.ready ? 'good' : 'bad'} title={stt.model ? `Model: ${stt.model}` : undefined}>
                Speech: {stt.ready ? `${stt.vendor || 'ready'}` : 'not configured'}
            </Pill>
            <Pill tone={coach.ready ? 'good' : 'warn'} title={coach.model ? `Model: ${coach.model}` : undefined}>
                Coach: {coach.ready ? 'ready' : 'offline (classic tips only)'}
            </Pill>
            <Pill tone={bridge.enabled ? 'good' : 'muted'} title={bridge.reason || undefined}>
                Phone bridge: {bridge.enabled ? `on${bridge.rate_per_minute ? ` · ₹${bridge.rate_per_minute}/min` : ''}` : 'off'}
            </Pill>
        </div>
    );
}

function EventRow({ event, onPrepare, preparing, onOpen }) {
    const Icon = PLATFORM_ICON[event.platform] || CalendarDays;
    const linked = event.meeting || event.meeting_id;
    const names = event.attendees.map((a) => a.name || a.email).filter(Boolean).slice(0, 3).join(', ');
    return (
        <li className="wz-row">
            <div className="wz-row__time">
                <span className="wz-row__clock">{formatServerTime(event.start, '—')}</span>
                <span className="wz-row__rel">{relativeStart(event.start)}</span>
            </div>
            <div className="wz-row__body">
                <div className="wz-row__title"><Icon size={14} aria-hidden="true" /> {event.title}</div>
                <div className="wz-row__sub">
                    {names || 'No attendees listed'}
                    {event.meeting && <> · <StatusPill status={event.meeting.status} /></>}
                </div>
            </div>
            <div className="wz-row__actions">
                {linked ? (
                    <button type="button" className="wz-btn wz-btn--sm" onClick={() => onOpen(event.meeting?.id || event.meeting_id)}>
                        {event.meeting?.status === 'ready' ? 'Open brief' : 'Open'} <ChevronRight size={14} aria-hidden="true" />
                    </button>
                ) : (
                    <button type="button" className="wz-btn wz-btn--primary wz-btn--sm" onClick={() => onPrepare(event)} disabled={preparing === event.id} aria-busy={preparing === event.id}>
                        {preparing === event.id ? 'Preparing…' : 'Prepare'}
                    </button>
                )}
            </div>
        </li>
    );
}

function MeetingRow({ meeting, onOpen, action = 'Open brief' }) {
    const { day, month } = dayAndMonth(meeting.scheduled_start || meeting.started_at || meeting.created_at);
    return (
        <li className="wz-row">
            <div className="wz-session-date-col"><span className="wz-s-day">{day}</span><span className="wz-s-mo">{month}</span></div>
            <div className="wz-row__body">
                <div className="wz-row__title">{meeting.title}</div>
                <div className="wz-row__sub">
                    {[meeting.prospect_name, meeting.company].filter(Boolean).join(' · ') || '—'}
                    {' · '}<StatusPill status={meeting.status} />
                    {meeting.outcome && <> <OutcomePill outcome={meeting.outcome} /></>}
                </div>
                {meeting.debrief_summary && <p className="wz-row__summary">{meeting.debrief_summary}</p>}
            </div>
            <div className="wz-row__actions">
                <button type="button" className="wz-btn wz-btn--sm" onClick={() => onOpen(meeting)}>{action} <ChevronRight size={14} aria-hidden="true" /></button>
            </div>
        </li>
    );
}

function WizardHome() {
    const navigate = useNavigate();
    const [preparing, setPreparing] = useState(null);
    const [actionError, setActionError] = useState(null);

    const loadHome = useCallback(() => getHome(), []);
    const home = useAsyncData(loadHome);
    const loadPreflight = useCallback(() => getPreflight().catch(() => null), []);
    const preflight = useAsyncData(loadPreflight);
    const unavailable = isWizardUnavailable(home.error);
    const loadLegacy = useCallback(() => listRecentCalls(6), []);
    const legacy = useAsyncData(loadLegacy, { enabled: unavailable });

    const { reload: reloadHome } = home;
    const silentReload = useCallback(() => reloadHome({ silent: true }), [reloadHome]);
    useVisiblePolling(silentReload, 60000, home.ready);

    const data = home.data;
    const startingNow = data?.today.find((e) => startsAround(e.start)) || null;

    const openBrief = (id) => navigate(`/wizard/meetings/${encodeURIComponent(id)}`);
    const openDebrief = (meeting) => {
        if (meeting.status === 'ended' || meeting.status === 'debriefed') navigate(`/summary?meeting=${encodeURIComponent(meeting.id)}`);
        else openBrief(meeting.id);
    };

    const prepare = async (event) => {
        setActionError(null);
        setPreparing(event.id);
        try {
            const meeting = await createMeeting({ calendar_event_id: event.id });
            if (!meeting?.id) throw new Error('No meeting returned');
            openBrief(meeting.id);
        } catch (err) {
            setActionError(errorMessage(err, 'Could not prepare this meeting.'));
            setPreparing(null);
        }
    };

    const rejoin = async (live) => {
        if (!live?.context_id) {
            openBrief(live.id);
            return;
        }
        let refs = null;
        try {
            refs = await openCopilotWindow();
        } catch {
            // Popup blocked — the Live Call page offers "Pop out".
        }
        if (refs) useCopilotStore.getState().setExternalRefs(refs.win, refs.container);
        navigate('/live-call', {
            state: {
                contextId: live.context_id,
                meetingId: live.id,
                channel: live.channel,
                intensity: live.coaching_intensity,
                consentMode: live.consent?.mode || null,
                consentScript: preflight.data?.consent_script,
                meeting: { title: live.title, prospect_name: live.prospect_name, company: live.company },
                briefCards: live.brief?.pre_rendered_cards || [],
            },
        });
    };

    const stats = data ? [
        { label: 'Meetings · 30 days', value: data.stats.meetings_30d ?? '—' },
        { label: 'Dated next step', value: data.stats.next_step_rate === null ? '—' : `${Math.round(data.stats.next_step_rate * 100)}%`, note: 'of debriefed meetings' },
        { label: 'Your talk share', value: data.stats.avg_talk_ratio === null ? '—' : `${Math.round(data.stats.avg_talk_ratio * 100)}%`, note: 'won calls: 43–60 %' },
    ] : [];

    const isEmpty = data && !data.live && data.today.length === 0 && data.upcoming.length === 0 && data.recent.length === 0;

    return (
        <>
            <header className="wz-header">
                <div className="wz-header-left">
                    <div className="wz-badge-row">
                        <span className="wz-badge-glow"><Sparkles size={13} aria-hidden="true" /> Meeting copilot</span>
                        {home.refreshing && <span className="wz-refreshing" role="status">Refreshing…</span>}
                    </div>
                    <h1 className="wz-title">Meeting Wizard<span className="wz-title-period">.</span></h1>
                    <p className="wz-subtitle">
                        Know the meeting before it starts, get one spoken line when it matters, and leave with the debrief written.
                    </p>
                    <PreflightChips preflight={preflight.data} />
                </div>
                <div className="wz-header-actions">
                    <button type="button" className="wz-btn wz-btn--primary" onClick={() => navigate('/wizard/new')}>
                        <Plus size={16} aria-hidden="true" /> New meeting
                    </button>
                    <button type="button" className="wz-btn" onClick={() => navigate('/wizard/battlecards')}>
                        <BookOpen size={15} aria-hidden="true" /> Battlecards
                    </button>
                    <button type="button" className="wz-btn wz-btn--ghost" onClick={() => navigate('/wizard/settings')} aria-label="Wizard settings">
                        <Settings size={15} aria-hidden="true" /> Settings
                    </button>
                </div>
            </header>

            {actionError && <div className="wz-alert-banner" role="alert">{actionError}</div>}

            {home.loading && <Spinner label="Loading your meetings…" />}

            {home.error && !home.loading && (
                <ErrorState error={home.error} onRetry={() => home.reload()}>
                    {unavailable && <span className="wz-error__hint">You can still browse past sessions below; the full Wizard appears once the server is updated.</span>}
                </ErrorState>
            )}

            {unavailable && legacy.data && legacy.data.length > 0 && (
                <SectionCard title="Recent sessions" desc="From the classic copilot" className="wz-card--flat">
                    <ul className="wz-list">
                        {legacy.data.map((session) => {
                            const { day, month } = dayAndMonth(session.timestamp);
                            return (
                                <li key={session.id} className="wz-row">
                                    <div className="wz-session-date-col"><span className="wz-s-day">{day}</span><span className="wz-s-mo">{month}</span></div>
                                    <div className="wz-row__body">
                                        <div className="wz-row__title">Meeting #{session.id}</div>
                                        <div className="wz-row__sub">{session.message_count || 0} turns · {session.insight_count || 0} suggestions</div>
                                    </div>
                                    <div className="wz-row__actions">
                                        <button type="button" className="wz-btn wz-btn--sm" onClick={() => navigate('/summary', { state: { callId: session.id } })}>Open <ChevronRight size={14} aria-hidden="true" /></button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </SectionCard>
            )}

            {data && (
                <>
                    {data.live && (
                        <div className="wz-live-banner" role="status">
                            <span className="wz-live-banner__dot" aria-hidden="true" />
                            <div className="wz-live-banner__text">
                                <strong>Live now: {data.live.title}</strong>
                                <span>{[data.live.prospect_name, data.live.company].filter(Boolean).join(' · ')}</span>
                            </div>
                            <button type="button" className="wz-btn wz-btn--primary" onClick={() => rejoin(data.live)}>
                                <Radio size={15} aria-hidden="true" /> Rejoin
                            </button>
                        </div>
                    )}

                    {startingNow && !data.live && (
                        <div className="wz-soon-banner" role="status">
                            <Clock size={18} aria-hidden="true" />
                            <div className="wz-live-banner__text">
                                <strong>Starting {relativeStart(startingNow.start)}: {startingNow.title}</strong>
                                <span>{startingNow.meeting ? 'Your brief is ready.' : 'Prepare a brief in a few seconds, then launch.'}</span>
                            </div>
                            {startingNow.meeting || startingNow.meeting_id ? (
                                <button type="button" className="wz-btn wz-btn--primary" onClick={() => openBrief(startingNow.meeting?.id || startingNow.meeting_id)}>
                                    Open brief <ArrowRight size={15} aria-hidden="true" />
                                </button>
                            ) : (
                                <button type="button" className="wz-btn wz-btn--primary" onClick={() => prepare(startingNow)} disabled={preparing === startingNow.id}>
                                    {preparing === startingNow.id ? 'Preparing…' : 'Prepare now'}
                                </button>
                            )}
                        </div>
                    )}

                    {isEmpty ? (
                        <SectionCard className="wz-card--flat">
                            <EmptyState icon={CalendarDays} title="Nothing on the board yet" text="Connect your calendar's ICS link to see today's meetings here, or start an ad-hoc meeting right now.">
                                <button type="button" className="wz-btn wz-btn--primary" onClick={() => navigate('/wizard/new')}><Plus size={15} aria-hidden="true" /> New meeting</button>
                                <button type="button" className="wz-btn" onClick={() => navigate('/wizard/settings')}><CalendarDays size={15} aria-hidden="true" /> Connect calendar</button>
                            </EmptyState>
                        </SectionCard>
                    ) : (
                        <div className="wz-main-grid">
                            <div className="wz-config-column">
                                <SectionCard title="Today" desc={data.today.length ? `${data.today.length} on your calendar` : 'Nothing scheduled today'} actions={
                                    <button type="button" className="wz-btn wz-btn--ghost wz-btn--sm" onClick={() => navigate('/wizard/new')}><Plus size={13} aria-hidden="true" /> Ad-hoc</button>
                                }>
                                    {data.today.length ? (
                                        <ul className="wz-list">
                                            {data.today.map((event) => (
                                                <EventRow key={event.id} event={event} onPrepare={prepare} preparing={preparing} onOpen={openBrief} />
                                            ))}
                                        </ul>
                                    ) : (
                                        <EmptyState text="Connect a calendar in Settings to see meetings here, or create one with New meeting." />
                                    )}
                                </SectionCard>

                                <SectionCard title="Upcoming" desc="Prepared meetings waiting to be launched">
                                    {data.upcoming.length ? (
                                        <ul className="wz-list">
                                            {data.upcoming.map((m) => <MeetingRow key={m.id} meeting={m} onOpen={(mm) => openBrief(mm.id)} />)}
                                        </ul>
                                    ) : (
                                        <EmptyState text="No upcoming meetings prepared yet." />
                                    )}
                                </SectionCard>
                            </div>

                            <div className="wz-intel-column">
                                <SectionCard title="Last 30 days">
                                    <StatRow stats={stats} />
                                </SectionCard>
                                <SectionCard title="Recent" desc="Debriefs and outcomes">
                                    {data.recent.length ? (
                                        <ul className="wz-list">
                                            {data.recent.map((m) => <MeetingRow key={m.id} meeting={m} onOpen={openDebrief} action="Debrief" />)}
                                        </ul>
                                    ) : (
                                        <EmptyState text="Your debriefs will appear here after the first meeting." />
                                    )}
                                </SectionCard>
                            </div>
                        </div>
                    )}
                </>
            )}
        </>
    );
}

/**
 * Meeting Wizard home. Rendered inside the dashboard's Wizard tab (default) and
 * as the stand-alone `/wizard` route (`standalone`), where it gets the shell.
 */
export default function WizardPage({ standalone = false }) {
    if (standalone) {
        return <WizardShell><WizardHome /></WizardShell>;
    }
    return (
        <div className="wz-page-container animate-fade-in" data-lenis-prevent="true">
            <WizardHome />
        </div>
    );
}
