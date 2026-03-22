import { ExpoConfig, ConfigContext } from 'expo/config';
import { execSync } from 'child_process';

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
const commitMessage = execSync('git log -1 --pretty=%s').toString().trim();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Flash Cards',
  slug: 'flash-card',
  scheme: 'flash-card',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0f172a',
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/favicon.png',
  },
  experiments: {
    baseUrl: '/flash-card',
  },
  plugins: ['expo-router'],
  extra: {
    commitHash,
    commitMessage,
  },
});
