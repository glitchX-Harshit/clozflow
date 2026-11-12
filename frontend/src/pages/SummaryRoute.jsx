import { useSearchParams } from 'react-router-dom';
import DebriefPage from './DebriefPage';
import PostCallSummary from './PostCallSummary';

/**
 * `/summary?meeting=<id>` opens the Meeting Wizard debrief; `/summary` without
 * the parameter keeps the legacy post-call summary (old calls, Call Briefing flow).
 */
export default function SummaryRoute() {
    const [params] = useSearchParams();
    const meetingId = params.get('meeting');
    if (meetingId) return <DebriefPage key={meetingId} meetingId={meetingId} />;
    return <PostCallSummary />;
}
