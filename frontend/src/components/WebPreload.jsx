import React from 'react';
import FramerAnimationLoader from './FramerAnimationLoader';

/**
 * WebPreload component replacing legacy preloader with Framer's Animation Loader
 * Component URL: https://framer.com/m/Animation-loader-eHagKV.js@ijRh61gfd3rmanud1uxr
 */
export default function WebPreload({ onComplete }) {
  return (
    <FramerAnimationLoader
      brandName="clozflow®"
      counterDuration={2.6}
      textColor="#0a0a0a"
      background="#ffffff"
      onComplete={onComplete}
    />
  );
}
