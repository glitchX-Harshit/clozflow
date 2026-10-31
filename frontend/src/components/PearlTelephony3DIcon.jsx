import React from 'react';
import { PhoneCall, Network } from 'lucide-react';

/**
 * Minimal, lightweight icon nodes for Telephony Cards.
 * Replaces heavy WebGL fluid shaders with crisp, high-performance SaaS icons.
 */

export const ClozFlowTelephonyNode = () => {
  return (
    <div className="phone-minimal-icon-badge theme-copper" aria-label="ClozFlow Managed Telephony">
      <PhoneCall size={22} strokeWidth={2} className="phone-badge-svg" />
    </div>
  );
};

export const BringYourOwnTrunkNode = () => {
  return (
    <div className="phone-minimal-icon-badge theme-emerald" aria-label="Bring Your Own Telephony">
      <Network size={22} strokeWidth={2} className="phone-badge-svg" />
    </div>
  );
};

export default ClozFlowTelephonyNode;
