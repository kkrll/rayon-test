// The Nokia N97 mini as a list of parts: every material primitive of the
// source model is one part. Finishes reproduce the model's own materials
// (colours are linear RGB, as glTF stores them) plus the alternatives tried
// during colour, material and finish (CMF) exploration.

export const DEVICE_MODEL_URL = '/models/nokia-n97-mini/nokia-n97-mini.glb';

export interface Finish {
  name: string;
  color: [number, number, number];
  metalness: number;
  roughness: number;
  emissive?: [number, number, number];
}

export const FINISHES = {
  'recess-rubber': { name: 'Deep recess / rubber', color: [0.005, 0.007, 0.009], metalness: 0, roughness: 0.65 },
  'polymer-charcoal': { name: 'Charcoal molded polymer', color: [0.024, 0.026, 0.028], metalness: 0, roughness: 0.46 },
  'polymer-white': { name: 'White molded polymer', color: [0.72, 0.72, 0.69], metalness: 0, roughness: 0.42 },
  'polymer-red': { name: 'Red molded polymer', color: [0.42, 0.028, 0.03], metalness: 0, roughness: 0.4 },
  'chestnut-satin': { name: 'Satin chestnut', color: [0.15, 0.115, 0.095], metalness: 0.45, roughness: 0.48 },
  'silver-satin': { name: 'Satin silver', color: [0.5, 0.5, 0.5], metalness: 0.6, roughness: 0.45 },
  'graphite-satin': { name: 'Satin graphite', color: [0.06, 0.065, 0.07], metalness: 0.5, roughness: 0.45 },
  'deck-charcoal': { name: 'Charcoal satin deck', color: [0.041, 0.044, 0.045], metalness: 0.12, roughness: 0.44 },
  'deck-white': { name: 'White satin deck', color: [0.66, 0.66, 0.64], metalness: 0.05, roughness: 0.45 },
  'chestnut-steel': { name: 'Chestnut stainless steel', color: [0.285, 0.235, 0.205], metalness: 0.9, roughness: 0.32 },
  'silver-steel': { name: 'Brushed stainless steel', color: [0.6, 0.6, 0.6], metalness: 0.9, roughness: 0.3 },
  'graphite-steel': { name: 'Graphite stainless steel', color: [0.09, 0.09, 0.1], metalness: 0.9, roughness: 0.32 },
  'champagne-steel': { name: 'Satin champagne steel', color: [0.42, 0.365, 0.31], metalness: 0.9, roughness: 0.34 },
  'polished-perimeter': { name: 'Warm polished stainless', color: [0.52, 0.47, 0.4], metalness: 0.95, roughness: 0.22 },
  'polished-silver': { name: 'Polished stainless', color: [0.72, 0.72, 0.72], metalness: 0.95, roughness: 0.2 },
  'polished-graphite': { name: 'Polished graphite', color: [0.12, 0.12, 0.13], metalness: 0.95, roughness: 0.22 },
  'keycaps-black': { name: 'Soft black keycaps', color: [0.033, 0.036, 0.037], metalness: 0, roughness: 0.48 },
  'keycaps-white': { name: 'Soft white keycaps', color: [0.78, 0.78, 0.76], metalness: 0, roughness: 0.45 },
  'printing-white': { name: 'Warm white printing', color: [0.62, 0.66, 0.6], metalness: 0, roughness: 0.48 },
  'printing-black': { name: 'Black printing', color: [0.02, 0.02, 0.022], metalness: 0, roughness: 0.48 },
  'amber-legends': { name: 'Amber legends', color: [0.56, 0.235, 0.05], metalness: 0, roughness: 0.48 },
  'logo-laser': { name: 'Laser marking', color: [0.075, 0.057, 0.031], metalness: 0.62, roughness: 0.42 },
  'lens-coating': { name: 'Camera optical coating', color: [0.011, 0.017, 0.028], metalness: 0.12, roughness: 0.12 },
  'sensor-window': { name: 'Smoked sensor window', color: [0.038, 0.048, 0.043], metalness: 0.12, roughness: 0.24 },
  'camera-pupil': { name: 'Camera pupil', color: [0.007, 0.006, 0.012], metalness: 0.05, roughness: 0.2 },
  'flash-diffuser': { name: 'Flash diffuser', color: [0.76, 0.74, 0.57], metalness: 0.15, roughness: 0.22 },
  'graphite-textured': { name: 'Textured graphite', color: [0.115, 0.12, 0.125], metalness: 0, roughness: 0.56 },
  'charging-light': { name: 'Charging indicator', color: [0.65, 0.72, 0.61], metalness: 0, roughness: 0.3 },
  'cover-glass': { name: 'Black polished cover glass', color: [0.007, 0.01, 0.012], metalness: 0, roughness: 0.14 },
  'window-mask': { name: 'Black printed window mask', color: [0.004, 0.005, 0.006], metalness: 0, roughness: 0.2 },
  lcd: { name: 'LCD graphite blue', color: [0.018, 0.025, 0.019], metalness: 0, roughness: 0.2 },
  'bronze-bead': { name: 'Bead-blasted bronze', color: [0.42, 0.38, 0.31], metalness: 0.88, roughness: 0.32 },
  'silver-bead': { name: 'Bead-blasted silver', color: [0.6, 0.6, 0.6], metalness: 0.88, roughness: 0.32 },
  'graphite-bead': { name: 'Bead-blasted graphite', color: [0.1, 0.1, 0.11], metalness: 0.88, roughness: 0.34 },
  'call-mint': { name: 'Call mint', color: [0.14, 0.57, 0.36], metalness: 0.1, roughness: 0.35, emissive: [0.028, 0.114, 0.072] },
  'end-coral': { name: 'End coral', color: [0.72, 0.11, 0.12], metalness: 0.1, roughness: 0.35, emissive: [0.144, 0.022, 0.024] },
  'screen-media': { name: 'Screen', color: [0, 0, 0], metalness: 1, roughness: 1, emissive: [0.008, 0.012, 0.016] },
  'flex-graphite': { name: 'Matte graphite flex', color: [0.009, 0.008, 0.008], metalness: 0, roughness: 0.55 },
} satisfies Record<string, Finish>;

