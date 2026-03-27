/**
 * electron-builder configuration
 * Docs: https://www.electron.build/configuration
 */
module.exports = {
  appId: 'com.lapscore.healthmonitor',
  productName: 'LapScore',
  copyright: 'Copyright © 2026 LapScore',

  directories: {
    output: 'release/',
  },

  files: [
    'electron/**/*',
    'server/**/*',
    // 'client/dist/**/*',  // Moved to extraResources
    'assets/**/*',
    'package.json',
  ],

  // Native modules must be unpacked from .asar to load properly
  asarUnpack: [
    'node_modules/better-sqlite3/**/*',
    'node_modules/systeminformation/**/*',
  ],

  extraResources: [
    {
      from: 'client/dist',
      to: 'client/dist',
    },
    {
      from: 'assets',
      to: 'assets',
      filter: [
        'icon.ico',
        'icon.png',
        'tray-icon.png',
        'tray-icon-16.png',
        'tray-good.png',
        'tray-warn.png',
        'tray-critical.png',
        'tray-good-16.png',
        'tray-warn-16.png',
        'tray-critical-16.png'
      ]
    },
  ],

  // Ensure native modules (better-sqlite3) are rebuilt for Electron's Node ABI
  npmRebuild: true,

  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
    ],
    icon: 'assets/icon.ico',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    installerHeaderIcon: 'assets/icon.ico',
    shortcutName: 'LapScore',
    // include: 'electron/installer.nsh',  // Uncomment to add firewall rules for fleet UDP
  },

  publish: {
    provider: 'github',
    owner: 'prani', // Replace with your actual GitHub username
    repo: 'lapscore',
    releaseType: 'release',
  },
};
