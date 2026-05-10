import MagButton from './MagButton';
import './Integrations.css';

const APPS = [
    { name: 'Salesforce', color: '#00A1E0' },
    { name: 'HubSpot', color: '#FF7A59' },
    { name: 'Zoom', color: '#2D8CFF' },
    { name: 'Slack', color: '#4A154B' },
    { name: 'Notion', color: '#0a0a0a' },
    { name: 'Google Meet', color: '#00A651' },
    { name: 'Pipedrive', color: '#0F9E52' },
    { name: 'Outreach', color: '#2B5990' },
    { name: 'Gong', color: '#E85535' },
    { name: 'MS Teams', color: '#6264A7' },
    { name: 'Chorus', color: '#161C2D' },
    { name: 'LinkedIn', color: '#0A66C2' },
];

const Integrations = () => (
    <section className="int__section" id="integrations">
        <div className="container">
            <div className="int__layout">
                <div className="int__text">
                    <span className="eyebrow eyebrow-accent">Integrations</span>
                    <h2 className="section-title int__title">
                        Plugs into<br />
                        <span className="italic-accent">your stack.</span>
                    </h2>
                    <p className="int__desc">
                        The intelligence layer is platform agnostic. Hexagon connects 
                        natively with the environments where your conversations happen.
                    </p>
                    <MagButton label="See all integrations" variant="dark" magnetStrength={0.35} />
                </div>

                <div className="int__cloud">
                    {APPS.map(app => (
                        <div
                            key={app.name}
                            className="int__pill"
                            style={{ '--app-color': app.color }}
                        >
                            <span className="int__pill-dot" />
                            {app.name}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    </section>
);

export default Integrations;
