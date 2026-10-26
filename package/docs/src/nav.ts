/**
 * The header tabs, each with its own sidebar, in reading order. Page keys are files in the repository's
 * docs/ folder without `.md` (`index` is docs/README.md); values are Lucide icon names (https://lucide.dev/icons).
 */
export const tabs: { label: string; icon: string; sections: { title: string; icon: string; pages: Record<string, string> }[] }[] = [
  {
    label: 'Docs',
    icon: 'BookOpen',
    sections: [
      {
        title: 'Get started',
        icon: 'Rocket',
        pages: {
          index: 'Compass',
          'how-it-works': 'Route',
          requirements: 'ListChecks',
          deploy: 'CloudUpload',
          configuration: 'SlidersHorizontal',
        },
      },
      {
        title: 'Capture',
        icon: 'Video',
        pages: {
          'capture/relay': 'Radio',
          'capture/ingest': 'ArrowDownToLine',
          'capture/store': 'HardDrive',
          'capture/catalog': 'Database',
        },
      },
      {
        title: 'Workshop',
        icon: 'FlaskConical',
        pages: {
          website: 'LayoutDashboard',
          'workshop/workflows': 'Workflow',
          'workshop/runs': 'Play',
          'workshop/datasets': 'Layers',
          'workshop/tracking': 'Spline',
        },
      },
      { title: 'Processor', icon: 'Cpu', pages: { processor: 'Cpu', models: 'Box' } },
    ],
  },
  {
    label: 'API',
    icon: 'Code',
    sections: [
      {
        title: 'API',
        icon: 'Code',
        pages: { api: 'KeyRound', 'api/footage': 'Film', 'api/workshop': 'Workflow', 'api/mcp': 'Bot' },
      },
    ],
  },
  {
    label: 'Develop',
    icon: 'Hammer',
    sections: [
      {
        title: 'Develop',
        icon: 'Hammer',
        pages: { 'develop/architecture': 'Blocks', 'develop/local': 'Terminal', 'develop/contributing': 'GitPullRequest' },
      },
    ],
  },
];

export const repository = 'https://github.com/Deibler/openskycam';
export const href = (id: string) => (id === 'index' ? '/' : `/${id}/`);
