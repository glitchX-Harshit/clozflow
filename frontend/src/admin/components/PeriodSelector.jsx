export default function PeriodSelector({ selectedPeriod, onChange }) {
  const periods = [
    { id: '7d', label: '7D' },
    { id: '30d', label: '30D' },
    { id: '90d', label: '90D' },
    { id: '12m', label: '12M' },
  ];

  return (
    <div className="admin-period-selector">
      {periods.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={`admin-period-btn ${selectedPeriod === p.id ? 'active' : ''}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
