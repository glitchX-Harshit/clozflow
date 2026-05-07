import { Zap } from 'lucide-react';
import MagButton from './MagButton';
import './ResponseSuggestion.css';

const ResponseSuggestion = () => (
    <section className="resp__section" id="response">
        <div className="container">
            <div className="resp__layout">
                <div className="resp__text">
                    <span className="eyebrow eyebrow-accent">AI Response Engine</span>
                    <h2 className="section-title">
                        The perfect<br />
                        <span className="italic-accent">answer. Always.</span>
                    </h2>
                    <p className="resp__desc">
                        Never be caught off-guard. Hexagon surfaces the ideal
                        rebuttal in under 200ms — tested across millions of 
                        high-stakes conversations.
                    </p>
                    <MagButton label="See it in action" variant="dark" magnetStrength={0.35} />
                </div>

                <div className="resp__visual">
                    <div className="resp__card">
                        <div className="resp__card-label">Prospect Objection</div>
                        <p>"We already have a solution in place for this. Switching costs are going to be a nightmare."</p>
                    </div>
                    <div className="resp__card resp__card--primary">
                        <div className="resp__card-label resp__card-label--accent">
                            <Zap size={11} />
                            Hexagon rebuttal · confidence 97%
                        </div>
                        <p>
                            "Switching costs are a real concern — I respect that. We actually offer a white-glove 
                            migration service that most clients complete in under 48 hours. Can I walk you through 
                            how we handled it for [similar company]?"
                        </p>
                        <div className="resp__card-foot">Strategy: Empathize → Diffuse → Redirect</div>
                    </div>
                </div>
            </div>
        </div>
    </section>
);

export default ResponseSuggestion;
