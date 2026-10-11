export default function StatusBadge({ status, type = 'status' }) {
  if (!status) return <span className="admin-badge admin-badge-canceled">—</span>;
  
  const s = String(status).toLowerCase();
  let badgeClass = 'admin-badge-canceled';

  if (s === 'active' || s === 'succeeded' || s === 'completed' || s === 'paid') {
    badgeClass = 'admin-badge-active';
  } else if (s === 'failed' || s === 'suspended' || s === 'deactivated' || s === 'cancelled') {
    badgeClass = 'admin-badge-failed';
  } else if (s === 'past_due' || s === 'trialing' || s === 'pending' || s === 'partially_refunded') {
    badgeClass = 'admin-badge-past_due';
  } else if (s === 'super_admin') {
    badgeClass = 'admin-badge-super_admin';
  } else if (s === 'admin') {
    badgeClass = 'admin-badge-admin';
  }

  return (
    <span className={`admin-badge ${badgeClass}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
