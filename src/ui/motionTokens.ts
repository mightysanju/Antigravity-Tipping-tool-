export const MOTION = {
  easeOutEnter: [0.16, 1, 0.3, 1] as const,
  easeInExit: [0.4, 0, 1, 1] as const,
  springSnappy: { type: 'spring' as const, stiffness: 400, damping: 30 },
  springLayout: { type: 'spring' as const, stiffness: 500, damping: 40 },
  tapScale: 0.96,
  hoverScale: 1.02,
  fadeReduced: { duration: 0.15, ease: 'easeOut' as const },
};