export type FinishId = keyof typeof FINISHES;

/**
 * Parts that move together. The body is the datum; the others are positioned
 * relative to it, along the axis they were adjusted on (model mm, Y up,
 * +Z towards the keyboard edge).
 */
export const RIGS = {
  body: { axis: null, limit: 0 },
  display: { axis: 'z', limit: 3 },
  hinge: { axis: 'y', limit: 2 },
  keyboard: { axis: 'y', limit: 1.5 },
  camera: { axis: 'x', limit: 2 },
} as const satisfies Record<string, { axis: 'x' | 'y' | 'z' | null; limit: number }>;

export type RigId = keyof typeof RIGS;

export interface PartSpec {
  /** `<node name>/<primitive index>` in the source model. */
  source: string;
  name: string;
  /** Shown in summaries, like rooms in the floor plan. */
  assembly: string;
  rig: RigId;
  finish: FinishId;
  /** Small separate pieces that were redrawn (deleted and created again). */
  replaceable?: boolean;
}

/** In creation order: the body first, details and decals last. */
export const PARTS: PartSpec[] = [
  { source: 'Body/1', name: 'Body shell', assembly: 'Body', rig: 'body', finish: 'polymer-charcoal' },
  { source: 'Body/7', name: 'Perimeter frame', assembly: 'Body', rig: 'body', finish: 'polished-perimeter' },
  { source: 'Body/4', name: 'Back plate', assembly: 'Body', rig: 'body', finish: 'chestnut-steel' },
  { source: 'Body/0', name: 'Body recesses', assembly: 'Body', rig: 'body', finish: 'recess-rubber' },
  { source: 'Body/2', name: 'Control rail', assembly: 'Controls', rig: 'body', finish: 'chestnut-satin' },
  { source: 'HingeSupport_2/0', name: 'Hinge leaf', assembly: 'Hinge', rig: 'hinge', finish: 'chestnut-steel' },
  { source: 'HingeSupport_3/0', name: 'Hinge leaf', assembly: 'Hinge', rig: 'hinge', finish: 'chestnut-steel' },
  { source: 'HingeSupport_1/0', name: 'Flex cable', assembly: 'Hinge', rig: 'hinge', finish: 'flex-graphite' },
  { source: 'DisplayHousing/1', name: 'Display back', assembly: 'Display', rig: 'display', finish: 'polymer-charcoal' },
  { source: 'DisplayHousing/2', name: 'Display surround', assembly: 'Display', rig: 'display', finish: 'champagne-steel' },
  { source: 'DisplayHousing/3', name: 'Display recesses', assembly: 'Display', rig: 'display', finish: 'recess-rubber' },
  { source: 'DisplayHousing/4', name: 'Cover glass', assembly: 'Display', rig: 'display', finish: 'cover-glass' },
  { source: 'DisplayHousing/5', name: 'Window mask', assembly: 'Display', rig: 'display', finish: 'window-mask' },
  { source: 'DisplayHousing/6', name: 'LCD', assembly: 'Display', rig: 'display', finish: 'lcd' },
  { source: 'ScreenSurface/0', name: 'Screen', assembly: 'Display', rig: 'display', finish: 'screen-media' },
  { source: 'Body/3', name: 'Keyboard deck', assembly: 'Keyboard', rig: 'keyboard', finish: 'deck-charcoal' },
  { source: 'Body/5', name: 'Keycaps', assembly: 'Keyboard', rig: 'keyboard', finish: 'keycaps-black' },
  { source: 'Body/6', name: 'Key legends', assembly: 'Keyboard', rig: 'keyboard', finish: 'printing-white' },
  { source: 'Body/14', name: 'Shift legends', assembly: 'Keyboard', rig: 'keyboard', finish: 'amber-legends' },
  { source: 'DisplayHousing/9', name: 'Menu key', assembly: 'Controls', rig: 'display', finish: 'bronze-bead', replaceable: true },
  { source: 'DisplayHousing/10', name: 'Call key', assembly: 'Controls', rig: 'display', finish: 'call-mint', replaceable: true },
  { source: 'DisplayHousing/11', name: 'End key', assembly: 'Controls', rig: 'display', finish: 'end-coral', replaceable: true },
  { source: 'Body/12', name: 'Lock slider', assembly: 'Controls', rig: 'body', finish: 'graphite-textured', replaceable: true },
  { source: 'Body/13', name: 'Charging light', assembly: 'Controls', rig: 'body', finish: 'charging-light', replaceable: true },
  { source: 'Body/8', name: 'Camera lens', assembly: 'Camera', rig: 'camera', finish: 'lens-coating' },
  { source: 'Body/10', name: 'Camera pupil', assembly: 'Camera', rig: 'camera', finish: 'camera-pupil' },
  { source: 'Body/9', name: 'Sensor window', assembly: 'Camera', rig: 'camera', finish: 'sensor-window' },
  { source: 'Body/11', name: 'Flash', assembly: 'Camera', rig: 'camera', finish: 'flash-diffuser', replaceable: true },
  { source: 'DisplayHousing/7', name: 'Front sensor', assembly: 'Display', rig: 'display', finish: 'sensor-window' },
  { source: 'DisplayHousing/8', name: 'Front camera', assembly: 'Display', rig: 'display', finish: 'lens-coating' },
  { source: 'DisplayHousing/0', name: 'Display printing', assembly: 'Display', rig: 'display', finish: 'printing-white' },
  { source: 'Body/15', name: 'Rear logo', assembly: 'Body', rig: 'body', finish: 'logo-laser', replaceable: true },
];

