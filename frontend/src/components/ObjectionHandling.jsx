import './ObjectionHandling.css';

const OBJECTIONS = [
    { type: 'warning', label: '💰 Budget Concern', text: '"$5,000 is way over what we allocated for this quarter."', footer: 'High-probability objection' },
    { type: 'danger',  label: '🧩 Complexity Risk', text: '"We tried another AI tool last year and it was impossible to onboard."', footer: 'Onboarding focus needed' },
    { type: 'error',   label: '🔗 Integration Gap', text: '"If this doesn\'t sync with HubSpot, it\'s a non-starter."', footer: 'Native integration available' },
];

const ObjectionHandling = () => (
    <section className="obj__section" id="objections">
        <div className="container">
            <div className="obj__header">
                <span className="eyebrow eyebrow-accent">Objection Handling</span>
                <h2 className="section-title">
                    Surface hidden friction<br />
                    <span className="italic-accent">before you lose the deal.</span>
                </h2>
                <p className="obj__header-sub">
                    hexagon.ai detects subtle tonality shifts and hesitation patterns,
                    alerting you to objections the second they surface.
                </p>
            </div>

            <div className="obj__cards">
                {OBJECTIONS.map((o, i) => (
                    <div key={i} className={`obj__card ${o.type}`}>
                        <div className="obj__card-tag">{o.label}</div>
                        <p>{o.text}</p>
                        <div className="obj__card-foot">{o.footer}</div>
                    </div>
                ))}
            </div>
        </div>
    </section>
);

export default ObjectionHandling;
