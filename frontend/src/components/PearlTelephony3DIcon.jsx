import React from 'react';
import { PhoneCall, Network } from 'lucide-react';

/**
 * Minimal, lightweight icon nodes for Telephony Cards.
 * Replaces heavy WebGL fluid shaders with crisp, high-performance SaaS icons.
 */

export const ClozFlowTelephonyNode = () => {
  return (
    <div className="phone-minimal-icon-badge theme-copper" role="img" aria-label="ClozFlow managed telephony">
      <PhoneCall size={22} strokeWidth={2} className="phone-badge-svg" aria-hidden="true" />
    </div>
  );
};

export const BringYourOwnTrunkNode = () => {
  return (
    <div className="phone-minimal-icon-badge theme-emerald" role="img" aria-label="Bring your own telephony">
      <Network size={22} strokeWidth={2} className="phone-badge-svg" aria-hidden="true" />
    </div>
  );
};

export default ClozFlowTelephonyNode;