/**
 * Colourways tried during CMF exploration, by part name. Parts not listed
 * keep their finish. The shipped one (chestnut) is every part's own finish.
 */
export const COLORWAYS: Record<string, Partial<Record<string, FinishId>>> = {
  silver: {
    'Back plate': 'silver-steel',
    'Perimeter frame': 'polished-silver',
    'Display surround': 'silver-steel',
    'Control rail': 'silver-satin',
    'Hinge leaf': 'silver-steel',
    'Menu key': 'silver-bead',
  },
  graphite: {
    'Back plate': 'graphite-steel',
    'Perimeter frame': 'polished-graphite',
    'Display surround': 'graphite-steel',
    'Control rail': 'graphite-satin',
    'Hinge leaf': 'graphite-steel',
    'Menu key': 'graphite-bead',
  },
  white: {
    'Body shell': 'polymer-white',
    'Display back': 'polymer-white',
    'Keyboard deck': 'deck-white',
    Keycaps: 'keycaps-white',
    'Key legends': 'printing-black',
    'Display printing': 'printing-black',
    'Back plate': 'silver-steel',
    'Perimeter frame': 'polished-silver',
    'Display surround': 'silver-steel',
  },
  red: {
    'Body shell': 'polymer-red',
    'Display back': 'polymer-red',
    'Perimeter frame': 'polished-graphite',
    'Back plate': 'graphite-steel',
    'Shift legends': 'printing-white',
  },
};
