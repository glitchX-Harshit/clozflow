import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';

export default function KPICard({
  label,
  value,
  prefix = '',
  suffix = '',
  percentageChange = null,
  previousPeriodValue = null,
  footnote = '',
  to = null,
  icon: Icon = null
}) {
  const isPositive = percentageChange !== null && percentageChange > 0;
  const isNegative = percentageChange !== null && percentageChange < 0;

  const content = (
    <div className="admin-kpi-card">
      <div className="admin-kpi-card-header">
        <span className="admin-kpi-label">{label}</span>
        {Icon && <Icon size={16} className="admin-kpi-icon" />}
      </div>

      <div className="admin-kpi-value-box">
        <span className="admin-kpi-value">
          {prefix}{typeof value === 'number' ? value.toLocaleString() : (value || '0')}{suffix}
        </span>
      </div>

      <div className="admin-kpi-footer">
        {percentageChange !== null ? (
          <span className={`admin-pill ${isPositive ? 'admin-pill-up' : isNegative ? 'admin-pill-down' : 'admin-pill-neutral'}`}>
            {isPositive ? <TrendingUp size={12} /> : isNegative ? <TrendingDown size={12} /> : <Minus size={12} />}
            {Math.abs(percentageChange)}% vs prev
          </span>
        ) : (
          <span>{footnote || 'Current period'}</span>
        )}

        {to && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--admin-accent)', fontSize: '11px', fontWeight: 600 }}>
            View records <ArrowRight size={12} />
          </span>
        )}
      </div>
    </div>
  );

  if (to) {
    return <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{content}</Link>;
  }

  return content;
}
