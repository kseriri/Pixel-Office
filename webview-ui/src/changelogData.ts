interface ChangelogSection {
  title: string;
  items: string[];
}

interface ChangelogContributor {
  name: string;
  url: string;
  description: string;
}

interface ChangelogEntry {
  version: string;
  sections: ChangelogSection[];
  contributors: ChangelogContributor[];
}

/** Extract "major.minor" from a semver string (e.g. "1.1.1" → "1.1") */
export function toMajorMinor(version: string): string {
  const parts = version.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version;
}

export const CHANGELOG_REPO_URL = 'https://github.com/kseriri/Pixel-Office';

export const changelogEntries: ChangelogEntry[] = [
  {
    version: '0.1',
    sections: [
      {
        title: 'Highlights',
        items: [
          'Open-plan office with per-project work spaces + a break lounge agents walk to when idle',
          'Model badges with token count, cache-aware cost, a utilization bar, and a mood emote',
          'A wall-mounted board with a live per-project token-usage graph',
          'Pin a character to each project × model (Settings)',
          'Claude Code and Codex sessions shown side by side',
          'Installable as a PWA app window',
        ],
      },
    ],
    contributors: [],
  },
];
