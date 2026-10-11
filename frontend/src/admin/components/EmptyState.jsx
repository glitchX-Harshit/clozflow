import { Database, Inbox } from 'lucide-react';

export default function EmptyState({
  title = "No data recorded",
  description = "No records exist for the selected filters or time period. All metrics represent genuine database rows.",
  icon: Icon = Database
}) {
  return (
    <div className="admin-empty-state">
      <div style={{
        width: '42px',
        height: '42px',
        borderRadius: '10px',
        backgroundColor: 'var(--admin-surface-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--admin-text-muted)',
        border: '1px solid var(--admin-border-subtle)',
        marginBottom: '6px'
      }}>
        <Icon size={20} />
      </div>
      <h3 className="admin-empty-title">{title}</h3>
      <p className="admin-empty-desc">{description}</p>
    </div>
  );
}
