import { Zap } from 'lucide-react';
import MagButton from './MagButton';
import './ResponseSuggestion.css';

const ResponseSuggestion = () => (
    <section className="resp__section" id="response">
        <div className="container">
            <div className="resp__layout">
                <div className="resp__text">
                    <span className="eyebrow eyebrow-accent">Strategic Guidance</span>
                    <h2 className="section-title">
                        Strategic responses designed for<br />
                        <span className="italic-accent">emotionally complex moments.</span>
                    </h2>
                    <p className="resp__desc">
                        Sales conversations break when confidence disappears. Hexagon 
                        provides the psychological response frameworks needed to 
                        maintain momentum in high‑stakes moments.
                    </p>
                    <MagButton label="See the Intelligence Layer" variant="dark" magnetStrength={0.35} />
                </div>

                <div className="resp__visual">
                    <div className="resp__card">
                        <div className="resp__card-label">Prospect Objection</div>
                        <p>"We already have a solution in place for this. Switching costs are going to be a nightmare."</p>
                    </div>
                    <div className="resp__card resp__card--primary">
                        <div className="resp__card-label resp__card-label--accent">
                            <Zap size={11} />
                            Hexagon rebuttal · confidence 98%
                        </div>
                        <p>
                            "Switching costs are a real concern — I respect that. We actually offer a white-glove 
                            migration service that most clients complete in under 48 hours. Can I walk you through 
                            how we handled it for [similar company]?"
                        </p>
                        <div className="resp__card-foot">Strategy: Psychological Reframing</div>
                    </div>
                </div>
            </div>
        </div>
    </section>
);

export default ResponseSuggestion;
