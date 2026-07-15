// ===== App Store portfolio data =====
//
// Placeholder projects. Everything the store renders comes from this array —
// swap these entries for real projects later (names, blurbs, tags, optional
// live URL) and the grid + detail pages update with no other changes.
// Images are intentionally gradient placeholders; no external assets.

export interface Project {
  /** Stable id; also the detail-view hash (/appstore/#<id>). */
  id: string;
  name: string;
  /** Short subtitle shown next to the name. */
  tagline: string;
  category: string;
  /** Emoji shown on the app-style icon. */
  glyph: string;
  /** Icon tile gradient. */
  gradient: string;
  /** Longer description for the detail page. */
  description: string;
  tags: string[];
  year: string;
  /** Optional live link; omit for pure placeholders. */
  url?: string;
  /** Gradient backdrops standing in for screenshots. */
  screens: string[];
}

export const PROJECTS: Project[] = [
  {
    id: 'placeholder-one',
    name: 'Project One',
    tagline: 'A flagship placeholder',
    category: 'Web App',
    glyph: '🚀',
    gradient: 'linear-gradient(160deg, #0a84ff, #5e5ce6)',
    description:
      'This is filler copy describing a project. Replace it with a real one-paragraph summary of what you built, the problem it solves, and the impact it had. The layout adapts to however much text you provide.',
    tags: ['React', 'TypeScript', 'Design'],
    year: '2025',
    screens: [
      'linear-gradient(140deg, #0a84ff, #64d2ff)',
      'linear-gradient(140deg, #5e5ce6, #bf5af2)',
      'linear-gradient(140deg, #30d0c6, #0a84ff)',
    ],
  },
  {
    id: 'placeholder-two',
    name: 'Project Two',
    tagline: 'Another thing I made',
    category: 'Tooling',
    glyph: '🛠️',
    gradient: 'linear-gradient(160deg, #30d0c6, #0a9d9f)',
    description:
      'Filler description number two. A developer tool, a CLI, a library — describe the surface, the tech, and why it matters. Placeholder text sits here until you drop in the real story.',
    tags: ['Node', 'CLI', 'Open Source'],
    year: '2025',
    screens: [
      'linear-gradient(140deg, #30d0c6, #34c759)',
      'linear-gradient(140deg, #0a9d9f, #007aff)',
    ],
  },
  {
    id: 'placeholder-three',
    name: 'Project Three',
    tagline: 'Experiments & prototypes',
    category: 'Creative',
    glyph: '🎨',
    gradient: 'linear-gradient(160deg, #ff9f6b, #ff375f)',
    description:
      'A creative or experimental project. Generative art, an interactive toy, a game jam entry. Swap this placeholder for the real thing whenever it is ready to show.',
    tags: ['Canvas', 'WebGL', 'Animation'],
    year: '2024',
    screens: [
      'linear-gradient(140deg, #ff9f6b, #ff2d55)',
      'linear-gradient(140deg, #ff375f, #bf5af2)',
      'linear-gradient(140deg, #ffcc00, #ff9500)',
    ],
  },
  {
    id: 'placeholder-four',
    name: 'Project Four',
    tagline: 'Data & machine learning',
    category: 'ML',
    glyph: '🧠',
    gradient: 'linear-gradient(160deg, #bf5af2, #5e5ce6)',
    description:
      'Placeholder for a data or ML project. Describe the dataset, the model, and the result. This card is just filler until the real project takes its place.',
    tags: ['Python', 'PyTorch', 'Data'],
    year: '2024',
    screens: [
      'linear-gradient(140deg, #bf5af2, #5e5ce6)',
      'linear-gradient(140deg, #5e5ce6, #0a84ff)',
    ],
  },
  {
    id: 'placeholder-five',
    name: 'Project Five',
    tagline: 'Mobile & beyond',
    category: 'Mobile',
    glyph: '📱',
    gradient: 'linear-gradient(160deg, #34c759, #30d0c6)',
    description:
      'A mobile app or cross-platform project placeholder. Describe the platform, the stack, and what makes it nice to use. Replace with the real one when ready.',
    tags: ['Swift', 'React Native', 'UX'],
    year: '2023',
    screens: ['linear-gradient(140deg, #34c759, #a8e063)'],
  },
  {
    id: 'placeholder-six',
    name: 'Project Six',
    tagline: 'A little bit of everything',
    category: 'Full-Stack',
    glyph: '🧩',
    gradient: 'linear-gradient(160deg, #ff2d55, #ff9500)',
    description:
      'The last placeholder. A full-stack build, an infra project, or a hackathon win — put the real details here later. The App Store grid grows automatically as you add entries to the config.',
    tags: ['Full-Stack', 'AWS', 'Postgres'],
    year: '2023',
    screens: [
      'linear-gradient(140deg, #ff2d55, #ff375f)',
      'linear-gradient(140deg, #ff9500, #ffcc00)',
    ],
  },
];

export function projectById(id: string | null | undefined): Project | undefined {
  return PROJECTS.find((p) => p.id === id);
}
